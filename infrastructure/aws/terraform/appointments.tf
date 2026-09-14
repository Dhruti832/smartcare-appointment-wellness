# Appointments module: the booking/approval Lambdas, their HTTP API, and the
# cross-cloud mirror (DynamoDB Stream -> Lambda -> S3 CSV -> GCP Cloud Function
# -> Firestore). Split into its own file to keep this module's resources
# isolated from other members' (same pattern as auth.tf). The DynamoDB tables
# themselves live in dynamodb.tf (owned by the foundations module); this file
# only adds the stream-consuming side.
#
# The mirror reuses the keyless S3-presigned pattern proven by the feedback
# mirror (feedback_export.tf): Workload Identity Federation pool creation is
# blocked by org policy on the GCP project, so instead of a standing cross-
# cloud credential the Lambda exports each appointment to S3 and hands the GCP
# side a short-lived presigned URL to fetch.

variable "gcp_appointments_mirror_url" {
  description = "HTTPS URL of the GCP appointments-mirror Cloud Function (terraform output appointments_mirror_url from infrastructure/gcp/terraform). Leave empty to deploy the mirror Lambda without an active GCP notify step -- exports still land in S3."
  type        = string
  default     = ""
}

variable "gcp_appointments_mirror_shared_secret" {
  description = "Shared secret sent as the X-Export-Token header to the GCP appointments-mirror function (must match that function's shared-secret tfvar). Leave empty to send unauthenticated requests."
  type        = string
  sensitive   = true
  default     = ""
}

# ── Lambda packaging (booking/approval handlers) ───────────────────────────────
# Same flat-zip-multiple-handlers approach as auth.tf's auth_lambdas archive.
data "archive_file" "appointments_lambdas" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend/appointments"
  output_path = "${path.module}/build/appointments-lambdas.zip"
  excludes    = ["__pycache__"]
}

locals {
  appointments_lambda_env = {
    APPOINTMENTS_TABLE_NAME     = aws_dynamodb_table.appointments.name
    APPOINTMENT_LOGS_TABLE_NAME = aws_dynamodb_table.appointment_logs.name
    SERVICES_TABLE_NAME         = aws_dynamodb_table.services.name
    NOTIFICATIONS_QUEUE_URL     = aws_sqs_queue.appointments.url
  }

  mirror_lambda_env = merge(local.appointments_lambda_env, {
    APPOINTMENTS_EXPORT_BUCKET = aws_s3_bucket.appointments_export.bucket
    GCP_MIRROR_FUNCTION_URL    = var.gcp_appointments_mirror_url
    GCP_MIRROR_SHARED_SECRET   = var.gcp_appointments_mirror_shared_secret
  })

  appointments_handlers = {
    book    = "book_appointment.lambda_handler"
    my      = "get_my_appointments.lambda_handler"
    get_one = "get_appointment.lambda_handler"
    list    = "list_appointments_by_status.lambda_handler"
    approve = "approve_appointment.lambda_handler"
    reject  = "reject_appointment.lambda_handler"
    cancel  = "cancel_appointment.lambda_handler"
    logs    = "get_appointment_logs.lambda_handler"
  }
}

resource "aws_lambda_function" "appointments" {
  for_each         = local.appointments_handlers
  function_name    = "saws-appointments-${each.key}-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = each.value
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.appointments_lambdas.output_path
  source_code_hash = data.archive_file.appointments_lambdas.output_base64sha256

  environment {
    variables = local.appointments_lambda_env
  }
}

# ── Cross-cloud mirror: S3 export bucket ────────────────────────────────────────
# The mirror Lambda writes each appointment here as a CSV and hands the GCP
# Cloud Function a short-lived presigned URL to fetch it. Same keyless hand-off
# as feedback_export.tf. Objects are read once shortly after being written, so
# they expire after a day.
resource "aws_s3_bucket" "appointments_export" {
  bucket = "saws-appointments-export-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_lifecycle_configuration" "appointments_export" {
  bucket = aws_s3_bucket.appointments_export.id

  rule {
    id     = "expire-exports"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}

resource "aws_lambda_function" "mirror_to_firestore" {
  function_name = "saws-appointments-mirror-${var.environment}"
  role          = data.aws_iam_role.lab_role.arn
  handler       = "mirror_to_firestore.lambda_handler"
  runtime       = "python3.12"
  # boto3 (S3 client) ships in the Python 3.12 runtime, so no dependency layer
  # is needed -- unlike the previous WIF/Firestore-direct version.
  timeout          = 15
  filename         = data.archive_file.appointments_lambdas.output_path
  source_code_hash = data.archive_file.appointments_lambdas.output_base64sha256

  environment {
    variables = local.mirror_lambda_env
  }
}

# DynamoDB Stream (enabled on the table in dynamodb.tf) -> mirror Lambda.
# This is what makes the mirror event-driven off a real booking/status
# change rather than a hand-seeded Firestore doc.
resource "aws_lambda_event_source_mapping" "appointments_stream" {
  event_source_arn  = aws_dynamodb_table.appointments.stream_arn
  function_name     = aws_lambda_function.mirror_to_firestore.arn
  starting_position = "LATEST"
  batch_size        = 1
}

# ── HTTP API ──────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_api" "appointments" {
  name          = "saws-appointments-api-${var.environment}"
  protocol_type = "HTTP"

  # PUT is here for services.tf's `PUT /services/{serviceId}` -- without it the
  # browser's preflight for that route comes back with no CORS headers at all
  # and the coordinator's save-service request fails as net::ERR_FAILED.
  cors_configuration {
    allow_origins = var.frontend_origins
    allow_methods = ["GET", "POST", "PUT", "PATCH", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
  }
}

resource "aws_apigatewayv2_stage" "appointments_default" {
  api_id      = aws_apigatewayv2_api.appointments.id
  name        = "$default"
  auto_deploy = true
}

# JWT authorizers are scoped to a single API, so this module gets its own
# (pointed at the same Cognito user pool/client auth.tf provisions) rather
# than reusing auth.tf's authorizer object directly. Role checks (Patient vs
# Coordinator) happen inside each handler via appointments_common.is_coordinator,
# same as backend/auth/get_profile.py -- this authorizer only proves identity.
resource "aws_apigatewayv2_authorizer" "appointments_cognito" {
  api_id           = aws_apigatewayv2_api.appointments.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "saws-appointments-cognito-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.saws.id}"
  }
}

locals {
  appointments_routes = {
    book    = { method = "POST", path = "/appointments", lambda = aws_lambda_function.appointments["book"] }
    my      = { method = "GET", path = "/appointments/me", lambda = aws_lambda_function.appointments["my"] }
    list    = { method = "GET", path = "/appointments", lambda = aws_lambda_function.appointments["list"] }
    get_one = { method = "GET", path = "/appointments/{appointmentId}", lambda = aws_lambda_function.appointments["get_one"] }
    approve = { method = "PATCH", path = "/appointments/{appointmentId}/approve", lambda = aws_lambda_function.appointments["approve"] }
    reject  = { method = "PATCH", path = "/appointments/{appointmentId}/reject", lambda = aws_lambda_function.appointments["reject"] }
    cancel  = { method = "PATCH", path = "/appointments/{appointmentId}/cancel", lambda = aws_lambda_function.appointments["cancel"] }
    logs    = { method = "GET", path = "/appointments/{appointmentId}/logs", lambda = aws_lambda_function.appointments["logs"] }
  }
}

resource "aws_apigatewayv2_integration" "appointments" {
  for_each               = local.appointments_routes
  api_id                 = aws_apigatewayv2_api.appointments.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.lambda.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "appointments" {
  for_each           = local.appointments_routes
  api_id             = aws_apigatewayv2_api.appointments.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.appointments[each.key].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.appointments_cognito.id
}

resource "aws_lambda_permission" "appointments" {
  for_each      = local.appointments_routes
  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.appointments.execution_arn}/*/*"
}

# Note: DynamoDB Streams are pull-based (Lambda polls via
# aws_lambda_event_source_mapping using its own execution role), unlike
# SNS/S3 push triggers -- no aws_lambda_permission resource policy is needed
# for the stream to invoke this function.

# ── Outputs for the frontend .env ─────────────────────────────────────────────
output "appointments_api_endpoint" {
  value = aws_apigatewayv2_api.appointments.api_endpoint
}

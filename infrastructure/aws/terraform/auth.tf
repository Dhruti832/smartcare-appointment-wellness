# Authentication module: Cognito groups, the 3-stage MFA lambdas, and the HTTP
# API that fronts them. Split into its own file to keep the auth module's
# infra changes isolated from other members' resources in main.tf.
# (the "archive" provider this file needs is declared in main.tf's
# required_providers, since a module may only declare that block once)

# AWS Academy Learner Lab does not allow creating IAM roles/policies, so every
# Lambda in this stack reuses the pre-provisioned LabRole instead of a
# purpose-built execution role.
variable "lab_role_name" {
  description = "Name of the Learner Lab-provided IAM role used as the execution role for all Lambdas"
  default     = "LabRole"
}

data "aws_iam_role" "lab_role" {
  name = var.lab_role_name
}

# ── Cognito groups (role-based access) ────────────────────────────────────────
resource "aws_cognito_user_group" "patients" {
  name         = "Patients"
  user_pool_id = aws_cognito_user_pool.saws.id
}

resource "aws_cognito_user_group" "coordinators" {
  name         = "Coordinators"
  user_pool_id = aws_cognito_user_pool.saws.id
}

# ── DynamoDB (auth-owned tables only — the Users profile table belongs to a
# different module) ────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "user_security" {
  name         = "UserSecurity"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "username"

  attribute {
    name = "username"
    type = "S"
  }
}

resource "aws_dynamodb_table" "auth_sessions" {
  name         = "AuthSessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sessionId"

  attribute {
    name = "sessionId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# ── Lambda packaging ──────────────────────────────────────────────────────────
# All auth lambdas import shared siblings (cipher_utils.py, hashing_utils.py,
# auth_sessions.py) as top-level modules, so they're bundled into one flat zip
# and each function just points at a different handler within it.
data "archive_file" "auth_lambdas" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend/auth"
  output_path = "${path.module}/build/auth-lambdas.zip"
  excludes    = ["__pycache__"]
}

locals {
  auth_lambda_env = {
    USER_SECURITY_TABLE_NAME = aws_dynamodb_table.user_security.name
    AUTH_SESSIONS_TABLE_NAME = aws_dynamodb_table.auth_sessions.name
    COGNITO_USER_POOL_ID     = aws_cognito_user_pool.saws.id
    COGNITO_CLIENT_ID        = aws_cognito_user_pool_client.web.id
    NOTIFICATIONS_QUEUE_URL  = aws_sqs_queue.appointments.url
  }
}

resource "aws_lambda_function" "auth_register" {
  function_name    = "saws-auth-register-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "register.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.auth_lambdas.output_path
  source_code_hash = data.archive_file.auth_lambdas.output_base64sha256

  environment {
    variables = local.auth_lambda_env
  }
}

resource "aws_lambda_function" "auth_stage1" {
  function_name    = "saws-auth-stage1-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "stage1_cognito_login.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.auth_lambdas.output_path
  source_code_hash = data.archive_file.auth_lambdas.output_base64sha256

  environment {
    variables = local.auth_lambda_env
  }
}

resource "aws_lambda_function" "auth_stage2" {
  function_name    = "saws-auth-stage2-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "stage2_security_qa.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.auth_lambdas.output_path
  source_code_hash = data.archive_file.auth_lambdas.output_base64sha256

  environment {
    variables = local.auth_lambda_env
  }
}

resource "aws_lambda_function" "auth_stage3" {
  function_name    = "saws-auth-stage3-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "stage3_caesar_cipher.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.auth_lambdas.output_path
  source_code_hash = data.archive_file.auth_lambdas.output_base64sha256

  environment {
    variables = local.auth_lambda_env
  }
}

resource "aws_lambda_function" "auth_get_profile" {
  function_name    = "saws-auth-get-profile-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "get_profile.lambda_handler"
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.auth_lambdas.output_path
  source_code_hash = data.archive_file.auth_lambdas.output_base64sha256
}

# ── HTTP API ──────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_api" "auth" {
  name          = "saws-auth-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.frontend_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
  }
}

resource "aws_apigatewayv2_stage" "auth_default" {
  api_id      = aws_apigatewayv2_api.auth.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.auth.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "saws-cognito-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.saws.id}"
  }
}

locals {
  auth_routes = {
    register = { method = "POST", path = "/auth/register", lambda = aws_lambda_function.auth_register, protected = false }
    stage1   = { method = "POST", path = "/auth/login/stage1", lambda = aws_lambda_function.auth_stage1, protected = false }
    stage2   = { method = "POST", path = "/auth/login/stage2", lambda = aws_lambda_function.auth_stage2, protected = false }
    stage3   = { method = "POST", path = "/auth/login/stage3", lambda = aws_lambda_function.auth_stage3, protected = false }
    profile  = { method = "GET", path = "/auth/me", lambda = aws_lambda_function.auth_get_profile, protected = true }
  }
}

resource "aws_apigatewayv2_integration" "auth" {
  for_each               = local.auth_routes
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.lambda.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "auth" {
  for_each           = local.auth_routes
  api_id             = aws_apigatewayv2_api.auth.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.auth[each.key].id}"
  authorization_type = each.value.protected ? "JWT" : "NONE"
  authorizer_id      = each.value.protected ? aws_apigatewayv2_authorizer.cognito.id : null
}

resource "aws_lambda_permission" "auth" {
  for_each      = local.auth_routes
  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}

# ── Outputs for the frontend .env ─────────────────────────────────────────────
output "auth_api_endpoint" {
  value = aws_apigatewayv2_api.auth.api_endpoint
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.saws.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}
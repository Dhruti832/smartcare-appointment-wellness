# Feedback export module: the AWS half of the cross-cloud feedback mirror
# (DynamoDB Stream -> Lambda -> S3 CSV -> GCP Cloud Function -> Firestore).
#
# GCP can't read DynamoDB directly, so unlike the appointments mirror
# (Lambda -> Firestore direct via Workload Identity Federation, appointments.tf),
# this exports each scored feedback row to S3 as CSV and hands the GCP side a
# short-lived presigned URL rather than a standing cross-cloud credential.
# Split into its own file, same per-module convention as appointments.tf.

variable "gcp_feedback_mirror_url" {
  description = "HTTPS URL of the GCP feedback-mirror Cloud Function (terraform output feedback_mirror_url from infrastructure/gcp/terraform). Leave empty to deploy the export Lambda without an active GCP notify step -- exports still land in S3."
  type        = string
  default     = ""
}

variable "gcp_feedback_mirror_shared_secret" {
  description = "Shared secret sent as the X-Export-Token header to the GCP feedback-mirror function (must match that function's feedback_export_shared_secret tfvar). Leave empty to send unauthenticated requests."
  type        = string
  sensitive   = true
  default     = ""
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "feedback_export" {
  # Account id suffix keeps the name globally unique across Learner Lab
  # accounts without needing a random_id resource.
  bucket = "saws-feedback-export-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

# Objects are a single-purpose, short-lived hand-off (read once via a
# presigned URL shortly after being written) -- no reason to keep them.
resource "aws_s3_bucket_lifecycle_configuration" "feedback_export" {
  bucket = aws_s3_bucket.feedback_export.id

  rule {
    id     = "expire-exports"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}

# boto3 (S3 client) ships in the Python 3.12 Lambda runtime already, so this
# Lambda needs no dependency layer, unlike mirror_to_firestore.py.
data "archive_file" "feedback_export_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend/feedback"
  output_path = "${path.module}/build/feedback-export.zip"
  excludes    = ["__pycache__"]
}

resource "aws_lambda_function" "export_feedback_csv" {
  function_name    = "saws-feedback-export-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "export_feedback_csv.lambda_handler"
  runtime          = "python3.12"
  timeout          = 15
  filename         = data.archive_file.feedback_export_lambda.output_path
  source_code_hash = data.archive_file.feedback_export_lambda.output_base64sha256

  environment {
    variables = {
      FEEDBACK_EXPORT_BUCKET   = aws_s3_bucket.feedback_export.bucket
      GCP_MIRROR_FUNCTION_URL  = var.gcp_feedback_mirror_url
      GCP_MIRROR_SHARED_SECRET = var.gcp_feedback_mirror_shared_secret
    }
  }
}

# Feedback table stream (enabled in dynamodb.tf) -> this Lambda. Fans out
# from the same stream analytics.tf's feedback_sentiment mapping reads;
# this Lambda only acts on the MODIFY event that Lambda's own UpdateItem
# produces (see export_feedback_csv.lambda_handler), so the two consumers
# never race on an unscored row.
resource "aws_lambda_event_source_mapping" "feedback_export" {
  event_source_arn  = aws_dynamodb_table.feedback.stream_arn
  function_name     = aws_lambda_function.export_feedback_csv.arn
  starting_position = "LATEST"
  batch_size        = 1
}

output "feedback_export_bucket" {
  value = aws_s3_bucket.feedback_export.bucket
}

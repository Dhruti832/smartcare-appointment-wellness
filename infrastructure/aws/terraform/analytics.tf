# analytics.tf — Module 5 (Member 7): feedback sentiment on AWS.
# Per architectural_decisions.md §9, feedback lives in saws-feedback (DynamoDB) and
# sentiment runs here as a Lambda that writes the score back into the same row.
# Kept in its own file (team convention) so it never collides with dynamodb.tf /
# auth.tf / main.tf. Reuses resources declared elsewhere rather than redeclaring:
#   - data.aws_iam_role.lab_role  (auth.tf — Learner Lab forbids creating IAM roles)
#   - aws_dynamodb_table.feedback (dynamodb.tf)
#   - the archive provider        (main.tf required_providers)

# Package the sentiment Lambda source (boto3 is in the runtime, so no vendored deps).
data "archive_file" "sentiment" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend/feedback"
  output_path = "${path.module}/build/sentiment.zip"
  excludes    = ["__pycache__"]
}

resource "aws_lambda_function" "analyze_sentiment" {
  function_name    = "saws-analyze-sentiment-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "analyze_sentiment.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.sentiment.output_path
  source_code_hash = data.archive_file.sentiment.output_base64sha256

  environment {
    variables = {
      FEEDBACK_TABLE_NAME = aws_dynamodb_table.feedback.name
      GOOGLE_API_KEY      = var.google_api_key
    }
  }
}

# Sentiment engine key. Learner Lab's LabRole can't call Amazon Comprehend, so
# sentiment uses the Google Natural Language API instead (§9 leaves the engine to
# this module). Provide via `TF_VAR_google_api_key` or a non-committed .tfvars —
# never hardcode it (see .gitignore: *.tfvars).
variable "google_api_key" {
  description = "API key for the Google Cloud Natural Language API"
  type        = string
  sensitive   = true
}

# Event-driven trigger: the feedback table's DynamoDB Stream invokes the Lambda
# whenever a feedback row is created. Streams enabled on the table in
# dynamodb.tf (was flagged here, applied when the export Lambda in
# feedback_export.tf needed the same stream).
resource "aws_lambda_event_source_mapping" "feedback_sentiment" {
  event_source_arn  = aws_dynamodb_table.feedback.stream_arn
  function_name     = aws_lambda_function.analyze_sentiment.arn
  starting_position = "LATEST"
}

output "analyze_sentiment_function" {
  value = aws_lambda_function.analyze_sentiment.function_name
}

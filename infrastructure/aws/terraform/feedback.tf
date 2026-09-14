# Feedback module: submit (Patient) + list (public) for patient feedback.
# Split into its own file (team convention). Like services.tf, routes are
# added to the *existing* Appointments HTTP API (appointments.tf) because the
# frontend calls /feedback through the same REACT_APP_APPOINTMENTS_API_URL
# axios instance (frontend/src/services/api.js).
#
# Sentiment scoring is a separate concern owned by analytics.tf: submitting
# feedback here writes a row WITHOUT a sentimentLabel, and the feedback
# table's DynamoDB Stream triggers analyze_sentiment (analytics.tf) to fill
# the sentiment fields in asynchronously.

data "archive_file" "feedback_lambdas" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend/feedback"
  output_path = "${path.module}/build/feedback-lambdas.zip"
  excludes    = ["__pycache__"]
}

locals {
  feedback_lambda_env = {
    FEEDBACK_TABLE_NAME = aws_dynamodb_table.feedback.name
  }

  feedback_handlers = {
    submit = "submit_feedback.lambda_handler"
    list   = "list_feedback.lambda_handler"
  }
}

resource "aws_lambda_function" "feedback" {
  for_each         = local.feedback_handlers
  function_name    = "saws-feedback-${each.key}-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = each.value
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.feedback_lambdas.output_path
  source_code_hash = data.archive_file.feedback_lambdas.output_base64sha256

  environment {
    variables = local.feedback_lambda_env
  }
}

locals {
  feedback_routes = {
    submit = { method = "POST", path = "/feedback", lambda = aws_lambda_function.feedback["submit"], protected = true }
    list   = { method = "GET", path = "/feedback", lambda = aws_lambda_function.feedback["list"], protected = false }
  }
}

resource "aws_apigatewayv2_integration" "feedback" {
  for_each               = local.feedback_routes
  api_id                 = aws_apigatewayv2_api.appointments.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.lambda.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "feedback" {
  for_each           = local.feedback_routes
  api_id             = aws_apigatewayv2_api.appointments.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.feedback[each.key].id}"
  authorization_type = each.value.protected ? "JWT" : "NONE"
  authorizer_id      = each.value.protected ? aws_apigatewayv2_authorizer.appointments_cognito.id : null
}

resource "aws_lambda_permission" "feedback" {
  for_each      = local.feedback_routes
  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.appointments.execution_arn}/*/*"
}

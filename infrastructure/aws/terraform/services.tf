# Services module: CRUD for the service catalog patients book against.
# Split into its own file (team convention). Routes are added to the
# *existing* Appointments HTTP API (declared in appointments.tf) rather than
# a new API Gateway -- the frontend calls /services through the same
# REACT_APP_APPOINTMENTS_API_URL axios instance as appointments
# (frontend/src/services/api.js), so a separate API would be unreachable.

data "archive_file" "services_lambdas" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend/services"
  output_path = "${path.module}/build/services-lambdas.zip"
  excludes    = ["__pycache__"]
}

locals {
  services_lambda_env = {
    SERVICES_TABLE_NAME = aws_dynamodb_table.services.name
  }

  services_handlers = {
    list   = "list_services.lambda_handler"
    get    = "get_service.lambda_handler"
    create = "create_service.lambda_handler"
    update = "update_service.lambda_handler"
  }
}

resource "aws_lambda_function" "services" {
  for_each         = local.services_handlers
  function_name    = "saws-services-${each.key}-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = each.value
  runtime          = "python3.12"
  timeout          = 10
  filename         = data.archive_file.services_lambdas.output_path
  source_code_hash = data.archive_file.services_lambdas.output_base64sha256

  environment {
    variables = local.services_lambda_env
  }
}

locals {
  services_routes = {
    list   = { method = "GET", path = "/services", lambda = aws_lambda_function.services["list"], protected = false }
    get    = { method = "GET", path = "/services/{serviceId}", lambda = aws_lambda_function.services["get"], protected = false }
    create = { method = "POST", path = "/services", lambda = aws_lambda_function.services["create"], protected = true }
    update = { method = "PUT", path = "/services/{serviceId}", lambda = aws_lambda_function.services["update"], protected = true }
  }
}

resource "aws_apigatewayv2_integration" "services" {
  for_each               = local.services_routes
  api_id                 = aws_apigatewayv2_api.appointments.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.lambda.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "services" {
  for_each           = local.services_routes
  api_id             = aws_apigatewayv2_api.appointments.id
  route_key          = "${each.value.method} ${each.value.path}"
  target             = "integrations/${aws_apigatewayv2_integration.services[each.key].id}"
  authorization_type = each.value.protected ? "JWT" : "NONE"
  authorizer_id      = each.value.protected ? aws_apigatewayv2_authorizer.appointments_cognito.id : null
}

resource "aws_lambda_permission" "services" {
  for_each      = local.services_routes
  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.appointments.execution_arn}/*/*"
}

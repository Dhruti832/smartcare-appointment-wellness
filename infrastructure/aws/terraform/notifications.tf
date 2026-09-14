# Notifications module: the SQS event queue, the SQS → Lambda → SNS pipeline,
# and the scheduled appointment-reminder rule. Split into its own file to keep
# the notifications module's infra isolated from other members' resources in
# main.tf (same pattern as auth.tf / dynamodb.tf).
#
# Flow: producers (auth register/login lambdas, appointments booking lambda)
# send events to SQS → the queue triggers process_notification → it publishes
# the templated message to SNS → the email subscriber receives it. The Sprint 1
# scaffold had this backwards (SQS subscribed *to* SNS); that subscription is
# gone and the queue now drives the Lambda via an event source mapping.

variable "notification_email" {
  description = "Email address subscribed to the SNS topic; receives all SAWS notifications"
}

# ── SQS (event queue — producers: auth + appointments modules) ────────────────
# A message that keeps failing (bad payload, a bug in the Lambda) would other-
# wise be retried until it expires and block the batch behind it, so after 3
# receives it is moved to the DLQ where it can be inspected instead.
resource "aws_sqs_queue" "appointments_dlq" {
  name                      = "saws-appointment-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days — long enough to debug after a demo
}

resource "aws_sqs_queue" "appointments" {
  name                       = "saws-appointment-queue-${var.environment}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.appointments_dlq.arn
    maxReceiveCount     = 3
  })
}

# ── SNS (user-facing notifications) ───────────────────────────────────────────
resource "aws_sns_topic" "notifications" {
  name = "saws-notifications-${var.environment}"
}

# The subscription must be confirmed once from the recipient's inbox before
# notifications arrive ("AWS Notification - Subscription Confirmation" email).
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

# ── process_notification Lambda (SQS-triggered) ───────────────────────────────
data "archive_file" "notification_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../backend/notifications"
  output_path = "${path.module}/build/notification-lambda.zip"
  excludes    = ["__pycache__"]
}

resource "aws_lambda_function" "process_notification" {
  function_name    = "saws-process-notification-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "process_notification.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.notification_lambda.output_path
  source_code_hash = data.archive_file.notification_lambda.output_base64sha256

  environment {
    variables = {
      SNS_TOPIC_ARN           = aws_sns_topic.notifications.arn
      APPOINTMENTS_TABLE_NAME = aws_dynamodb_table.appointments.name
    }
  }
}

resource "aws_lambda_event_source_mapping" "queue_to_notifier" {
  event_source_arn = aws_sqs_queue.appointments.arn
  function_name    = aws_lambda_function.process_notification.arn
  batch_size       = 10
}

# ── Appointment reminders (per-appointment, Sprint 3) ─────────────────────────
# The daily rule now invokes send_reminders, which reads the appointments table
# and enqueues one REMINDER per appointment scheduled for tomorrow. In Sprint 2
# the rule dropped a single static payload straight onto the queue, so every
# reminder email said "appointment N/A" no matter what was booked.
#
# Sprint 1 research (docs/sprint-reports/Module4-notifications.md §5) preferred
# per-appointment EventBridge *Scheduler* one-time schedules. This uses the
# documented alternative (a daily scan) because it needs no scheduler:* IAM on
# the Learner Lab LabRole, which cannot be modified — the same constraint that
# already forced the Comprehend → Google NL switch in the analytics module.
resource "aws_lambda_function" "send_reminders" {
  function_name    = "saws-send-reminders-${var.environment}"
  role             = data.aws_iam_role.lab_role.arn
  handler          = "send_reminders.lambda_handler"
  runtime          = "python3.12"
  timeout          = 60
  filename         = data.archive_file.notification_lambda.output_path
  source_code_hash = data.archive_file.notification_lambda.output_base64sha256

  environment {
    variables = {
      APPOINTMENTS_TABLE_NAME = aws_dynamodb_table.appointments.name
      NOTIFICATIONS_QUEUE_URL = aws_sqs_queue.appointments.url
      REMINDER_LEAD_DAYS      = "1"
    }
  }
}

# 12:00 UTC ≈ 09:00 Halifax, so reminders land the morning before the
# appointment rather than at whatever time the stack happened to be applied.
resource "aws_cloudwatch_event_rule" "appointment_reminder" {
  name                = "saws-appointment-reminder-${var.environment}"
  schedule_expression = "cron(0 12 * * ? *)"
}

resource "aws_cloudwatch_event_target" "reminder_scan" {
  rule = aws_cloudwatch_event_rule.appointment_reminder.name
  arn  = aws_lambda_function.send_reminders.arn
}

resource "aws_lambda_permission" "allow_eventbridge_invoke" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.send_reminders.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.appointment_reminder.arn
}

# ── Outputs (queue URL for producer modules, ARNs/URLs for evidence) ──────────
output "notifications_queue_url" {
  value = aws_sqs_queue.appointments.url
}

output "notifications_topic_arn" {
  value = aws_sns_topic.notifications.arn
}

output "notifications_dlq_url" {
  value = aws_sqs_queue.appointments_dlq.url
}

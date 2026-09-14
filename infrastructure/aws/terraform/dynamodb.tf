# Database module: the 6 DynamoDB tables owned by the database/API-contract
# scope (users profile, appointments, services, feedback, and the two audit
# log tables). Split into its own file to keep these resources isolated from
# other members' resources in main.tf (same pattern as auth.tf).
#
# Users table holds profile data only (name, contact info). Auth mechanics
# (security Q&A, Caesar cipher, session state) live in the authentication
# module's own UserSecurity/AuthSessions tables (auth.tf), joined on `username`.
resource "aws_dynamodb_table" "users" {
  name         = "saws-users-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "username"

  attribute {
    name = "username"
    type = "S"
  }
}

resource "aws_dynamodb_table" "appointments" {
  name         = "saws-appointments-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "appointmentId"

  # Feeds the cross-cloud mirror Lambda (appointments.tf): every booking or
  # status change is replicated into GCP Firestore off this stream.
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  attribute {
    name = "appointmentId"
    type = "S"
  }

  attribute {
    name = "patientUsername"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "date"
    type = "S"
  }

  global_secondary_index {
    name            = "patientUsername-index"
    hash_key        = "patientUsername"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "status-date-index"
    hash_key        = "status"
    range_key       = "date"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "services" {
  name         = "saws-services-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "serviceId"

  attribute {
    name = "serviceId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "feedback" {
  name         = "saws-feedback-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "feedbackId"

  # Feeds both the sentiment Lambda (analytics.tf) and the cross-cloud
  # export Lambda (feedback_export.tf). Flagged as required back when this
  # table was first added (see analytics.tf's original comment) but not
  # applied until the export Lambda needed it too.
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "feedbackId"
    type = "S"
  }

  attribute {
    name = "patientUsername"
    type = "S"
  }

  attribute {
    name = "serviceId"
    type = "S"
  }

  global_secondary_index {
    name            = "patientUsername-index"
    hash_key        = "patientUsername"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "serviceId-index"
    hash_key        = "serviceId"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "auth_logs" {
  name         = "saws-auth-logs-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "logId"

  attribute {
    name = "logId"
    type = "S"
  }

  attribute {
    name = "username"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "username-index"
    hash_key        = "username"
    range_key       = "createdAt"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "appointment_logs" {
  name         = "saws-appointment-logs-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "logId"

  attribute {
    name = "logId"
    type = "S"
  }

  attribute {
    name = "appointmentId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "appointmentId-index"
    hash_key        = "appointmentId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }
}

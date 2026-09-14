# Messaging module: Pub/Sub topic + push subscription and the two Cloud
# Functions (publisher + subscriber). Split into its own file to keep the
# messaging module's infra isolated from other members' resources in main.tf
# (same per-module pattern as the AWS side's auth.tf / notifications.tf).
#
# Flow: patient/chatbot → publishConcern (HTTP) → Pub/Sub topic → push
# subscription → handleMessage → Firestore communicationLogs (assigned to a
# random available coordinator, or UNASSIGNED when none are available).

# ── Pub/Sub ───────────────────────────────────────────────────────────────────
resource "google_pubsub_topic" "patient_concerns" {
  name = "saws-patient-concerns-${var.environment}"
}

resource "google_pubsub_subscription" "coordinator_sub" {
  name  = "saws-coordinator-subscription-${var.environment}"
  topic = google_pubsub_topic.patient_concerns.name

  ack_deadline_seconds = 30

  push_config {
    push_endpoint = google_cloudfunctions2_function.message_handler.service_config[0].uri
  }
}

# ── Function source bundle ────────────────────────────────────────────────────
# Both functions ship in one zip; each resource points at a different entry
# point. The hash in the object name forces a redeploy when the source changes.
data "archive_file" "messaging_functions" {
  type        = "zip"
  source_dir  = "${path.module}/../../../messaging/functions"
  output_path = "${path.module}/build/messaging-functions.zip"
  excludes    = ["node_modules"]
}

resource "google_storage_bucket_object" "messaging_source" {
  name   = "messaging/function-${data.archive_file.messaging_functions.output_md5}.zip"
  bucket = google_storage_bucket.functions.name
  source = data.archive_file.messaging_functions.output_path
}

# ── Subscriber: Pub/Sub push → assign coordinator → Firestore ────────────────
resource "google_cloudfunctions2_function" "message_handler" {
  name     = "saws-message-handler-${var.environment}"
  location = var.gcp_region

  build_config {
    runtime     = "nodejs20"
    entry_point = "handleMessage"
    source {
      storage_source {
        bucket = google_storage_bucket.functions.name
        object = google_storage_bucket_object.messaging_source.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "256M"
    timeout_seconds    = 60
  }

  # Needs both roles granted in main.tf on the default compute SA (build +
  # Firestore access) to exist before this can build/run successfully.
  depends_on = [
    google_project_iam_member.default_compute_cloudbuild_builder,
    google_project_iam_member.default_compute_datastore_user,
  ]
}

# ── Publisher: HTTP endpoint for the frontend form / chatbot ─────────────────
resource "google_cloudfunctions2_function" "publish_concern" {
  name     = "saws-publish-concern-${var.environment}"
  location = var.gcp_region

  build_config {
    runtime     = "nodejs20"
    entry_point = "publishConcern"
    source {
      storage_source {
        bucket = google_storage_bucket.functions.name
        object = google_storage_bucket_object.messaging_source.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "256M"
    timeout_seconds    = 30
    environment_variables = {
      CONCERNS_TOPIC = google_pubsub_topic.patient_concerns.name
    }
  }

  # Needs both roles granted in main.tf on the default compute SA (build +
  # Firestore access) to exist before this can build/run successfully.
  depends_on = [
    google_project_iam_member.default_compute_cloudbuild_builder,
    google_project_iam_member.default_compute_datastore_user,
  ]
}

# ── Reply endpoint: appends to the concern's message thread ──────────────────
# Used by both sides of the conversation (coordinator dashboard and patient
# view). Pub/Sub only routes the opening concern; replies go straight to the
# Firestore document, so no second topic is needed.
resource "google_cloudfunctions2_function" "post_reply" {
  name     = "saws-post-reply-${var.environment}"
  location = var.gcp_region

  build_config {
    runtime     = "nodejs20"
    entry_point = "postReply"
    source {
      storage_source {
        bucket = google_storage_bucket.functions.name
        object = google_storage_bucket_object.messaging_source.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "256M"
    timeout_seconds    = 30
  }

  # Needs both roles granted in main.tf on the default compute SA (build +
  # Firestore access) to exist before this can build/run successfully.
  depends_on = [
    google_project_iam_member.default_compute_cloudbuild_builder,
    google_project_iam_member.default_compute_datastore_user,
  ]
}

# Gen-2 functions are Cloud Run services under the hood, so invocation is
# gated by roles/run.invoker. Public for Sprint 2 (course scope); Sprint 3
# can switch the push subscription to OIDC auth.
resource "google_cloud_run_service_iam_member" "message_handler_invoker" {
  location = var.gcp_region
  service  = google_cloudfunctions2_function.message_handler.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "publish_concern_invoker" {
  location = var.gcp_region
  service  = google_cloudfunctions2_function.publish_concern.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "post_reply_invoker" {
  location = var.gcp_region
  service  = google_cloudfunctions2_function.post_reply.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "publish_concern_url" {
  value = google_cloudfunctions2_function.publish_concern.service_config[0].uri
}

output "post_reply_url" {
  value = google_cloudfunctions2_function.post_reply.service_config[0].uri
}

output "concerns_topic" {
  value = google_pubsub_topic.patient_concerns.name
}

# Chatbot module: the Dialogflow ES agent + fulfillment webhook Cloud Function.
# Split into its own file to keep the chatbot module's infra isolated from
# other members' resources in main.tf (same per-module pattern as the AWS
# side's auth.tf / notifications.tf, and this module's own messaging.tf).
#
# Flow: Dialogflow ES agent --webhook--> this function --> Firestore
# (appointments/services/faq reads) or, for SubmitConcern, an HTTP call to
# messaging's publishConcern function so concerns feed the same Pub/Sub ->
# coordinator-assignment flow as the frontend's concern form.

# ── Dialogflow ES agent ────────────────────────────────────────────────────────
resource "google_dialogflow_agent" "saws" {
  display_name          = "SAWS Assistant"
  default_language_code = "en"
  time_zone             = "America/Halifax"
}

# Intents/entities/training phrases have no Terraform resource (the
# provider's google_dialogflow_intent only manages top-level metadata, not
# training phrases) — those are loaded via `agent:import` against
# chatbot/dialogflow/, see chatbot/README.md. This resource only owns the
# webhook wiring.
resource "google_dialogflow_fulfillment" "saws" {
  display_name = "webhook"
  enabled      = true

  generic_web_service {
    uri = google_cloudfunctions2_function.chatbot_fulfillment.service_config[0].uri
  }

  depends_on = [google_dialogflow_agent.saws]
}

# ── Function source bundle ────────────────────────────────────────────────────
data "archive_file" "chatbot_functions" {
  type        = "zip"
  source_dir  = "${path.module}/../../../chatbot/functions"
  output_path = "${path.module}/build/chatbot-functions.zip"
  excludes    = ["node_modules"]
}

resource "google_storage_bucket_object" "chatbot_source" {
  name   = "chatbot/function-${data.archive_file.chatbot_functions.output_md5}.zip"
  bucket = google_storage_bucket.functions.name
  source = data.archive_file.chatbot_functions.output_path
}

# ── Fulfillment webhook ───────────────────────────────────────────────────────
resource "google_cloudfunctions2_function" "chatbot_fulfillment" {
  name     = "saws-chatbot-fulfillment-${var.environment}"
  location = var.gcp_region

  build_config {
    runtime     = "nodejs20"
    entry_point = "fulfillment"
    source {
      storage_source {
        bucket = google_storage_bucket.functions.name
        object = google_storage_bucket_object.chatbot_source.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "256M"
    timeout_seconds    = 60
    environment_variables = {
      # Wires SubmitConcern into the messaging module's Pub/Sub flow instead
      # of writing to Firestore `concerns` directly (see messaging.tf).
      PUBLISH_CONCERN_URL = google_cloudfunctions2_function.publish_concern.service_config[0].uri
    }
  }

  # Needs both roles granted in main.tf on the default compute SA (build +
  # Firestore access) to exist before this can build/run successfully.
  depends_on = [
    google_project_iam_member.default_compute_cloudbuild_builder,
    google_project_iam_member.default_compute_datastore_user,
  ]
}

# Gen-2 functions are Cloud Run services under the hood, so invocation is
# gated by roles/run.invoker. Public for Sprint 2 (course scope) — this is
# also what Dialogflow's webhook caller needs to reach it without auth setup.
resource "google_cloud_run_service_iam_member" "chatbot_fulfillment_invoker" {
  location = var.gcp_region
  service  = google_cloudfunctions2_function.chatbot_fulfillment.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "chatbot_fulfillment_url" {
  value = google_cloudfunctions2_function.chatbot_fulfillment.service_config[0].uri
}

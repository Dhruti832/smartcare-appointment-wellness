# Analytics module (Module 5): the feedback-mirror Cloud Function, the GCP
# half of the cross-cloud feedback pipeline (AWS Lambda export -> S3 CSV ->
# this function -> Firestore) described in architectural_decisions.md §9.
# Split into its own file, same per-module pattern as messaging.tf / chatbot.tf.

variable "feedback_export_shared_secret" {
  description = "Shared secret the AWS feedback-export Lambda sends as X-Export-Token; this function rejects requests without a match if set. Leave empty to accept unauthenticated requests (course-scope default, matches messaging.tf/chatbot.tf's public functions)."
  type        = string
  sensitive   = true
  default     = ""
}

data "archive_file" "analytics_functions" {
  type        = "zip"
  source_dir  = "${path.module}/../../../analytics/functions"
  output_path = "${path.module}/build/analytics-functions.zip"
  excludes    = ["node_modules"]
}

resource "google_storage_bucket_object" "analytics_source" {
  name   = "analytics/function-${data.archive_file.analytics_functions.output_md5}.zip"
  bucket = google_storage_bucket.functions.name
  source = data.archive_file.analytics_functions.output_path
}

resource "google_cloudfunctions2_function" "feedback_mirror" {
  name     = "saws-feedback-mirror-${var.environment}"
  location = var.gcp_region

  build_config {
    runtime     = "nodejs20"
    entry_point = "feedbackMirror"
    source {
      storage_source {
        bucket = google_storage_bucket.functions.name
        object = google_storage_bucket_object.analytics_source.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "256M"
    timeout_seconds    = 30
    environment_variables = {
      EXPORT_SHARED_SECRET = var.feedback_export_shared_secret
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
# gated by roles/run.invoker. Public for Sprint 2 (course scope, same as
# messaging.tf); the X-Export-Token check above is the actual gate.
resource "google_cloud_run_service_iam_member" "feedback_mirror_invoker" {
  location = var.gcp_region
  service  = google_cloudfunctions2_function.feedback_mirror.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "feedback_mirror_url" {
  value = google_cloudfunctions2_function.feedback_mirror.service_config[0].uri
}

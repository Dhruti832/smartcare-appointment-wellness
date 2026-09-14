# Appointments mirror (GCP half): the Cloud Function that receives the AWS
# appointments-export Lambda's presigned S3 URL, fetches the CSV, and writes it
# into Firestore's `appointments` collection for the chatbot to read. AWS half
# is backend/appointments/mirror_to_firestore.py + appointments.tf. Same keyless
# S3-presigned pattern as the feedback mirror (analytics.tf) -- used because
# Workload Identity Federation pool creation is blocked by org policy here.

variable "appointments_export_shared_secret" {
  description = "Shared secret the AWS appointments-mirror Lambda sends as X-Export-Token; this function rejects requests without a match if set. Leave empty to accept unauthenticated requests (course-scope default, matches analytics.tf)."
  type        = string
  sensitive   = true
  default     = ""
}

data "archive_file" "appointments_functions" {
  type        = "zip"
  source_dir  = "${path.module}/../../../appointments/functions"
  output_path = "${path.module}/build/appointments-functions.zip"
  excludes    = ["node_modules"]
}

resource "google_storage_bucket_object" "appointments_source" {
  name   = "appointments/function-${data.archive_file.appointments_functions.output_md5}.zip"
  bucket = google_storage_bucket.functions.name
  source = data.archive_file.appointments_functions.output_path
}

resource "google_cloudfunctions2_function" "appointments_mirror" {
  name     = "saws-appointments-mirror-${var.environment}"
  location = var.gcp_region

  build_config {
    runtime     = "nodejs20"
    entry_point = "appointmentsMirror"
    source {
      storage_source {
        bucket = google_storage_bucket.functions.name
        object = google_storage_bucket_object.appointments_source.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "256M"
    timeout_seconds    = 30
    environment_variables = {
      EXPORT_SHARED_SECRET = var.appointments_export_shared_secret
    }
  }

  # Needs both roles granted in main.tf on the default compute SA (build +
  # Firestore access) to exist before this can build/run successfully.
  depends_on = [
    google_project_iam_member.default_compute_cloudbuild_builder,
    google_project_iam_member.default_compute_datastore_user,
  ]
}

# Gen-2 functions are Cloud Run services under the hood, so invocation is gated
# by roles/run.invoker. Public for course scope (same as analytics.tf); the
# X-Export-Token check above is the actual gate.
resource "google_cloud_run_service_iam_member" "appointments_mirror_invoker" {
  location = var.gcp_region
  service  = google_cloudfunctions2_function.appointments_mirror.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "appointments_mirror_url" {
  value = google_cloudfunctions2_function.appointments_mirror.service_config[0].uri
}

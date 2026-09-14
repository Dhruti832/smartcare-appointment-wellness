# Data flow: AWS DynamoDB -> Firestore -> "Stream Firestore to BigQuery"
# Firebase Extension -> this dataset -> Looker Studio (public iframe).
#
# The Firebase Extension itself has no Terraform resource (installs via
# `firebase ext:install firestore-bigquery-export`, not Terraform/Deployment
# Manager) -- this file provisions everything Terraform can own: the dataset,
# and the permissions the extension needs to write into it. Extension install
# remains a manual one-time step (analytics/dashboards/looker-setup.md §1).

resource "google_bigquery_dataset" "saws_analytics" {
  dataset_id  = "saws_analytics"
  location    = var.gcp_region
  description = "Feedback + appointments data mirrored from AWS, read by the Looker Studio dashboard."
}

# Extension runs as the default compute service account (same as the
# chatbot/messaging Cloud Functions); needs write + job-run access.
resource "google_bigquery_dataset_iam_member" "extension_writer" {
  dataset_id = google_bigquery_dataset.saws_analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${local.default_compute_sa}"
}

resource "google_project_iam_member" "extension_job_user" {
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${local.default_compute_sa}"
}

output "bigquery_dataset_id" {
  value = google_bigquery_dataset.saws_analytics.dataset_id
}

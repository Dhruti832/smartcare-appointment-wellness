terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    # used by messaging.tf to zip the Cloud Function sources (a module may
    # only declare required_providers once, so it lives here)
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
  backend "gcs" {
    # Was "saws-terraform-state-gcp" -- that bucket doesn't exist. The real,
    # already-in-use state (Firestore, chatbot/messaging Cloud Functions)
    # lives in serverless-project-501905-tfstate; pointing here so
    # `terraform init` reaches the actual deployed resources instead of
    # starting a second, empty state.
    bucket = "serverless-project-501905-tfstate"
    prefix = "gcp/terraform.tfstate"
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region

  # Some APIs (Dialogflow ES among them) don't reliably pick up
  # quota_project_id from the ADC file when authenticating as a user
  # (authorized_user credentials from `gcloud auth application-default
  # login`) rather than a service account — these two force every request to
  # carry the right billing/quota project regardless.
  user_project_override = true
  billing_project       = var.gcp_project_id
}

variable "gcp_project_id" {}
variable "gcp_region" { default = "us-central1" }
variable "environment" { default = "dev" }

# ── Firestore (Native mode) ───────────────────────────────────────────────────
resource "google_firestore_database" "saws" {
  name        = "(default)"
  location_id = var.gcp_region
  type        = "FIRESTORE_NATIVE"
}

# Public read on communicationLogs (Sprint 2 course scope, same public-access
# pattern used for the chatbot webhook invoker and the frontend Cloud Run IAM
# member below) — the coordinator dashboard reads via the plain Firestore REST
# API + an API key, not an authenticated Firebase session, so rules scoped to
# a specific patient/coordinator wouldn't work against the code as written.
# Everything else stays default-denied.
resource "google_firebaserules_ruleset" "firestore" {
  project = var.gcp_project_id

  source {
    files {
      name    = "firestore.rules"
      content = <<-EOT
        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /communicationLogs/{docId} {
              allow read: if true;
              allow write: if false;
            }
            match /{document=**} {
              allow read, write: if false;
            }
          }
        }
      EOT
    }
  }
}

resource "google_firebaserules_release" "firestore" {
  project      = var.gcp_project_id
  name         = "cloud.firestore"
  ruleset_name = "projects/${var.gcp_project_id}/rulesets/${google_firebaserules_ruleset.firestore.name}"
}

# ── IAM: default compute SA needs these for Cloud Functions Gen2 + Firestore ──
# Newer GCP projects don't auto-grant either of these to the default compute
# SA, which is what our Gen2 functions run as (no custom runtime SA
# configured) and what Cloud Build uses to build them. Without
# cloudbuild.builds.builder, every google_cloudfunctions2_function resource
# fails to deploy at all; without datastore.user, a deployed function 500s on
# its first Firestore call (PERMISSION_DENIED). Discovered the hard way
# deploying chatbot.tf + messaging.tf against a fresh project.
#
# Built from the project number rather than
# data.google_compute_default_service_account, which requires the Compute
# Engine API to be enabled just to do the lookup — an API this project has no
# other reason to turn on.
data "google_project" "current" {
  project_id = var.gcp_project_id
}

locals {
  default_compute_sa = "${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "default_compute_cloudbuild_builder" {
  project = var.gcp_project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${local.default_compute_sa}"
}

resource "google_project_iam_member" "default_compute_datastore_user" {
  project = var.gcp_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${local.default_compute_sa}"
}

# ── Cloud Functions ───────────────────────────────────────────────────────────
# (chatbot's fulfillment function lives in module-owned chatbot.tf, messaging's
# Pub/Sub + functions live in module-owned messaging.tf — same per-module
# pattern as the AWS side's auth.tf / notifications.tf)

# ── Cloud Run (React Frontend) ────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "frontend" {
  name     = "saws-frontend-${var.environment}"
  location = var.gcp_region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "gcr.io/${var.gcp_project_id}/saws-frontend:latest"
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  # Image rollouts happen out-of-band, via
  #   gcloud run deploy saws-frontend-dev --image <repo>/saws-frontend:<git-sha>
  # against an immutable git-SHA tag rather than the mutable :latest above.
  #
  # A mutable tag can't roll anything out on its own: Cloud Run resolves the tag
  # to a digest when it creates a revision and pins the revision to that digest
  # permanently, so re-pushing :latest leaves the running revision serving the
  # old image. `terraform apply` doesn't rescue it either — it diffs the tag
  # *string*, which is unchanged, so it reports no drift and creates no
  # revision. Both steps report success and production stays stale. (This had
  # already happened: revision 00008 served digest 159034332218 while :latest
  # pointed at 00d7214b9481.)
  #
  # Ignoring image here keeps Terraform owning the service while the deploy
  # command owns the image. Otherwise the next apply by anyone — for any
  # unrelated GCP change — would read the deployed SHA tag as drift and revert
  # the service to :latest, rolling production back.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── GCS Bucket (Cloud Function source) ───────────────────────────────────────
resource "google_storage_bucket" "functions" {
  name     = "saws-functions-${var.gcp_project_id}-${var.environment}"
  location = var.gcp_region
  # required by the org policy constraints/storage.uniformBucketLevelAccess
  # on personal Google accounts; also the recommended default
  uniform_bucket_level_access = true
}

# Development Environment Setup

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Frontend + Cloud Functions |
| Python | 3.11+ | Lambda functions |
| AWS CLI | 2.x | Deploy to AWS |
| Terraform | 1.5+ | Infrastructure provisioning |
| Google Cloud SDK | latest | Deploy to GCP |
| Docker | 24+ | Build frontend container |

## AWS Setup

```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output (json)
```

## GCP Setup

```bash
gcloud auth login
gcloud config set project <YOUR_GCP_PROJECT_ID>
gcloud auth application-default login
```

## Frontend (Local)

```bash
cd frontend
cp .env.example .env   # fill in API URLs and Cognito config
npm install
npm start
```

## Backend (Local Testing)

```bash
cd backend/auth
pip install -r requirements.txt
pytest ../../tests/auth/ -v
```

## Infrastructure (Terraform)

```bash
cd infrastructure/aws/terraform
terraform init
terraform plan
terraform apply

cd ../../gcp/terraform
terraform init
terraform plan
terraform apply
```

## Environment Variables

Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in:

```hcl
gcp_project_id = "your-gcp-project-id"
environment    = "dev"
```

## Integration Environment

The team deploys into **one shared environment**, not a personal copy per member. Every
Terraform resource name is suffixed `-${var.environment}` (e.g. `saws-appointments-mirror-dev`),
so two people applying with `environment = "dev"` against the same cloud accounts converge on the
same resources rather than colliding — that only works if everyone points at the same accounts
and the same remote state, not just the same environment string.

- **AWS**: Learner Lab account this team shares, region `us-east-1`. State: S3 bucket
  `saws-terraform-state`, key `aws/terraform.tfstate` (see `infrastructure/aws/terraform/main.tf`
  `backend "s3"` block). No `terraform.tfvars` is committed (only `.example`) — get the real
  values (notably `google_api_key` and, once the feedback mirror is live, the GCP-side URLs
  below) from the team rather than inventing your own.
- **GCP**: project `serverless-project-501905`, region `us-central1` — already committed in
  `infrastructure/gcp/terraform/terraform.tfvars`, don't create a second project. State: GCS
  bucket `saws-terraform-state-gcp`, prefix `gcp/terraform.tfstate` (`main.tf` `backend "gcs"`
  block).
- **Branch convention** (README "Branching Strategy"): work in `feature/<module-name>`, merge to
  `develop` — the integration branch — before `main`. Point local `.env` / `terraform.tfvars`
  files at what's actually deployed from `develop`, not at a locally-applied one-off stack, so
  the whole team is testing against the same live endpoints.

### Cross-cloud variable hand-off

Both mirrors (`architecture-diagram.md`) need a value produced by one Terraform tree fed into the
other's `terraform.tfvars` — apply in this order:

1. `infrastructure/gcp/terraform`: `terraform apply`, then note the outputs
   `feedback_mirror_url` and (for the appointments mirror) the Workload Identity Federation
   config from `gcloud iam workload-identity-pools create-cred-config --aws` (one-time GCP-side
   setup, not a Terraform output).
2. `infrastructure/aws/terraform`: set `gcp_workload_identity_config`, `gcp_project_id`,
   `gcp_feedback_mirror_url`, and (if `feedback_export_shared_secret` was set on the GCP side)
   `gcp_feedback_mirror_shared_secret` in `terraform.tfvars`, then `terraform apply`.

Both mirror Lambdas deploy fine with these left blank (default `""`) — they just skip the GCP
notify/write step and log why, rather than failing. See `feedback_export.tf` /
`appointments.tf`.

## Frontend Deployment (Cloud Run)

The React frontend runs as a container on Cloud Run (`saws-frontend-dev`, `us-central1`).
Merging to `develop` is **not** enough on its own — the image has to be rebuilt and a new
revision created.

### Automatic (preferred)

`.gitlab-ci.yml`'s `deploy-frontend-cloudrun` job runs on every merge to `develop`: it builds
through Cloud Build (`frontend/cloudbuild.yaml`) and deploys the result. Nothing to run by hand.

It builds via Cloud Build rather than Docker on the runner because Docker-in-Docker needs a
privileged runner, which shared runners generally don't allow.

#### Authentication: Workload Identity Federation (keyless)

There is **no service account key**, and don't try to make one — the Dal organization this
project sits under enforces `constraints/iam.disableServiceAccountKeyCreation`, so
`gcloud iam service-accounts keys create` fails with `FAILED_PRECONDITION`.

Instead GitLab mints a short-lived OIDC token for each job and GCP exchanges it for
credentials. Nothing long-lived is stored anywhere. This works because `git.cs.dal.ca` serves a
publicly reachable OIDC discovery document, so Google can fetch its signing keys to validate the
token.

`infrastructure/gcp/gitlab-wif-config.json` is committed deliberately — it contains only the
pool/provider audience and which service account to impersonate, no credentials.

The GCP side is already provisioned. For reference, it was created with:

```bash
PROJECT=serverless-project-501905
PROJECT_NUM=5543570102
SA_EMAIL=saws-ci-deployer@$PROJECT.iam.gserviceaccount.com
REPO=hpilli/csci5410-smartcare-appointment-and-wellness

gcloud iam service-accounts create saws-ci-deployer \
  --display-name "GitLab CI frontend deployer" --project $PROJECT

for ROLE in roles/run.admin roles/cloudbuild.builds.editor roles/storage.admin \
            roles/artifactregistry.writer roles/iam.serviceAccountUser roles/logging.viewer; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:$SA_EMAIL" --role="$ROLE" --condition=None
done

gcloud services enable sts.googleapis.com --project $PROJECT

gcloud iam workload-identity-pools create gitlab-pool \
  --location=global --display-name="Dal GitLab CI" --project $PROJECT

# The attribute-condition is the security boundary: without it any project on
# git.cs.dal.ca could mint a token this provider would accept.
gcloud iam workload-identity-pools providers create-oidc gitlab-provider \
  --location=global --workload-identity-pool=gitlab-pool --project $PROJECT \
  --issuer-uri="https://git.cs.dal.ca" \
  --attribute-mapping="google.subject=assertion.sub,attribute.project_path=assertion.project_path,attribute.ref=assertion.ref,attribute.ref_type=assertion.ref_type" \
  --attribute-condition="assertion.project_path=='$REPO'"

gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL --project $PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUM/locations/global/workloadIdentityPools/gitlab-pool/attribute.project_path/$REPO"
```

#### GitLab CI/CD variables

In GitLab → **Settings → CI/CD → Variables**, add:

| Variable | Value | Flags |
|---|---|---|
| `GCP_PROJECT_ID` | `serverless-project-501905` | Protected |
| `REACT_APP_AUTH_API_URL` | auth API Gateway endpoint | Protected |
| `REACT_APP_APPOINTMENTS_API_URL` | appointments API Gateway endpoint | Protected |
| `REACT_APP_PUBLISH_CONCERN_URL` | `publish_concern_url` output | Protected |
| `REACT_APP_POST_REPLY_URL` | `post_reply_url` output | Protected |
| `REACT_APP_DF_AGENT_ID` | Dialogflow Messenger agent id (may be blank) | Protected |
| `REACT_APP_GCP_PROJECT_ID` | `serverless-project-501905` | Protected |
| `REACT_APP_FIREBASE_API_KEY` | Firebase browser key | Protected, Masked |
| `REACT_APP_LOOKER_REPORT_URL` | Looker Studio `/embed/` URL | Protected |

Every `REACT_APP_*` value is required because Create React App inlines them into the JS bundle
at build time (`frontend/Dockerfile`); they are not runtime env vars, and `.dockerignore` keeps
`.env` files out of the build context. A missing one still builds and deploys cleanly and then
fails every API call in production — so `cloudbuild.yaml` checks for them up front and fails the
build instead. `REACT_APP_DF_AGENT_ID` and `REACT_APP_POST_REPLY_URL` are the two allowed to be
blank; both features feature-detect and render nothing when unset.

**The AWS endpoints expire.** They come from a Learner Lab, so the API Gateway ids change
whenever that lab session rotates — the deployed frontend keeps pointing at the old ones and
every services/feedback call 404s, with no visible error beyond empty pages. `cloudbuild.yaml`'s
`check-api-endpoints` step probes `/services` and `/auth/me` before building and fails the job
with a clear message rather than shipping a broken site, but recovering still means getting the
current URLs from the AWS module owner, updating `REACT_APP_AUTH_API_URL` /
`REACT_APP_APPOINTMENTS_API_URL` in the CI variables, and retrying the job.

Because of this, re-run the deploy and check the live site shortly **before** any demo or
recording — don't rely on a build from days earlier.

### Manual deploy (fallback)

```bash
cd frontend
set -a; source .env; set +a          # or export each REACT_APP_* by hand
TAG=$(git rev-parse --short HEAD)
IMG=gcr.io/serverless-project-501905/saws-frontend

docker build \
  --build-arg REACT_APP_AUTH_API_URL="$REACT_APP_AUTH_API_URL" \
  --build-arg REACT_APP_APPOINTMENTS_API_URL="$REACT_APP_APPOINTMENTS_API_URL" \
  --build-arg REACT_APP_PUBLISH_CONCERN_URL="$REACT_APP_PUBLISH_CONCERN_URL" \
  --build-arg REACT_APP_POST_REPLY_URL="$REACT_APP_POST_REPLY_URL" \
  --build-arg REACT_APP_DF_AGENT_ID="$REACT_APP_DF_AGENT_ID" \
  --build-arg REACT_APP_GCP_PROJECT_ID="$REACT_APP_GCP_PROJECT_ID" \
  --build-arg REACT_APP_FIREBASE_API_KEY="$REACT_APP_FIREBASE_API_KEY" \
  --build-arg REACT_APP_LOOKER_REPORT_URL="$REACT_APP_LOOKER_REPORT_URL" \
  -t "$IMG:$TAG" -t "$IMG:latest" .

docker push "$IMG:$TAG" && docker push "$IMG:latest"
gcloud run deploy saws-frontend-dev --image "$IMG:$TAG" --region us-central1
```

### Why the SHA tag matters

Deploy by immutable commit-SHA tag, never `:latest` alone. Cloud Run resolves a tag to a digest
when it creates a revision and pins the revision to that digest permanently, so re-pushing
`:latest` leaves the running revision serving the old image — and `terraform apply` doesn't
rescue it either, because it diffs the unchanged tag *string*, finds no drift, and creates no
revision. Build, push and apply all report success while production stays stale. This is why the
frontend service carries `ignore_changes` on its image in
`infrastructure/gcp/terraform/main.tf`: Terraform owns the service, the deploy owns the image.

### Verifying a deploy

```bash
gcloud run services describe saws-frontend-dev --region us-central1 \
  --format="value(status.url, status.latestReadyRevisionName)"
```

Then load `<url>/feedback` **directly** and refresh — a 200 rather than a 404 confirms the newer
image is live, since the nginx SPA fallback only exists in the current `Dockerfile`. To be
certain, fetch the served bundle and grep it for a string you just changed.

Rollback is instant — old revisions are retained:

```bash
gcloud run services update-traffic saws-frontend-dev \
  --to-revisions <older-revision>=100 --region us-central1
```

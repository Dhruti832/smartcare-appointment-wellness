# Analytics Module — Feedback Mirror (GCP half)

GCP half of the cross-cloud feedback pipeline: AWS `export_feedback_csv.py`
(`backend/feedback`) exports a scored feedback row to S3 as CSV and hands this Cloud
Function a short-lived presigned URL; this function fetches it and writes the row into
Firestore. See `docs/architecture/architecture-diagram.md` §2 for the full sequence
diagram, and `docs/architecture/architectural_decisions.md` §9 for why this needs the
extra S3 hop that the appointments mirror doesn't.

```
DynamoDB (saws-feedback)
      │  Stream: INSERT
      ▼
analyze_sentiment Lambda (Google NL API) ──UpdateItem──▶ DynamoDB (sentimentLabel set)
      │  Stream: MODIFY, now scored
      ▼
export_feedback_csv Lambda
      │  PutObject CSV, then POST {feedbackId, presigned csvUrl}
      ▼
feedbackMirror Cloud Function (this module)
      │  GET csvUrl → parse → set(merge=true)
      ▼
Firestore `feedback` collection
```

## What's covered by automated tests (no deployment needed)

```sh
cd analytics/functions
npm install
npm test
```

`test/feedback_row.test.js` proves the CSV bytes the AWS Lambda writes parse into the
exact Firestore document shape `analytics/dashboards/seed_data.js` and
`analytics/dashboards/looker-setup.md` already assume — the "read hop" contract. It does
**not** exercise the real HTTPS fetch or the real Firestore write; those only happen once
deployed.

## Deploy

Prereqs: `gcloud` CLI authenticated, the same GCP project/APIs as `messaging/README.md`.

```sh
cd infrastructure/gcp/terraform
terraform apply -var="gcp_project_id=<project-id>"
```

Note the `feedback_mirror_url` output, then set it (plus `google_api_key` for the
sentiment Lambda) in `infrastructure/aws/terraform/terraform.tfvars` and apply that tree
too — see `docs/architecture/setup.md` § "Integration Environment" for the full
cross-cloud apply order.

## Test end to end (proves the real round trip, not just the code)

There is no `/feedback` submission endpoint yet (`backend/feedback` only has the
sentiment/export Lambdas), so trigger the pipeline by inserting a row directly:

```sh
aws dynamodb put-item --table-name saws-feedback-dev --item '{
  "feedbackId":       {"S": "FB-TEST-1"},
  "patientUsername":  {"S": "test-patient"},
  "appointmentId":    {"S": "APT-TEST-1"},
  "serviceId":        {"S": "svc-001"},
  "feedbackText":     {"S": "Testing the cross-cloud pipeline end to end."},
  "createdAt":        {"S": "2026-07-23"}
}'
```

Then verify, in order:

1. **`saws-analyze-sentiment-dev` CloudWatch logs** — `Scored feedback FB-TEST-1: ...`
   (confirms the sentiment Lambda ran and wrote `sentimentLabel` back).
2. **`saws-feedback-export-dev` CloudWatch logs** — no `FEEDBACK_EXPORT_BUCKET not set`
   / `GCP_MIRROR_FUNCTION_URL not set` warnings (confirms both tfvars were actually
   applied, not left at their inert `""` defaults).
3. **S3** — `aws s3 ls s3://saws-feedback-export-dev-<account-id>/feedback/` shows
   `FB-TEST-1.csv`.
4. **GCP Cloud Function logs** —
   `gcloud functions logs read saws-feedback-mirror-dev --region=us-central1` shows
   `Mirrored feedback FB-TEST-1 to Firestore`.
5. **Firestore console** — `feedback/FB-TEST-1` doc exists with `sentimentScore`,
   `sentimentMagnitude`, `sentimentLabel` as numbers/string (not strings-that-look-like-numbers —
   this is the thing the CSV round trip could plausibly get wrong).

If step 5 doesn't match, the bug is almost certainly in step 3→4 (CSV parsing/typing),
since steps 1-2 are already covered by the automated tests above.

## Interfaces

- **AWS (feedback export):** `backend/feedback/export_feedback_csv.py`,
  `infrastructure/aws/terraform/feedback_export.tf`.
- **Shared Firestore collection:** `feedback` — also read by Looker Studio via the
  BigQuery export (`analytics/dashboards/looker-setup.md`).

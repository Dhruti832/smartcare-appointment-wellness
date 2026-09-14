# Looker Studio Dashboard — Setup & Configuration

Coordinator-facing analytics dashboard for SAWS, sourced from Firestore via BigQuery.

> **Live dashboard link:** https://lookerstudio.google.com/reporting/4484ec35-5a33-4268-a34e-12e21bd12ffa
> **Embed URL (for the frontend iframe / `REACT_APP_LOOKER_REPORT_URL`):**
> https://lookerstudio.google.com/embed/reporting/4484ec35-5a33-4268-a34e-12e21bd12ffa
>
> Built on the shared project **`serverless-project-501905`**. The previous report (`c7da8f52-…`)
> was bound to the old project's BigQuery and no longer resolves — this one replaces it.
>
> Sharing is set to **"Anyone with the link can view"** — the dashboard is required to be visible
> to *all* user types including guests, and that is the reason Looker Studio was chosen over
> QuickSight (anonymous viewing is a paid feature there).

---

## 1. Data source: Firestore → BigQuery

Looker Studio does not read Firestore directly, so both collections are streamed to BigQuery and
Looker connects to BigQuery. Both arrive in Firestore via the AWS→GCP mirror: feedback (with the
sentiment fields the sentiment Lambda writes) and appointments both originate in AWS DynamoDB —
see `docs/architecture/architectural_decisions.md` §9.

### 1.1 Stream Firestore → BigQuery (Firebase extension)

Install the Firebase **Stream Firestore to BigQuery** extension once per collection — `feedback`
and `appointments`, both into dataset `saws_analytics`, table IDs `feedback` / `appointments`.
Requires the Blaze plan (already active on this project). Each install creates a
`<name>_raw_changelog` table and a `<name>_raw_latest` view.

Two non-obvious things this project needs, both learned during setup:

- **Set every location to `us-central1`.** Cloud Functions location, BigQuery dataset location,
  and especially **Firestore Instance Location** — it defaults to the `nam5` multi-region and
  fails the install with *"Database '(default)' does not exist in region 'nam5'"*, because this
  project's Firestore lives in `us-central1`.
- **Grant the extension's function `run.invoker`.** On a fresh, locked-down project the default
  compute service account is not auto-granted it, so Eventarc delivers the document events but
  every invocation is rejected (`The IAM principal lacks run.routes.invoke permission`) and
  nothing reaches BigQuery. One-time fix (same class of gap as the `cloudbuild`/`datastore` grants
  in `infrastructure/gcp/terraform/main.tf`):

  ```bash
  PROJECT_NUMBER=$(gcloud projects describe serverless-project-501905 --format="value(projectNumber)")
  gcloud projects add-iam-policy-binding serverless-project-501905 \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/run.invoker"
  ```

**Backfill caveat:** the extension only streams *changes*. A write with byte-identical content
emits no change event, so re-running the seed does not re-stream appointments (whose fields are
static) — only feedback, whose `createdAt` changes each run. To backfill existing docs, touch each
with a changing field (the setup wrote a `syncedAt` timestamp onto every appointment doc).

### 1.2 Flatten the raw views for Looker

The extension stores each document as a single JSON string in a `data` column, not as typed
columns — so Looker can't chart `sentimentLabel` / `status` / `service` directly. These two views
expose the fields as real columns (and convert Firestore timestamps). Looker reads **these**, not
`_raw_latest`. The appointments view also drops the chatbot's hand-seeded `APT-DEMO-1` test doc,
which carries a non-schema `CONFIRMED` status and a `Sports Physiotherapy` service.

```sql
CREATE OR REPLACE VIEW `serverless-project-501905.saws_analytics.feedback_dashboard` AS
SELECT
  JSON_VALUE(data, "$.feedbackId")     AS feedbackId,
  JSON_VALUE(data, "$.patientUsername") AS patientUsername,
  JSON_VALUE(data, "$.serviceId")      AS serviceId,
  JSON_VALUE(data, "$.feedbackText")   AS feedbackText,
  CAST(JSON_VALUE(data, "$.sentimentScore")     AS FLOAT64) AS sentimentScore,
  CAST(JSON_VALUE(data, "$.sentimentMagnitude") AS FLOAT64) AS sentimentMagnitude,
  JSON_VALUE(data, "$.sentimentLabel") AS sentimentLabel,
  DATE(TIMESTAMP_SECONDS(CAST(JSON_VALUE(data, "$.createdAt._seconds") AS INT64))) AS createdAt
FROM `serverless-project-501905.saws_analytics.feedback_raw_latest`
WHERE data IS NOT NULL;

CREATE OR REPLACE VIEW `serverless-project-501905.saws_analytics.appointments_dashboard` AS
SELECT
  JSON_VALUE(data, "$.refCode") AS refCode,
  SAFE_CAST(JSON_VALUE(data, "$.date") AS DATE) AS date,
  JSON_VALUE(data, "$.service") AS service,
  JSON_VALUE(data, "$.status")  AS status
FROM `serverless-project-501905.saws_analytics.appointments_raw_latest`
WHERE data IS NOT NULL AND JSON_VALUE(data, "$.refCode") != "APT-DEMO-1";
```

### 1.3 Fallback — manual export (no extension)

`gcloud firestore export gs://<bucket>/exports/$(date +%F)` → `bq load` also works, but needs
`roles/datastore.importExportAdmin` (Editor is not enough — this blocked the first attempt). Use
only if the extension route is unavailable.

---

## 2. Report structure (required: 1 table + 2 charts)

Create a new Looker Studio report and add both `_dashboard` views (§1.2) as BigQuery data sources.

### 2.1 Feedback table
- **Chart type:** Table
- **Source:** `saws_analytics.feedback_dashboard`
- **Columns:** `patientUsername`, `serviceId`, `feedbackText`, `sentimentLabel`, `sentimentScore`, `createdAt`
- **Sort:** `createdAt` descending
- Optional: conditional formatting on `sentimentLabel` (green POSITIVE / grey NEUTRAL / red NEGATIVE).

### 2.2 Appointment statistics chart
- **Chart type:** Column (or time-series)
- **Source:** `saws_analytics.appointments_dashboard`
- **Dimension:** `status` (optionally break down by `date`)
- **Metric:** Record Count
- Shows the PENDING / APPROVED / REJECTED / CANCELLED distribution.

### 2.3 Service-popularity chart
- **Chart type:** Bar or Pie
- **Source:** `saws_analytics.appointments_dashboard`
- **Dimension:** `service`
- **Metric:** Record Count
- Ranks the most-booked wellness services.

### 2.4 Login statistics + total registered patients (Sprint 3)
- **Login-trend chart:** time-series on `login_events`, dimension `DATE(timestamp)`, metric
  Record Count.
- **Total registered patients scorecard:** `COUNT(DISTINCT username) WHERE role = 'Patient'`
  on `login_events`.
- Both were out of scope in Sprint 2 (login data lived only in AWS `saws-auth-logs`); the
  cross-cloud mirror now carries login events into the `login_events` table, so these are in
  scope. Until the live mirror is streaming, the `login_events` table is populated from the
  seed data (§3).

### 2.5 KPI scorecards (nice-to-have)
- Total feedback (Record Count on `feedback_dashboard`).
- % positive (`sentimentLabel = POSITIVE` ÷ total).
- Total appointments (Record Count on `appointments_dashboard`).

> Validated SQL for the §2.4 login/patients charts lives in
> [`dashboard_queries.sql`](dashboard_queries.sql) — each becomes a Looker Studio
> "Custom Query" BigQuery data source, added to the existing report (top of this file). The
> feedback/appointments charts in §2.1–2.3 already exist there, built directly on the
> `_dashboard` views rather than a custom query.

---

## 3. Seeding data for the demo

Check whether the live mirror has already populated the collections before seeding — if `feedback`
and `appointments` hold real rows, skip this step rather than mixing seed docs into real data.

Authentication is Application Default Credentials, not a service-account key file: the shared
project blocks service-account key creation by org policy, and the appointments mirror uses
keyless Workload Identity Federation for the same reason.

```bash
gcloud auth application-default login
cd analytics/dashboards && npm install     # seed_data.js needs @google-cloud/firestore
GCLOUD_PROJECT=serverless-project-501905 npm run seed
```

The seed feedback docs already include the flat `sentimentScore`/`sentimentMagnitude`/`sentimentLabel`
fields, so the charts render without the live pipeline. For real scores end to end, submit feedback
through the AWS `/feedback` endpoint — the sentiment Lambda (`backend/feedback/analyze_sentiment.py`)
scores it via the **Google Natural Language API** and writes those fields back into the same
DynamoDB row, and the mirror copies them to Firestore. (Comprehend was the original choice but the
Learner Lab `LabRole` is not authorized for `comprehend:DetectSentiment`.)

The Natural Language API must be enabled in the project and an API key issued for it — that key is
supplied to the AWS side as `google_api_key` in `infrastructure/aws/terraform/terraform.tfvars`:

```bash
gcloud services enable language.googleapis.com
```

### 3.1 Login events → BigQuery (Sprint 3)

The Firestore→BigQuery extension (§1.1) is installed only for `feedback` and `appointments`, so
the `login_events` table the login-stats charts (§2.4) read is loaded into BigQuery directly from
the seed CSV rather than streamed through Firestore:

```bash
bq load --project_id=serverless-project-501905 --source_format=CSV \
  --skip_leading_rows=1 --autodetect --replace \
  saws_analytics.login_events analytics/dashboards/login_events_seed.csv
```

`npm run seed` also writes the same rows into the Firestore `loginEvents` collection, so once the
cross-cloud mirror carries login events across (login data currently lives only in AWS
`saws-auth-logs`), a `loginEvents` extension instance can replace this direct load.

---

## 4. Sharing & evidence

1. **Share** → Manage access → "Anyone with the link can view". Paste the URL at the top of this file.
2. Capture for the sprint report:
   - Screenshot of the full dashboard.
   - Screenshot of a `feedback` doc in the Firestore console showing the flat `sentimentScore` /
     `sentimentMagnitude` / `sentimentLabel` fields.
   - Screenshot of the `saws_analytics` dataset in BigQuery (`bq ls saws_analytics`).

# Analytics Module (Module 5) — Feedback Sentiment & Dashboard

Scores patient feedback for sentiment and surfaces analytics in a public Looker Studio dashboard.

This module spans both clouds, which is easy to misread from the folder name — **the sentiment
code does not live here.** Only the GCP/dashboard half does.

## Where the pieces actually are

| Piece | Location | Cloud |
|---|---|---|
| Sentiment Lambda | [`backend/feedback/analyze_sentiment.py`](../backend/feedback/analyze_sentiment.py) | AWS |
| Its Terraform | [`infrastructure/aws/terraform/analytics.tf`](../infrastructure/aws/terraform/analytics.tf) | AWS |
| Dashboard spec + setup | [`dashboards/looker-setup.md`](dashboards/looker-setup.md) | GCP |
| Firestore seed data | [`dashboards/seed_data.js`](dashboards/seed_data.js), `*_seed.csv` | GCP |

## Flow

```
feedback submitted  →  saws-feedback (DynamoDB, AWS)
                            │ stream: INSERT
                            ▼
                   analyze_sentiment Lambda ──HTTPS──► Google Natural Language API
                            │ UpdateItem: sentimentScore / sentimentMagnitude / sentimentLabel
                            ▼
                   saws-feedback (same row, now scored)
                            │ cross-cloud mirror
                            ▼
                   Firestore  →  BigQuery (saws_analytics)  →  Looker Studio  →  embedded in the app
```

Appointments reach Firestore the same way, via the mirror in
[`backend/appointments/mirror_to_firestore.py`](../backend/appointments/mirror_to_firestore.py).

## Two decisions worth knowing before you change anything

**Sentiment runs on AWS, not GCP.** Sprint 1 planned a GCP Cloud Function writing to Firestore;
Sprint 2 reversed it (`docs/architecture/architectural_decisions.md` §9) because feedback is
tightly coupled to users/appointments/services, which all live in DynamoDB. Scoring happens where
the data is, and only the result crosses to GCP. The old `analytics/sentiment/` function was
deleted, not moved — don't resurrect it from the Sprint 2 brief, which predates the reversal.

**The engine is the Google Natural Language API, not AWS Comprehend.** The Learner Lab `LabRole`
is not authorized for `comprehend:DetectSentiment` and policies cannot be attached to it, so
Comprehend is a dead end in this account. The Lambda calls Google's REST endpoint with an API key
(`google_api_key` in the AWS `terraform.tfvars`), which needs no AWS permission — just outbound
internet.

## Setup

Dashboard setup, seeding, and the Firestore→BigQuery pipeline are all in
[`dashboards/looker-setup.md`](dashboards/looker-setup.md). Shared GCP project:
`serverless-project-501905`.

## Known gaps

- **Login-statistics chart** is deferred to Sprint 3 — login events live in AWS `saws-auth-logs`
  and are not mirrored to GCP.
- **Guest visibility.** The dashboard is required to be visible to all user types, and free
  anonymous viewing is why Looker Studio was chosen over QuickSight — but the embed currently
  only appears on the role-guarded coordinator dashboard
  (`frontend/src/pages/CoordinatorDashboard.jsx`), not the guest page.

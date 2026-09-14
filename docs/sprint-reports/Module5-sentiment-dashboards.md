# Sprint 1 Research – Sentiment Analysis and Dashboards (Module 5)


**Services researched:** AWS Comprehend, Google Natural Language API, Looker Studio, Amazon QuickSight, BigQuery (supporting service)

> **Sprint 4 bug fix (2026-08-06):** a Sprint 4 bug report flagged that
> sentiment analysis had never produced a single result on any feedback,
> ever — no score, magnitude, or label on any entry going back weeks,
> including a fresh test submission. Investigated against the team's shared
> AWS account (`992138250317`, confirmed canonical — its `auth_api_endpoint`
> Terraform output matches the URL already hardcoded in `frontend/.env`) and
> found the actual root cause: **the entire feedback/analytics module (and
> appointments, and the mirror Lambda) had never been deployed to that
> account at all.** `terraform state list` showed only auth + frontend +
> a bare notifications topic — 46 resources total, none of them
> `analyze_sentiment`, `feedback`, or `appointments`. Not a code bug; the
> module was simply never applied.
>
> Fix: created a real, API-restricted Google Natural Language API key on the
> shared GCP project (`serverless-project-501905`, `language.googleapis.com`
> only) and ran `terraform apply` for the full config —
> **83 resources added, 8 changed in-place (non-destructive), 1 destroyed**
> (a documented dead-code cleanup from the Sprint 1 SNS/SQS scaffold,
> unrelated to this fix and confirmed safe via the plan output before
> applying). No code changes were needed in `analyze_sentiment.py` — the
> logic was already correct once it was actually running.
>
> Verified live, not just deployed: inserted a real feedback row directly
> into `saws-feedback-dev` and confirmed the DynamoDB Stream → Lambda →
> Google Natural Language API pipeline scored it within seconds
> (`sentimentLabel: POSITIVE`, `sentimentScore: 0.9`,
> `sentimentMagnitude: 0.9`), confirmed independently via CloudWatch logs
> (`Scored feedback sentiment-test-...: POSITIVE (0.9)`). Test row deleted
> afterward. Checked for pre-existing feedback needing a sentiment backfill —
> table was empty before this deploy, so none was needed; whatever feedback
> the original bug report tested against must have been in a different,
> non-canonical environment.
>
> Side effect worth flagging: this same `apply` also stood up appointments,
> the AWS→Firestore mirror, and notifications for the first time in this
> account — likely relevant to other Sprint 4 bug items beyond this module.

---

## 1. Feedback Sentiment Analysis

### 1.1 What we need to build

When a patient submits feedback, the backend has to automatically run sentiment analysis on it using either AWS Comprehend or Google Natural Language API, and the result has to be visible in the frontend to all user types.

### 1.2 Comprehend vs Google Natural Language

| | AWS Comprehend | Google Natural Language API |
|---|---|---|
| Output | Label (POSITIVE/NEGATIVE/NEUTRAL/MIXED) + confidence | Score from -1.0 to +1.0 + magnitude |
| Free tier | 50K units/month, first 12 months only | 5K units/month, permanent |
| Fits our system | AWS side – results would need an extra hop to GCP | GCP side – results go straight to Firestore |

Both APIs come down to a single SDK call with the feedback text, so the API itself is not the deciding factor. What decides it is where the results need to live: our dashboards and frontend read feedback from Firestore on the GCP side. If we used Comprehend, the result would have to travel from AWS over to GCP, which means a second cross-cloud transfer on top of the appointment mirror we already have. We want to keep cross-cloud traffic to that one seam, so Google Natural Language API is the better fit.

### 1.3 Flow

```
React frontend (feedback form)
     |
     v
GCP Cloud Function (HTTP trigger)
     |--> Natural Language API: analyzeSentiment(text)
     v
Firestore: { feedbackText, score, magnitude, label, serviceId, createdAt }
     |
     v
Frontend shows the label next to each feedback entry
```

### 1.4 Score to label mapping

The API returns a number, but the UI needs a word, so we map it ourselves:

- score > 0.25 -> Positive
- -0.25 to 0.25 -> Neutral
- score < -0.25 -> Negative

These thresholds follow Google's own interpretation guide and we can tune them once we test with real feedback samples. We store both the raw score (useful for averages on the dashboard) and the label (for the feedback table).

### 1.5 Notes

- One unit covers 1,000 characters of text, so the 5K free units per month is way more than a class project will ever use.
- The Cloud Function gets a service account with only the `Cloud Natural Language API User` role and nothing broader. The key must never be committed to GitLab.

---

## 2. Dashboards

### 2.1 What we need to build

Dashboards showing total registered patients, login statistics, appointment trends, and popular wellness services. The project document says the output must be visible to **all** user types, which includes guests who are not logged in at all.

### 2.2 Looker Studio vs QuickSight

| | Looker Studio | Amazon QuickSight |
|---|---|---|
| Cost | Free | Per-user pricing; anonymous embedding needs paid capacity pricing |
| Embedding in React | Free iframe, works for anyone with the link | Anonymous viewing is a paid enterprise feature |
| Data sources | BigQuery (native), no native Firestore connector | Native AWS sources |

Since guests also need to see the dashboards, QuickSight is basically ruled out: showing a QuickSight dashboard to someone who is not logged in requires its paid capacity pricing, which makes no sense for a free course project. Looker Studio reports can be embedded into our React app with a plain iframe for free, so that is what we are going with.

### 2.3 Problem: Looker Studio cannot read Firestore directly

Our current diagram shows Looker Studio reading straight from Firestore, but when I checked the connector list there is no native Firestore connector, only paid third-party ones. The standard way around this is to put BigQuery in the middle, since Looker Studio connects to BigQuery natively:

```
Firestore ---> BigQuery ---> Looker Studio ---> iframe in React app
        (export)        (native connector)
```

For the Firestore-to-BigQuery step, the **"Stream Firestore to BigQuery" Firebase extension** installs in a few clicks and mirrors a collection into a BigQuery table in near real time, which beats writing and maintaining our own export function. BigQuery's free tier (10 GB storage, 1 TB of queries per month) is far beyond anything we will use. We will add BigQuery to the architecture in Sprint 2.

### 2.4 Problem: no login data on the GCP side

The dashboards must show login statistics, but logins happen entirely on AWS (Cognito + DynamoDB), and our cross-cloud mirror currently only copies appointment records to Firestore. So right now there is simply no login data on GCP for Looker Studio to display.

The fix we are leaning towards is to extend the existing mirror: after a successful login, the auth Lambda also writes a small login event (userId, timestamp, role) to Firestore through the same mechanism we already use for appointments. This reuses a pattern we already have instead of inventing a new one, like scheduled pulls from CloudWatch. It does slightly widen what the cross-cloud seam carries, so we will consider it properly in Sprint 2 and record it in the architecture decision document.

### 2.5 Dashboard plan

One Looker Studio report reading from BigQuery, containing:

- Scorecard: total registered patients
- Time series: logins per day (depends on 2.4)
- Time series/bar: appointments per week by status
- Bar chart: bookings per wellness service
- Table: feedback entries with sentiment labels, plus an average-sentiment scorecard

The report gets embedded with an iframe on a public Analytics page in the React app, so guests, patients, and coordinators all see the same thing, which covers the "visible to all user types" requirement.

---

## 3. Conclusion – what we decided

- Google Natural Language API for sentiment, because the results need to land in Firestore on the GCP side anyway and this avoids an extra cross-cloud transfer.
- Looker Studio for dashboards, since it is free and embeds for guests, with BigQuery added between Firestore and Looker Studio because no direct connector exists.
- Two architecture changes carried into Sprint 2: adding BigQuery to the diagram, and extending the cross-cloud mirror with login events so the login statistics dashboard has data to read.

## 4. References

- AWS Comprehend Developer Guide (DetectSentiment)
- Google Cloud Natural Language API documentation (analyzeSentiment, score and magnitude)
- Looker Studio Help (connector list, report embedding)
- Amazon QuickSight pricing page (embedding and capacity pricing)
- Firebase Extensions: Stream Firestore to BigQuery
- BigQuery pricing page (free tier)

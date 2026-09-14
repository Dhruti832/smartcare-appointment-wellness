# Messaging Module (Member 5) — GCP Pub/Sub + Cloud Functions + Firestore

Asynchronous message passing for patient concerns:

```
patient / chatbot
      │  POST { patientId, concern, sessionId? }
      ▼
publishConcern (HTTP Cloud Function)
      │  publishes JSON message
      ▼
Pub/Sub topic  saws-patient-concerns-<env>
      │  push subscription
      ▼
handleMessage (Cloud Function)
      │  picks a random available coordinator from Firestore `coordinators`
      ▼
Firestore `communicationLogs`  { patientId, coordinatorId, concern, status: OPEN | UNASSIGNED }
```

If no coordinator is available the concern is still logged with
`status: UNASSIGNED` (nothing crashes, the message is acked).

## Replying (Sprint 3 — closing the loop)

Sprint 2 was one-way: a coordinator could see a concern but had no way to
answer it. Each concern document now carries a `messages` thread, opened with
the concern itself, and a `postReply` HTTP function appends to it from either
side. Pub/Sub still routes the opening concern only — the conversation after
that lives in Firestore, as designed in
`docs/sprint-reports/Module3-messaging.md` §7.

```
coordinator dashboard ─┐
                       ├─ POST postReply ─► communicationLogs/<id>.messages[]
patient view ──────────┘                     (+ lastMessageAt, lastMessageBy)
```

**`POST <post_reply_url>`**

```json
{ "concernId": "<communicationLogs doc id>",
  "sender": "coordinator" | "patient",
  "senderId": "coord-1",
  "message": "Rebooked you for Friday at 2pm" }
```

→ `201 { "message": "Reply added", "concernId": "...", "messageCount": 2 }`
Errors: `400` missing fields or unrecognised `sender`, `404` unknown
`concernId`, `405` other methods.

**`GET <post_reply_url>?concernId=<id>`** → `200 { concernId, patientId,
coordinatorId, status, messages: [...] }` — for clients that would rather not
build Firestore REST URLs.

Each entry in `messages[]`:

```json
{ "messageId": "uuid", "sender": "patient", "senderId": "patient-demo-1",
  "text": "I need to reschedule", "sentAt": "2026-07-25T10:00:00.000Z" }
```

Appends use `FieldValue.arrayUnion`, so a patient and a coordinator replying at
the same moment cannot overwrite each other.

**What changed for other modules (all additive — nothing was removed):**

- **Frontend (Member 6):** `concern`, `status`, `coordinatorId`, `createdAt`
  and `patientId` are unchanged, so the existing dashboard read keeps working.
  New: render `messages[]` as the conversation and POST replies to
  `post_reply_url` (Terraform output → suggest `REACT_APP_POST_REPLY_URL`).
  `lastMessageBy !== 'coordinator'` means the patient is still waiting.
  `status` values are still only `OPEN` / `UNASSIGNED`.
- **Chatbot (Member 4):** the `SubmitConcern` path is untouched — concerns
  published through `publishConcern` simply arrive with their thread already
  opened.

### The UNASSIGNED backlog

Concerns submitted while `coordinators` was empty are still stranded with
`status: UNASSIGNED`. After seeding coordinators, sweep them once:

```sh
cd messaging/functions && node reassign_unassigned.js
```

It reuses the same random-assignment rule as live routing and sets each swept
concern to `OPEN`.

## Deploy

Prereqs: `gcloud` CLI authenticated (`gcloud auth login` +
`gcloud auth application-default login`), a GCP project with billing, and
these APIs enabled:

```sh
gcloud services enable pubsub.googleapis.com cloudfunctions.googleapis.com \
  run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com
```

Then from `infrastructure/gcp/terraform/`:

```sh
terraform init
terraform apply -var="gcp_project_id=<your-project-id>"
```

The messaging resources are defined in `messaging.tf`. Terraform zips
`messaging/functions/` (both functions ship in one bundle with two entry
points) and uploads it to the functions bucket; the hash-suffixed object name
forces a redeploy when the source changes.

## Seed coordinators

```sh
cd messaging/functions && npm install
node seed_coordinators.js
```

Creates three coordinators (two `available: true`, one `false`).

## Test end to end

```sh
# URL comes from the terraform output `publish_concern_url`
curl -s -X POST "$PUBLISH_URL" \
  -H 'Content-Type: application/json' \
  -d '{"patientId":"patient-demo-1","concern":"I need to reschedule my appointment","sessionId":"sess-1"}'
# → 202 {"message":"Concern submitted","messageId":"..."}
```

Verify:

1. **Firestore** → `communicationLogs` has a new doc with `status: OPEN` and a
   `coordinatorId` from the seeded coordinators.
2. **Cloud Functions logs**: `gcloud functions logs read saws-message-handler-dev --region=us-central1`
   shows `Concern from patient ... assigned to coordinator ...`.
3. **No-coordinator path**: set every coordinator's `available` to `false` in
   the Firestore console, publish again → doc logged with `UNASSIGNED`, no
   error in the logs.

Then the reply hop, using the `concernId` from step 1 (the document id) and the
`post_reply_url` output:

```sh
curl -s -X POST "$POST_REPLY_URL" \
  -H 'Content-Type: application/json' \
  -d '{"concernId":"<doc-id>","sender":"coordinator","senderId":"coord-1","message":"Rebooked you for Friday at 2pm"}'
# → 201 {"message":"Reply added","concernId":"<doc-id>","messageCount":2}

curl -s "$POST_REPLY_URL?concernId=<doc-id>"
# → 200 with both messages in order: the concern, then the coordinator's reply
```

4. **Round trip**: the patient replies again with `"sender":"patient"` →
   `messageCount: 3`, `lastMessageBy: patient`. This is the loop-closed
   evidence for the report.

## Unit tests

```sh
cd messaging/functions && npm install && npm test
```

13 Jest tests: coordinator assignment, the UNASSIGNED fallback, malformed
Pub/Sub payloads, and every `postReply` path (append from both sides, bad
sender, unknown concern, thread read, CORS preflight, wrong method).

## Interfaces

- **Chatbot (Member 4):** the `SubmitConcern` intent POSTs to `publishConcern`.
- **Frontend (Member 6):** patient concern form POSTs to `publishConcern`;
  coordinator dashboard reads `communicationLogs` and POSTs replies to
  `postReply` (see "Replying" above for the exact contract).
- **Shared Firestore collections:** `coordinators`, `communicationLogs`.
- **Terraform outputs:** `publish_concern_url`, `post_reply_url`,
  `concerns_topic`.

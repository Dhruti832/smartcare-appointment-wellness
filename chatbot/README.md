# Chatbot Module (Member 4) — Dialogflow ES + Cloud Function + Firestore

Virtual assistant covering navigation help, FAQ, appointment lookup by
reference code, wellness service inquiry, and submitting a concern to a
coordinator:

```
patient / guest (Dialogflow Messenger widget or REST)
      │  utterance
      ▼
Dialogflow ES agent (intent matching + entity extraction)
      │  webhook call — all 5 intents
      ▼
fulfillment (HTTP Cloud Function, chatbot/functions/index.js)
      │
      │-- Navigation        --> static per-topic help text
      │-- FAQ                --> Firestore `faq`
      │-- AppointmentLookup  --> Firestore `appointments` (cross-cloud mirror
      │                          from Appointments/04, see backend/appointments/
      │                          mirror_to_firestore.py)
      │-- WellnessInquiry    --> Firestore `services`
      │-- SubmitConcern      --> POST to messaging's publishConcern function
      │                          (Pub/Sub `saws-patient-concerns-<env>`), so
      │                          concerns feed the same coordinator-assignment
      │                          flow as the frontend's concern form
      ▼
fulfillmentText returned to Dialogflow --> displayed in chat widget
```

All 5 intents have the webhook enabled, including `Navigation` — its response
text differs per topic (`booking`/`dashboard`/`profile`), which needs the
fulfillment call to run rather than a single static response configured on
the intent itself.

## Deploy

Prereqs: `gcloud` CLI authenticated (`gcloud auth login` +
`gcloud auth application-default login`), a GCP project with billing, and
these APIs enabled:

```sh
gcloud services enable dialogflow.googleapis.com cloudfunctions.googleapis.com \
  run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com
```

From `infrastructure/gcp/terraform/`:

```sh
terraform init
terraform apply -var="gcp_project_id=<your-project-id>"
```

`chatbot.tf` zips `chatbot/functions/` and deploys `saws-chatbot-fulfillment-<env>`
with `PUBLISH_CONCERN_URL` wired to messaging's `publishConcern` function output,
so `terraform apply` must include (or already have applied) `messaging.tf` too.

If your project's backend bucket (`saws-terraform-state-gcp` in `main.tf`)
isn't yours to write to — e.g. you're standing up your own sandbox project
rather than deploying into the team's shared one — create your own uniquely
named bucket and point `init` at it instead of editing the tracked file:
```sh
gcloud storage buckets create gs://<your-project-id>-tfstate --location=us-central1
terraform init -backend-config="bucket=<your-project-id>-tfstate" -reconfigure
```

**On a brand-new GCP project**, the first `terraform apply` may fail on the
Cloud Function resources with `Build failed ... missing permission on the
build service account`, then (once that's fixed) with a `PERMISSION_DENIED`
500 from the deployed function on its first Firestore call. Both are the
default compute service account missing roles that newer GCP projects don't
auto-grant — `main.tf` now provisions `roles/cloudbuild.builds.builder` and
`roles/datastore.user` on that account itself
(`google_project_iam_member.default_compute_cloudbuild_builder` /
`default_compute_datastore_user`), so a normal `terraform apply` handles this
automatically. Only worth knowing about if you see either error, or if IAM
policy changes are restricted on your project (ask whoever owns it to run
`terraform apply` or grant those two roles manually).

## Create the Dialogflow ES agent

Fully scriptable, no console needed — confirmed by actually running this
against a real project (`serverless-project-501905`, 2026-07-09).

The agent resource itself and its fulfillment webhook URL are Terraform-managed
(`google_dialogflow_agent.saws` / `google_dialogflow_fulfillment.saws` in
`chatbot.tf` — created as part of the `terraform apply` in **Deploy** above).
What Terraform's provider *can't* manage is intent content — training
phrases have no Terraform resource (`google_dialogflow_intent` only covers
top-level metadata like `webhook_state`, not the phrases themselves) — so
that part goes through Dialogflow's `agent:import` API directly:

```powershell
gcloud auth application-default set-quota-project <your-project-id>
# Dialogflow ES requires an explicit quota project when authenticating as a
# user (vs. a service account) — without this every call 403s.

cd chatbot/dialogflow
./import-agent.ps1 -ProjectId <your-project-id>
```

This zips `chatbot/dialogflow/`, calls `agent:import` to load the 5 intents
(`Navigation`, `FAQ`, `AppointmentLookup`, `WellnessInquiry`, `SubmitConcern`)
with training phrases and the 3 custom entities (`@service-type`,
`@faq-topic`, `@navigation-topic`), then enables the webhook on all 5.

**One gotcha the hard way**: `agent:import` overwrites the agent's
fulfillment config from `agent.json`'s `webhook` block — that block is
deliberately inert (`available: false`) to avoid clobbering the real,
Terraform-managed URL, but always re-run this afterward just in case:
```sh
cd ../../infrastructure/gcp/terraform
terraform apply -target=google_dialogflow_fulfillment.saws
```

If you'd rather do this by hand in the console instead (e.g. to poke around
the training phrases visually): create the agent (or use the
Terraform-created one), then **Agent Settings** (gear icon) → **Export and
Import** → **Import From Zip** with a zip of `chatbot/dialogflow/`, then
**Fulfillment** tab per intent → enable "Enable webhook call for this
intent" on all 5.

Seed Firestore (next section) before testing lookups/inquiries.

## Seed Firestore

```sh
cd chatbot/functions && npm install
node seed_dialogflow_data.js
```

Creates sample `services` (yoga/physiotherapy/nutrition/mental-health),
`faq` (hours/booking/cancellation/insurance/login), and one fallback
`appointments/APT-DEMO-1` doc so `AppointmentLookup` has something to return
even before the AWS→Firestore appointment mirror is populated.

## Test

### Automated (fulfillment webhook logic)

```sh
cd chatbot/functions && npm test
```

16 Jest tests simulate the exact `WebhookRequest` body Dialogflow sends after
matching an intent + extracting parameters, for all 5 intents plus not-found /
empty-slot / downstream-failure / malformed-request edge cases, with
Firestore and `fetch` mocked. See
[docs/testing/chatbot-utterance-tests.md](../docs/testing/chatbot-utterance-tests.md)
for the full utterance → intent → response table and which rows this covers.

### Live NLU (real Dialogflow, real deployed function, scriptable)

Once the agent is imported (previous section), you can drive real utterances
through Dialogflow's actual `detectIntent` API — genuine NLU classification,
not just fulfillment logic — without opening the console:

```sh
TOKEN=$(gcloud auth print-access-token)
SESSION="projects/<your-project-id>/agent/sessions/test-1"
curl -s -X POST "https://dialogflow.googleapis.com/v2/${SESSION}:detectIntent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Goog-User-Project: <your-project-id>" \
  -H "Content-Type: application/json" \
  -d '{"queryInput":{"text":{"text":"What are your hours?","languageCode":"en"}}}'
```

The response includes `queryResult.intent.displayName`,
`queryResult.parameters`, `queryResult.fulfillmentText`, and (crucially for
debugging) `webhookStatus` — a non-2xx `webhookStatus.code` means the intent
matched fine but the fulfillment call itself failed, which is exactly what
caught the `agent:import`-clobbers-the-webhook-URL issue above.

This is real evidence, but a screenshot of the Dialogflow console's "Try it
now" panel is still worth capturing separately if your sprint report
specifically asks for one — see
[docs/testing/chatbot-utterance-tests.md](../docs/testing/chatbot-utterance-tests.md)
for exactly which screenshots and why.

### Live console walkthrough (optional, for visual verification)

1. Dialogflow ES console → **Try it now** panel → type each utterance from
   the test table and confirm the matched intent and response. Screenshot the
   conversation.
2. Cloud Function logs for a real webhook call:
   ```sh
   gcloud functions logs read saws-chatbot-fulfillment-dev --gen2 --region=us-central1
   ```
3. End-to-end `SubmitConcern` → Pub/Sub → coordinator assignment: after
   submitting a concern via the chatbot, check Firestore `communicationLogs`
   for a new doc (see [messaging/README.md](../messaging/README.md)).

## Embedding in the frontend

Dialogflow Messenger is the fastest path — two lines dropped into any page,
no custom chat UI needed:

```html
<df-messenger
  intent="WELCOME"
  chat-title="SAWS Assistant"
  agent-id="<your-dialogflow-agent-id>"
  language-code="en">
</df-messenger>
<script src="https://www.gstatic.com/dialogflow-console/fast/messenger/bootstrap.js?v=1"></script>
```

The REST API (`detectIntent`) is available as an upgrade path if a fully
custom chat UI is needed later.

## Interfaces with other modules

- **Messaging (Member 5):** `SubmitConcern` POSTs to messaging's
  `publishConcern` Cloud Function (`PUBLISH_CONCERN_URL` env var).
- **Appointments (Member 3):** `AppointmentLookup` reads Firestore
  `appointments`, populated by the AWS→Firestore mirror. Field names agreed:
  `refCode`, `date`, `service`, `status`. **Sprint 3 note:** confirmed against
  real mirrored production data (`APT-1001` etc.) that the mirror never
  writes a `time` field — `lookupAppointment` now omits the time clause
  gracefully instead of showing "at undefined". `service` currently comes
  through as an already-resolved display name in practice, but
  `resolveServiceName` also handles the case where it's a raw `serviceId`
  (resolving against this module's own `services` collection, falling back
  to the raw value otherwise) as a forward-compatible safety net. Live
  verification details in
  [docs/testing/chatbot-utterance-tests.md](../docs/testing/chatbot-utterance-tests.md).
- **Frontend (Member 6):** embeds the Dialogflow Messenger widget (see above).
- **Firestore** collections `services` and `faq` are owned by this module.

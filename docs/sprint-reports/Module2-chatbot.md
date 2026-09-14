# Sprint 1 Research – Virtual Assistant / Chatbot (Module 2)

**Services researched:** AWS Lex, Google Dialogflow ES, GCP Cloud Functions, Firestore

> **Sprint 2 update:** implementation landed on `member-4-chatbot-prototype`
> per the decisions below, fully deployed and live-verified against GCP
> project `serverless-project-501905` on 2026-07-09 — including the
> Dialogflow ES agent itself, created and configured entirely via Terraform +
> the Dialogflow API (no console step needed, despite that being assumed
> impossible earlier in the sprint). All 5 intents are live with training
> phrases, webhook fulfillment, and real Firestore data; utterances were
> verified through Dialogflow's actual `detectIntent` API end to end,
> including the Pub/Sub → messaging concern handoff. See
> [chatbot/README.md](../../chatbot/README.md) for deploy/test steps and
> [docs/testing/chatbot-utterance-tests.md](../testing/chatbot-utterance-tests.md)
> for the utterance test table and full evidence, including a couple of real
> bugs the live testing caught that mocked tests couldn't, and console
> screenshots (`docs/testing/screenshots/chatbot/`) matching the API-verified
> results exactly. Nothing outstanding on this module.

> **Sprint 3 update (2026-07-26):** connected `AppointmentLookup` to real
> mirrored appointment data instead of the seeded stub — found and fixed a
> real field-mismatch bug (the AWS→Firestore mirror never writes a `time`
> field, and `service` isn't guaranteed to be a display name), broadened FAQ
> (6→17 phrases) and WellnessInquiry (6→15 phrases) training data, and fixed
> the actual root cause of the "gibberish matches FAQ" limitation noted above
> (`mlMinConfidence` was 0.3, raised to 0.5). All of it live-verified against
> `serverless-project-501905`, not just unit-tested: gibberish now correctly
> falls back, new phrasings match with confidence 1.0, `AppointmentLookup`
> was confirmed against real production data (`APT-1001`, no `time` field —
> exactly the case the fix targets), and the concern→coordinator path was
> confirmed reaching `status: OPEN` with a real `coordinatorId` (prior
> evidence only showed the `UNASSIGNED` no-coordinator case). Also worth
> noting as a Sprint 3 challenge: the team's shared Terraform state bucket
> (`saws-terraform-state-gcp`) doesn't exist, so deployment for this module
> went through `gcloud functions deploy` directly rather than `terraform
> apply` — a broader environment-convergence gap, tracked separately, not
> specific to this module. Full evidence, screenshots, and logs (including
> the deploy mistake the logs caught and the services-catalog gap the logs
> surfaced) in
> [docs/testing/chatbot-utterance-tests.md](../testing/chatbot-utterance-tests.md).
> Nothing outstanding on this module for Sprint 3.

---

## 1. What we need to build

A chatbot embedded in the React frontend that can handle the following user interactions:

- Navigation help and general FAQ
- Appointment lookup (show a patient their upcoming bookings)
- Wellness service inquiries (what services are available, pricing)
- Accepting and forwarding patient concerns to a Wellness Coordinator

The chatbot must work for all three user types: Guests, Registered Patients, and Wellness Coordinators. Submitted concerns must be forwarded asynchronously so the patient does not have to wait for a coordinator to be online.

---

## 2. AWS Lex vs Google Dialogflow ES

| | AWS Lex | Google Dialogflow ES |
|---|---|---|
| NLU approach | Intent + slot filling | Intent + entity extraction |
| Free tier | 10,000 text requests/month (first 12 months only) | 180 requests/min, no hard monthly cap on ES |
| Webhook fulfillment | AWS Lambda | Cloud Function (HTTP trigger) |
| Native integrations | AWS (Lambda, DynamoDB, Cognito) | GCP (Cloud Functions, Pub/Sub, Firestore) |
| React embedding | Via REST API or AWS Amplify | Via Dialogflow Messenger or REST API |
| Fits our system | AWS side – fulfillment webhooks would need cross-cloud calls to reach Pub/Sub and Firestore | GCP side – fulfillment logic lives next to Pub/Sub and Firestore directly |

Both platforms handle intent recognition well enough for a course project. The deciding factor is where the downstream services live. Our concern-forwarding flow needs Pub/Sub (Module 3, GCP), and appointment lookups need Firestore (which receives the mirrored appointment records from AWS). If we used Lex, every fulfillment webhook would have to call across clouds to reach those services, adding latency and creating a second cross-cloud integration point on top of the appointment mirror we already have. We want to keep cross-cloud traffic to that one seam.

**Decision: Google Dialogflow ES**, keeping fulfillment entirely within GCP.

---

## 3. Dialogflow ES – how it works

Dialogflow ES uses **intents** to match what a user says to an action. Each intent can extract **entities** (structured values like dates, service names) from the input, then hand off to a **fulfillment webhook** (our Cloud Function) to do real work and return a dynamic response.

Intents we need to build:

| Intent name | Example utterance | Fulfillment needed |
|---|---|---|
| `navigation.help` | "How do I book an appointment?" | No – static response |
| `faq.general` | "What are your hours?" | No – static response |
| `appointment.lookup` | "Show me my upcoming appointments" | Yes – query Firestore |
| `service.inquiry` | "What wellness services do you offer?" | Yes – query Firestore |
| `concern.submit` | "I want to report a problem with my care" | Yes – publish to Pub/Sub |

Intents that return static text (navigation, FAQ) require no backend call. Only the three fulfillment intents hit the Cloud Function.

---

## 4. Fulfillment flow

```
React frontend (chat widget)
     |
     v
Dialogflow ES (intent matching + entity extraction)
     |
     v  (webhook on fulfillment intents only)
Cloud Function: dialogflow-fulfillment (HTTP trigger)
     |
     |-- appointment.lookup  --> read Firestore (appointments mirror)
     |-- service.inquiry     --> read Firestore (services collection)
     |-- concern.submit      --> publish to Pub/Sub (patient-concerns topic)
     |
     v
Response text returned to Dialogflow --> displayed in chat widget
```

For `appointment.lookup`, the Cloud Function reads from the Firestore appointments mirror that the AWS cross-cloud seam populates. The chatbot never calls AWS directly; it reads locally, which is the whole point of the mirror.

For `concern.submit`, the Cloud Function publishes to the `patient-concerns` Pub/Sub topic. Module 3 handles what happens next.

---

## 5. Embedding the chatbot in React

Dialogflow offers a prebuilt **Dialogflow Messenger** web component that drops into any HTML page with two lines of code. For a course project this is the right call: it handles session management, typing indicators, and the chat UI without us writing any of it.

The Messenger widget authenticates using the GCP project's service account credentials. The key must be stored in an environment variable and never committed to GitLab.

If the team later wants a fully custom chat UI, the Dialogflow REST API (`/sessions/{session}/detectIntent`) can be called directly from React, giving full control over the widget appearance.

---

## 6. Appointment data availability

The chatbot needs appointment records, but those records live in AWS DynamoDB. Our architecture resolves this by mirroring a thin appointment record (ref code, date, service name, status) into Firestore via the event-driven cross-cloud seam whenever an appointment is created or updated. The chatbot's Cloud Function reads from Firestore and never touches AWS directly.

This means the chatbot depends on the mirror being populated before `appointment.lookup` queries work. During early Sprint 2 testing we will need to seed Firestore with sample appointment data manually until the mirror is wired up end-to-end.

---

## 7. Security notes

- The Cloud Function service account gets only `Dialogflow API Client`, `Cloud Datastore User` (Firestore reads), and `Pub/Sub Publisher` roles. No broader permissions.
- Guest users can reach the chatbot for FAQ and navigation intents. The `appointment.lookup` intent should check for a valid patient session before querying Firestore and return a friendly "please log in" response otherwise.
- No patient PII is stored in Dialogflow itself. Session context holds only intent state; all real data lives in Firestore.

---

## 8. Notes on Dialogflow ES vs CX

We chose ES (Essentials), not CX (Customer Experience). CX adds flow-based conversation design and is better suited for large enterprise bots with complex branching logic across many topics. ES is simpler to configure, easier to debug, and fully sufficient for five intents on a course project.

---

## 9. Cost

At course-project scale everything stays free. Dialogflow ES has no strict monthly text request cap, so we will not hit a billing surprise during development or the live demo.

---

## 10. Conclusion – what we decided

- **Google Dialogflow ES** for the chatbot, keeping fulfillment within GCP to avoid a second cross-cloud seam.
- Static intents (FAQ, navigation) need no backend; the three fulfillment intents (`appointment.lookup`, `service.inquiry`, `concern.submit`) route through a single Cloud Function that reads Firestore or publishes to Pub/Sub.
- **Dialogflow Messenger** for the React embed in the demo; REST API available as an upgrade path if a custom UI is needed.
- One dependency to track in Sprint 2: `appointment.lookup` requires the cross-cloud mirror to be populated before it can return real data.

---

## 11. References

- Google Dialogflow ES documentation (intents, entities, fulfillment webhooks)
- Dialogflow Messenger documentation (web component embedding)
- Dialogflow REST API reference (detectIntent)
- GCP Cloud Functions documentation (HTTP triggers)
- SAWS Architecture Decision document (cross-cloud seam, module distribution rationale)

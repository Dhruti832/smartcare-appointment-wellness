# Integration & System Test Evidence Pack — SAWS

This is the **system-level** test plan: the cross-module, end-to-end scenarios that no single
module's test doc covers, plus a coverage matrix mapping every testing type the project rubric
names to where it is proven. Per-module unit/endpoint tests live in the module docs
(`auth-test-cases.md`, `chatbot-utterance-tests.md`) and under `tests/`; this document ties them
together and adds the integration scenarios that span AWS↔GCP and module↔module.

**Status legend**
- **Verified** — exercised end-to-end against deployed infrastructure; evidence captured.
- **Automated** — a `pytest`/`jest` test asserts this (see the referenced test file).
- **Pending** — scenario defined; waiting on the named module's Sprint 3 work to land before
  it can be run end-to-end. These are deliberately listed now so the pack is complete and each
  gets filled in as features merge.

Screenshots/log captures for the sprint report go in `docs/testing/screenshots/integration/`
(that capture step needs a human at a keyboard; the scenarios and expected results below are the
script to follow).

---

## 1. Coverage matrix — rubric testing types → where proven

The project document requires eight testing types. This maps each to its evidence.

| # | Required testing type | Primary location | Status |
|---|-----------------------|------------------|--------|
| 1 | Successful authentication testing | `auth-test-cases.md` (#1, #11–12); `tests/auth` (27 tests) | Verified / Automated |
| 2 | Failed login testing | `auth-test-cases.md` (#2–7); `tests/auth` | Verified / Automated |
| 3 | Database integrity testing | §3 of this doc | Partly verified |
| 4 | Chatbot utterance testing | `chatbot-utterance-tests.md`; `chatbot/functions` (18 tests) | Verified / Automated |
| 5 | API testing | `tests/{appointments,feedback,services}` (59 tests) + §2 flows | Automated / Pending live |
| 6 | Lambda / Cloud Function event testing | `tests/` (101 Python) + `messaging/functions` (13) + §2 flows | Automated / Pending live |
| 7 | Queue / message testing | `tests/notifications` (15) + `messaging/functions` (13); §2 I2, I6, I8 | Automated / Pending live |
| 8 | Notification delivery testing | `tests/notifications` handler tests; §2 I1, I2, I4, I5, I6 | Automated (handler) / Pending live delivery |

> Automated layer last run: **132 tests, all pass** — see §4 for the per-suite breakdown. "Pending
> live" means the handler logic is covered by automated tests but the deployed end-to-end path
> (real SQS/SNS/email, live mirror) still needs a run with captured screenshots.

---

## 2. Integration scenarios (cross-module, end-to-end)

Each scenario crosses at least two modules and/or both clouds. "Modules" names the owners whose
work the scenario exercises, so it is clear what must be deployed for each to move to Verified.

| ID | Scenario | Modules | Steps | Expected result | Status |
|----|----------|---------|-------|-----------------|--------|
| I1 | Registration → email notification | Auth, Notifications | Register a new patient via `/auth/register` | `REGISTER` message lands on SQS → `process_notification` publishes to SNS → confirmation email received | Pending — Notifications delivery (Dev) |
| I2 | Login → email notification | Auth, Notifications | Complete the 3-stage login | `LOGIN` message on SQS → SNS → email received | Pending — Notifications delivery (Dev) |
| I3 | Book appointment → confirmation + cross-cloud mirror | Appointments, Notifications, Analytics | `POST /appointments` as a patient | 201 + ref code; PENDING row in `saws-appointments`; `mirror_to_firestore` writes the record to Firestore `appointments`; confirmation notification fires | Pending — verify mirror + notification end to end |
| I4 | Coordinator approve → status update → notification | Appointments, Auth (roles), Notifications | Coordinator `PATCH /appointments/{id}/approve` | Status → APPROVED; `appointment_logs` row written; confirmation notification; mirror updates Firestore | Pending — Appointment lifecycle (Harsha) |
| I5 | Cancel appointment → cancellation notification | Appointments, Notifications | `PATCH /appointments/{id}/cancel` | Status → CANCELLED; cancellation notification delivered; mirror updates | Pending — Appointment lifecycle (Harsha) |
| I6 | Scheduled reminder → notification | Notifications | EventBridge daily rule fires (or manual trigger) | Reminder event → SQS → `process_notification` → reminder email | Pending — Notifications delivery (Dev) |
| I7 | Submit feedback → sentiment → mirror → dashboard | Feedback, Analytics | `POST /feedback`, then check the dashboard | Row in `saws-feedback`; `analyze_sentiment` writes score/label back (Google NL API); `export_feedback_csv` → S3 → Cloud Function → Firestore → BigQuery `feedback_dashboard`; appears in Looker report | Pending — full pipeline live run |
| I8 | Chatbot concern → Pub/Sub → random coordinator | Chatbot, Messaging | Submit a concern through the chatbot | `publishConcern` → Pub/Sub → `handleMessage` → Firestore `communicationLogs` doc assigned to a random available coordinator | Pending — Messaging loop (Dev) / Chatbot (Dhruti) |
| I9 | Chatbot appointment lookup returns real data | Chatbot, Appointments, Analytics (mirror) | Ask the chatbot for an appointment by ref code | Returns the real mirrored appointment from Firestore, not a stub | Pending — Chatbot live data (Dhruti) |
| I10 | Coordinator↔patient response loop | Messaging | Coordinator replies to a concern; patient sees the response | Reply persisted in `communicationLogs`; visible to the patient | Pending — Messaging loop (Dev) |
| I11 | Analytics dashboard visible to all user types | Analytics, Frontend | Open the Looker report link as guest / patient / coordinator | All four coordinator metrics + public sentiment view render; link works while signed out (public sharing) | Verified — all four coordinator metrics built in the live Looker report (login-stats + total-patients charts added Sprint 3); confirmed rendering signed-out. Frontend embed Pending (Mansi) |
| I12 | Role-based access across the system | Auth, Appointments, Frontend | Access coordinator-only routes as a patient, and protected routes as a guest | Patient blocked from coordinator actions server-side (not just UI hidden); guest 401'd on protected APIs | Automated (`tests/appointments/test_authorization.py`) + Pending live frontend check (Mansi) |
| I13 | Frontend calls real deployed backends | Frontend, Auth, Appointments, Feedback, Services | Drive the deployed React app through register → login → book → feedback | Each action hits the real API Gateway endpoint and succeeds; no mock data | Pending — Frontend integration + Cloud Run deploy (Mansi) |

---

## 3. Database integrity testing

Covers the DynamoDB data model (`docs/architecture/erd.md`) and its cross-table/cross-cloud
consistency — the rubric's "database integrity testing" line.

| ID | Check | Steps | Expected result | Status |
|----|-------|-------|-----------------|--------|
| D1 | All six tables provisioned with correct keys/GSIs | `aws dynamodb describe-table` per table | Keys/GSIs match `erd.md` (§2) | Verified (checked during provisioning) |
| D2 | Streams enabled where consumers depend on them | describe `saws-appointments`, `saws-feedback` | Both have `StreamEnabled: true` (mirror + sentiment/export consumers) | Verified |
| D3 | Referential consistency: feedback → appointment/service | Submit feedback referencing a known `appointmentId`/`serviceId` | Stored `appointmentId`/`serviceId` resolve to real rows in the respective tables | Pending — run with live feedback |
| D4 | Referential consistency: appointment → patient/service | Book an appointment | `patientUsername` matches a Cognito user; `serviceId` matches a `saws-services` row | Pending — run with live booking |
| D5 | Audit trail written on every status change | Book, approve, reject, cancel an appointment | One `appointment_logs` row per action, ordered by `createdAt` (via `appointmentId-index`) | Automated (`tests/appointments/test_*`) + Pending live |
| D6 | Cross-cloud mirror consistency (AWS → Firestore) | Book/update an appointment; submit feedback | Firestore `appointments` / `feedback` reflect the AWS rows (thin copy); no drift | Pending — run with live mirror |
| D7 | No plaintext secrets in the data model | Inspect `UserSecurity` items | Only hashes stored — no raw security answer, healthcare code, or password anywhere | Verified (`auth-test-cases.md` #10) |

---

## 4. Running the automated layer

Each Lambda's tests import its handler as a top-level module, so the module's own
`backend/<module>` directory must be on `PYTHONPATH` — run the Python suites per module rather
than pointing `pytest` at `tests/` as a whole:

```bash
# Python (auth, appointments, feedback, notifications, services)
for m in auth appointments feedback notifications services; do
  PYTHONPATH="backend/$m" python -m pytest "tests/$m" -q
done

# Node (chatbot + messaging Cloud Functions)
cd chatbot/functions   && npm install && npm test
cd messaging/functions && npm install && npm test
```

### Last recorded run

| Suite | Tests | Result |
|-------|-------|--------|
| Python — auth | 27 | pass |
| Python — appointments | 33 | pass |
| Python — feedback | 13 | pass |
| Python — notifications | 15 | pass |
| Python — services | 13 | pass |
| Node — chatbot | 18 | pass |
| Node — messaging | 13 | pass |
| **Total** | **132** | **all pass** |

As each Pending scenario's underlying feature merges to `develop`, run it end-to-end, flip its
status to Verified, and drop the screenshot/log evidence into
`docs/testing/screenshots/integration/`.

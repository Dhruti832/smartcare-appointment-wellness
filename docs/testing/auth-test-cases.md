# Authentication Module — Test Case Table

Covers the 3-stage MFA login, registration, and role-based access
lambdas in `backend/auth/`. Schema: Cognito owns identity/credentials;
`UserSecurity` (PK `username`) holds the security question/answer hash
and Caesar cipher clue/shift/answer hash; `AuthSessions` (PK
`sessionId`, TTL) tracks stage1Done/stage2Done/stage3Done and holds
the Cognito tokens withheld until stage 3 passes.

"Automated" cases run via `pytest` (`cd backend/auth && pip install -r
requirements.txt && pytest ../../tests/auth/ -v`, 25 passing at time of
writing). "Verified live" cases were exercised end-to-end against the
deployed API (`https://gllabj52m2.execute-api.us-east-1.amazonaws.com`)
via curl during development — the request/response pairs described
below are the evidence. A screenshot of the same requests in
Postman/browser plus the matching CloudWatch log line should still be
captured for the sprint report — that capture step needs a human at a
keyboard, not an automated tool.

| # | Case | Stage/Lambda | Steps | Expected Result | Status | Evidence |
|---|------|---------------|-------|------------------|--------|----------|
| 1 | Successful 3-stage login | stage1 → stage2 → stage3 | POST correct email/password, then correct security answer with the returned sessionId, then the *manually decoded* cipher answer with the same sessionId | 200 at each stage; stage3 returns real Cognito idToken/accessToken/refreshToken + role | **Verified live** | curl: registered `schema.test@example.com`, decoded clue `WTAAD` shift `15` → `HELLO`, stage3 returned real tokens + `role: Patients` |
| 2 | Failed login — wrong password | stage1 | POST with a bad password | 401 `Invalid credentials` | Automated + verified live | `test_stage1.test_wrong_password_returns_401`; live curl reproduced the same 401 |
| 3 | Failed login — wrong security answer | stage2 | Valid sessionId, wrong answer | 401 `Incorrect security answer` | Automated (`test_stage2.test_wrong_answer_fails`) | pytest output |
| 4 | Failed login — wrong cipher answer | stage3 | Valid sessionId, wrong decoded answer | 401 `Invalid cipher code` | Automated + verified live | `test_stage3.test_wrong_answer_fails`; live curl with `cipherAnswer: WRONG` reproduced the same 401 |
| 5 | Cannot skip stage 1 → stage 3 | stage2, stage3 | Call stage2/stage3 with a sessionId that hasn't completed the prior stage | 401 `Invalid or expired login session` | Automated (`test_cannot_skip_stage1`, `test_cannot_skip_stage2`) | pytest output |
| 6 | Cannot replay a completed stage | stage2, stage3 | Call stage2/stage3 again after it already succeeded once | 401 `Invalid or expired login session` | Automated (`test_cannot_replay_completed_stage2`, `test_cannot_replay_completed_stage3`) | pytest output |
| 7 | Expired session | stage2 | Use a sessionId whose `expiresAt` is in the past | 401 `Invalid or expired login session` | Automated (`test_expired_session_rejected`) | pytest output |
| 8 | Duplicate registration | register | Register with an email that already exists in Cognito | 409 `An account with this email already exists` | Automated (`test_register.test_duplicate_email_returns_409`) | pytest output |
| 9 | Missing required fields | register, stage1, stage2, stage3 | Omit required body fields on each endpoint | 400 with a descriptive message | Automated (one test per lambda) | pytest output |
| 10 | Answers never stored in plaintext | register | Register, then inspect the `UserSecurity` item | Only `securityAnswerHash`/`caesarAnswerHash` present — no raw answer or healthcare code anywhere in the item | Automated + verified live | `test_register.test_successful_registration_creates_security_record`; live `aws dynamodb get-item` on `UserSecurity` showed only hashes |
| 11 | Role-based access — Patient | register → login → GET /auth/me | Register as PATIENT, complete login, call /auth/me with the idToken | 200, `roles` includes `Patients` | **Verified live** | curl `/auth/me` with the idToken from case #1 returned `roles: ["Patients"]` |
| 12 | Role-based access — Coordinator | register → login → GET /auth/me | Same as #11 with role COORDINATOR | 200, `roles` includes `Coordinators` | Not yet run live | Needs a Coordinator test account — same steps as #11 |
| 13 | Unauthenticated access blocked | GET /auth/me | Call without an Authorization header | 401 from the API Gateway JWT authorizer (request never reaches the Lambda) | **Verified live** | `curl -o /dev/null -w "%{http_code}"` on `/auth/me` with no header returned 401 |
| 14 | Session cleanup on success | stage3 | After a successful login, read the AuthSessions item | Item deleted entirely (single-use) | **Verified live** | `aws dynamodb scan` on `AuthSessions` after a successful login showed the completed session gone; only an orphaned pre-fix session remained |
| 15 | Notification on register/login | register, stage3 | Complete registration, then a full login | A message with `action: REGISTER` / `action: LOGIN` lands on `saws-appointment-queue-dev` and is picked up by `process_notification` | Not yet verified | Needs a CloudWatch check on the `process_notification` Lambda's log group after a live register+login |

## Still needed for the sprint report

The rows marked "Verified live" above are real, but as curl output, not
screenshots. For the report's evidence requirement, capture:
- A Postman (or browser) screenshot of the same 4 requests in case #1
- Cognito console: the user pool showing the registered user + their
  `Patients`/`Coordinators` group membership
- DynamoDB console: a `UserSecurity` item (hashes only) and an
  `AuthSessions` item mid-flow
- CloudWatch Logs: one log stream per Lambda showing a successful
  invocation

## Running the automated suite

```bash
cd backend/auth
pip install -r requirements.txt
pytest ../../tests/auth/ -v
```
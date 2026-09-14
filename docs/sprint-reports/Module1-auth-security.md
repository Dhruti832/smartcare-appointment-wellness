# Module 1 — Authentication Hardening & Security Measures (Sprint 3)

**Owner:** Member 1 (auth / security) · **Cloud:** AWS · **Branch:** `feature/auth-hardening` → MR into `develop`

Sprint 2 delivered a working 3-stage login. Sprint 3's job was to make that auth
**actually enforce protection**: validate every request server-side, enforce roles
below the UI, validate all input, and close the gaps a real attacker would use. This
document is the security-measures section for the report.

---

## 1. What we are protecting

SAWS holds patient profiles, appointment records, and login credentials. The trust
boundary is the API Gateway edge: everything past it must assume the caller may be
hostile. The measures below are grouped by the guarantee they provide.

---

## 2. Security measures implemented

### 2.1 The 3-stage MFA can no longer be bypassed *(headline fix)*

**The vulnerability (before).** The Cognito app client had the client-facing
`USER_PASSWORD_AUTH` flow enabled. Because the protected endpoints are gated only by a
standard Cognito JWT authorizer, *any* valid Cognito ID token opened them — and a caller
could obtain such a token by calling Cognito's `InitiateAuth` **directly** with just a
username and password, never touching stages 2 (security question) and 3 (Caesar
cipher). The multi-factor login was therefore decorative: the second and third factors
protected nothing, because the token that actually unlocks the API was reachable with
the first factor alone.

**The fix (after).**
- The stage-1 Lambda now uses `admin_initiate_auth` (`ADMIN_USER_PASSWORD_AUTH`), which
  runs the password check **server-side** under the Lambda's IAM role.
- The client-facing `USER_PASSWORD_AUTH` flow is **removed** from the Cognito app client
  (`explicit_auth_flows` in `main.tf`). A caller can no longer authenticate directly
  against Cognito.
- Result: the **only** path to an ID token is through all three stages of our API. The
  Cognito token is minted at stage 1 but held server-side in the `AuthSessions` record
  and released to the client **only after stage 3 passes** (`stage3_caesar_cipher.py`).

*Evidence:* attempt a direct `aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH`
before vs. after — it succeeds before the change and fails (`InvalidParameterException:
USER_PASSWORD_AUTH flow not enabled`) after.

### 2.2 Token / session validation on every protected endpoint

- **Appointments API** — every route (`/appointments*`) is attached to a Cognito JWT
  authorizer (`appointments.tf`); no route is left unauthenticated. Missing, malformed,
  or expired tokens are rejected by API Gateway with `401` before any Lambda runs.
- **3-stage login sessions** — stages 2 and 3 validate the `sessionId` server-side on
  every call (`auth_sessions.get_active_session`): the session must exist, be unexpired
  (5-minute TTL), have completed the *previous* stage, and not have already completed the
  *current* one. This blocks stage-skipping and replay of a completed stage.

### 2.3 Server-side role enforcement (not just the UI)

Role is carried in the verified token's `cognito:groups` claim (Patient vs. Coordinator)
and checked **inside each handler**, never trusted from the client:
- `require_coordinator` guards approve / reject / list-by-status / logs — a Patient token
  receives `403`, regardless of what the UI shows.
- `require_authenticated` + ownership checks guard patient routes — a patient can read or
  cancel only their **own** appointment; another patient's id returns `404` (the endpoint
  never confirms an appointment exists to someone not entitled to it).

### 2.4 Brute-force protection on the MFA factors

Stages 2 and 3 previously allowed unlimited guesses within the 5-minute session window.
A shared failed-attempt counter (`register_failed_attempt`) now burns the session after
**5** wrong security-answer / cipher tries; the caller must restart from stage 1. Locked,
expired, and unknown sessions all return the **same** opaque message
(`"Invalid or expired login session, please sign in again"`) so the response never
reveals which case occurred.

### 2.5 Input validation on every endpoint accepting user data

A shared validation layer (`validation_utils.py` for auth, `appointments_common.py` for
appointments) applies to registration, the three login stages, booking, and reject:
- Malformed JSON bodies return a clean `400`, never an unhandled `500`/stack trace.
- Emails are format-checked; roles must be one of the allowed set; booking dates
  (`YYYY-MM-DD`) and times (`HH:MM`, 24-hour) must be real values.
- All free-text fields are length-capped (256 chars, 2000 for long text) to blunt
  oversized-payload abuse against DynamoDB and logs.

### 2.6 No sensitive values returned or logged in plaintext

- Security answers and the Caesar answer are stored **only as SHA-256 hashes**
  (`securityAnswerHash`, `caesarAnswerHash`) and are only ever *compared*, never returned.
- Passwords flow only to Cognito; they are never logged or persisted by our code.
- The Cognito tokens live server-side in the session and are released only on full
  authentication.
- A code sweep confirmed no log statement emits a password, token, or hash.

### 2.7 Least-privilege network exposure (CORS)

CORS on both APIs is being tightened from `allow_origins = ["*"]` to the specific
deployed frontend origin(s), so only the SAWS frontend can make browser calls. *(Pending
the final Cloud Run URL from the frontend module; `localhost` retained for local dev.)*

---

## 3. Test evidence

Automated: **60 unit tests pass** (27 auth, 33 appointments), including the new
lockout, role-enforcement, ownership, and validation cases.

| # | Scenario | Expected | Type |
|---|----------|----------|------|
| 1 | Correct credentials through all 3 stages | `200` + tokens released at stage 3 | Successful auth |
| 2 | Direct Cognito `USER_PASSWORD_AUTH` after fix | Rejected — flow disabled | MFA bypass blocked |
| 3 | Wrong password (stage 1) | `401` Invalid credentials | Failed auth |
| 4 | Wrong security answer / cipher | `401`, session survives (< 5 tries) | Failed auth |
| 5 | 5th wrong answer | `401`, session burned, restart required | Brute-force lockout |
| 6 | Protected endpoint, missing/expired token | `401` at API Gateway | Token validation |
| 7 | Patient token calls approve/reject | `403` Coordinator role required | Role enforcement |
| 8 | Patient reads another patient's appointment | `404` (existence hidden) | Ownership |
| 9 | Malformed JSON / bad date to booking | `400`, clean message | Input validation |

*(Screenshots to capture live: test suite output; a direct-Cognito call failing after the
fix; a `403` from a patient token against `/approve`; a `401` from an expired token.)*

---

## 4. Known limitations / Sprint 4

- **Caesar clue vs. shift.** Stage 2 returns both the encoded clue *and* the shift, which
  makes the stage-3 answer computable from the response. Retained for Sprint 3 to avoid a
  frontend-contract change; a stronger design (return the clue only, or neither) is a
  Sprint 4 item.
- **CORS origin.** Locked down pending the final frontend URL (see 2.7).
- **Token lifetime.** A fully authenticated Cognito token is valid for its normal ~1-hour
  life; no server-side revocation on logout yet.

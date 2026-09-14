# API Contract — SAWS (Sprint 2)

This is the shared contract the frontend and backend build against. It covers the endpoints
owned by this ERD (appointments, services, feedback). Authentication endpoints are listed as a
placeholder only — that contract belongs to the authentication module and will be filled in once
finalized there.

All endpoints are served through API Gateway + Lambda (proxy integration), matching the response
shape already used by `backend/appointments/book_appointment.py`.

---

## 1. Conventions

**Base URL**: `{API_BASE}` (set via `REACT_APP_API_BASE_URL` in the frontend, matching
`frontend/src/services/api.js`).

**Auth header**: protected endpoints require `Authorization: Bearer <Cognito ID token>`. Role
(`Patient` / `Coordinator`) is read from the token's `cognito:groups` claim by the API
authorizer — endpoints below say which roles are allowed.

**Response envelope** (all endpoints):

```json
{
  "message": "human-readable summary",
  "data": { }
}
```

**Error response** (any 4xx/5xx):

```json
{
  "message": "what went wrong"
}
```

**Common status codes**: `200` success, `201` created, `400` bad request, `401` unauthenticated,
`403` wrong role, `404` not found, `500` server error.

---

## 2. Services

### `GET /services`
List active services. Public — guests can browse without logging in.

Response `200`:
```json
{
  "message": "Services retrieved",
  "data": [
    { "serviceId": "svc-001", "name": "General Consultation", "type": "consultation",
      "description": "...", "durationMinutes": 30, "price": 50, "active": true }
  ]
}
```

### `GET /services/{serviceId}`
Get one service. Public.

Response `200`: single service object as above. `404` if not found.

### `POST /services`
Create a service. Role: `Coordinator`.

Request:
```json
{ "name": "Wellness Session", "type": "wellness", "description": "...", "durationMinutes": 45, "price": 75 }
```
Response `201`: `{ "message": "Service created", "data": { "serviceId": "svc-002" } }`

### `PUT /services/{serviceId}`
Update a service (pricing, description, active flag). Role: `Coordinator`.

Request: any subset of the fields above. Response `200`: updated service object.

---

## 3. Appointments

### `POST /appointments`
Book an appointment. Role: `Patient`. `patientUsername` is taken from the auth token, not the
request body.

Request:
```json
{ "serviceId": "svc-001", "date": "2026-07-20", "time": "10:00" }
```
Response `201`:
```json
{ "message": "Appointment booked", "data": { "appointmentId": "A1B2C3D4", "status": "PENDING" } }
```
Writes a `BOOK` row to `saws-appointment-logs`. Publishes to the notifications SQS queue per the
existing `book_appointment.py` flow.

### `GET /appointments/me`
Patient's own appointment history. Role: `Patient`. Backed by the `patientUsername-index` GSI.

Response `200`: array of appointment objects (`appointmentId`, `serviceId`, `date`, `time`,
`status`, `createdAt`).

### `GET /appointments/{appointmentId}`
Get one appointment's details/status. Role: owning `Patient` or any `Coordinator`. Also the
lookup used by the chatbot's appointment-reference-code feature (via the Firestore mirror, not
this endpoint directly — see `architectural_decisions.md` §4).

Response `200`: full appointment object. `404` if not found or not owned by the caller.

### `GET /appointments?status=PENDING`
Coordinator queue — list appointments by status, sorted by date. Role: `Coordinator`. Backed by
the `status-date-index` GSI.

Response `200`: array of appointment objects.

### `PATCH /appointments/{appointmentId}/approve`
Approve a pending appointment. Role: `Coordinator`.

Response `200`: `{ "message": "Appointment approved", "data": { "status": "APPROVED" } }`
Sets `coordinatorUsername` to the caller, writes an `APPROVE` row to `saws-appointment-logs`,
triggers the confirmation notification.

### `PATCH /appointments/{appointmentId}/reject`
Reject a pending appointment. Role: `Coordinator`.

Request: `{ "rejectionReason": "Requested slot unavailable" }`

Response `200`: `{ "message": "Appointment rejected", "data": { "status": "REJECTED" } }`
Writes a `REJECT` row to `saws-appointment-logs`, triggers the cancellation notification.

### `PATCH /appointments/{appointmentId}/cancel`
Cancel own upcoming appointment. Role: owning `Patient`.

Response `200`: `{ "message": "Appointment cancelled", "data": { "status": "CANCELLED" } }`
Writes a `CANCEL` row to `saws-appointment-logs`.

### `GET /appointments/{appointmentId}/logs`
Audit trail for one appointment (every BOOK/APPROVE/REJECT/CANCEL entry, in order). Role:
`Coordinator`. Backed by the `appointmentId-index` GSI on `saws-appointment-logs`.

Response `200`: array of `{ logId, action, performedBy, details, createdAt }`.

---

## 4. Feedback

### `POST /feedback`
Submit feedback for a completed appointment. Role: `Patient`.

Request:
```json
{ "appointmentId": "A1B2C3D4", "serviceId": "svc-001", "feedbackText": "Great experience." }
```
Response `201`:
```json
{ "message": "Feedback submitted", "data": { "feedbackId": "F1", "sentimentLabel": null } }
```
`sentimentLabel`/`sentimentScore`/`sentimentMagnitude` start `null` and are filled in by the
analytics module's sentiment pipeline; the frontend should poll or re-fetch rather than expect
sentiment synchronously in this response.

### `GET /feedback`
List all feedback with sentiment. Public — guests can view overall feedback per the requirement
document.

Response `200`: array of `{ feedbackId, patientUsername, serviceId, feedbackText,
sentimentScore, sentimentLabel, createdAt }`.

### `GET /feedback?serviceId={serviceId}`
Filter feedback by service. Public. Backed by the `serviceId-index` GSI.

---

## 5. Authentication — placeholder, owned by the authentication module

Not finalized here. What's confirmed so far from the authentication module:
- Stage 1 (Cognito username/password) issues a `sessionId`, returned to the frontend and sent
  back as an `x-session-id` header on stages 2 and 3.
- Stage 2 validates the security answer against `UserSecurity`; stage 3 validates the Caesar
  cipher answer against the same table.
- `AuthSessions.fullyAuthenticated` becomes `true` only once all 3 stages pass — this is what
  the API Gateway authorizer checks before allowing calls to the endpoints in §2–§4.

Exact request/response bodies for `/auth/register` and `/auth/login/stage1|2|3` are pending
confirmation from the authentication module — placeholder only, not to be built against yet.

---

## 6. Next Steps

1. Confirm this contract covers what the booking/approval module and frontend need before they
   start building against it.
2. Fill in §5 once the authentication module confirms exact request/response shapes.
3. Move to the architecture diagram update.

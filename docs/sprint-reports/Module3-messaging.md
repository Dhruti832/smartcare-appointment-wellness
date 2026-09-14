# Sprint 1 Research – Message Passing (Module 3)

**Services researched:** GCP Pub/Sub, GCP Cloud Functions, Firestore

---

## 1. What we need to build

An asynchronous messaging layer that receives patient concerns submitted through the chatbot (Module 2) and forwards them to a randomly assigned Wellness Coordinator. Once assigned, the system must support back-and-forth real-time chat between the patient and the coordinator. The architecture diagram marks the real-time chat as an additional feature.

---

## 2. How GCP Pub/Sub works

Pub/Sub is a fully managed publish-subscribe messaging service. A **publisher** sends a message to a named **topic**, and one or more **subscribers** receive it. Unlike SQS (which is point-to-point queue), Pub/Sub supports fan-out: multiple independent subscribers can receive the same message simultaneously.

In our system Pub/Sub has one focused job: receive the patient concern published by the Dialogflow Cloud Function and deliver it to the coordinator-assignment Cloud Function. Everything after that (the actual chat thread) lives in Firestore.

---

## 3. Message passing flow

```
Dialogflow Cloud Function (concern.submit intent)
     |
     v  publish: { patientId, concernText, timestamp, sessionId }
GCP Pub/Sub topic: patient-concerns
     |
     v  push subscription (HTTP trigger)
Cloud Function: concern-router
     |-- query Firestore: coordinators collection --> pick one at random
     v
Firestore: communication-logs collection
     { concernId, patientId, coordinatorId, concernText, status: "open", createdAt, messages: [] }
```

The `concern-router` Cloud Function is triggered automatically by the Pub/Sub push subscription every time a message arrives. It does not poll; GCP delivers the message by HTTP to the function.

---

## 4. Topic and subscription design

We are using one topic (`patient-concerns`) with one push subscription pointing to the `concern-router` Cloud Function. This is sufficient because:

- Only one message type flows through this topic (patient concerns).
- We do not need fan-out to multiple independent consumers.
- A push subscription means the Cloud Function is invoked automatically without us managing a polling loop.

If a future sprint adds a second message type (e.g., coordinator-to-patient replies routed through Pub/Sub), we would add a separate topic rather than mixing message types in one.

---

## 5. Random coordinator assignment

The project specification requires coordinator assignment to be random. The `concern-router` Cloud Function implements this as follows:

1. Query the `coordinators` Firestore collection to get all active coordinator user IDs.
2. Pick one at random using `Math.random()` on the resulting array.
3. Write the concern document to `communication-logs` with the selected `coordinatorId` and `status: "open"`.

This logic lives entirely inside the Cloud Function and requires no changes to the Pub/Sub configuration.

---

## 6. Firestore collections for Module 3

| Collection | Key fields | Purpose |
|---|---|---|
| `coordinators` | userId, name, email, isActive | Roster queried for random assignment |
| `communication-logs` | concernId, patientId, coordinatorId, concernText, messages[], status, createdAt | Stores the full concern thread including chat history |

The `messages[]` array inside each `communication-logs` document holds the back-and-forth chat history for the real-time sync feature (Section 7).

---

## 7. Real-time sync chat (additional feature)

Once a concern is routed and the `communication-logs` document exists, both the patient and the assigned coordinator need a way to exchange follow-up messages without submitting new concerns.

The approach is to use **Firestore's real-time listener** (`onSnapshot`) on the `communication-logs` document for that concern. Both the patient's and the coordinator's React sessions subscribe to the same document. When either side appends a message to the `messages[]` array, Firestore pushes the update to both clients instantly, producing a live chat experience with no polling and no additional backend infrastructure.

Pub/Sub is not needed for the chat messages themselves. It is only needed for the initial concern routing step. Once the document exists, Firestore listeners handle everything.

Implementation note: this feature requires the React frontend to hold an authenticated Firestore session (Firebase SDK) so it can listen to document changes. Only the patient who submitted the concern and the assigned coordinator should be able to read and write that document; Firestore security rules enforce this.

---

## 8. At-least-once delivery and idempotency

Pub/Sub guarantees **at-least-once delivery**, meaning the push subscription could theoretically invoke the `concern-router` Cloud Function more than once for the same message (for example, if the function returned a non-200 status on the first attempt and GCP retried).

To prevent a duplicate concern document being created, the function checks whether a document with the incoming `concernId` already exists in `communication-logs` before writing. If it does, the function returns 200 immediately to acknowledge the duplicate without creating a second record.

---

## 9. Cost

At course-project scale everything stays within GCP free tiers:

- Pub/Sub: 10 GB of message data free per month; concern messages are a few hundred bytes each.
- Cloud Functions: 2M invocations free per month.
- Firestore: 1 GB storage, 50K reads, 20K writes free per day.

---

## 10. Conclusion – what we decided

- **GCP Pub/Sub** with a single `patient-concerns` topic and a push subscription to the `concern-router` Cloud Function, which assigns a random coordinator and writes to Firestore.
- **Firestore `onSnapshot` listeners** for the real-time patient–coordinator chat (additional feature). Pub/Sub is not needed for the chat messages once the concern document exists in Firestore.
- **Idempotency check** on `concernId` in the Cloud Function to handle Pub/Sub at-least-once delivery safely.
- No new architecture changes required for Module 3 in Sprint 2, but we will verify that the `coordinators` Firestore collection is seeded before end-to-end testing of the concern routing flow.

---

## 11. References

- GCP Pub/Sub documentation (topics, push subscriptions, at-least-once delivery)
- GCP Cloud Functions documentation (HTTP triggers, Pub/Sub triggers)
- Firestore documentation (collections, real-time listeners / onSnapshot, security rules)
- SAWS Architecture Decision document (cross-cloud seam, module distribution rationale)
- Module 2 research (concern.submit fulfillment intent – the publisher side of this flow)

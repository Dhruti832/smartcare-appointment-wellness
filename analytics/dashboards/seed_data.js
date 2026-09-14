// Seeds Firestore with sample feedback + appointments + login events so the
// Looker Studio dashboard has data to chart before the live pipelines are
// wired end to end.
//
// Shapes mirror what the AWS side replicates into Firestore:
//   - feedback: the saws-feedback row (incl. the flat sentiment* fields the
//     sentiment Lambda writes via the Google NL API — see erd.md §2.4 and
//     backend/feedback).
//   - appointments: the lightweight mirror record the appointments module produces.
//   - loginEvents: scoped in erd.md §3 (userId, timestamp, role), not yet
//     produced by a live pipeline as of Sprint 3 -- seeded here so the
//     login-stats + total-patients dashboard metrics can be built and tested
//     ahead of that mirror landing.
//
// All doc IDs use fake/prefixed values (FB-00X, APT-100X, LOGIN-00X) so this
// data is easy to tell apart from anything a real pipeline writes, and easy
// to delete later.
//
// Usage (auth is Application Default Credentials — the shared project blocks
// service-account key creation, so there is no key file to point at):
//   gcloud auth application-default login
//   GCLOUD_PROJECT=<your-gcp-project-id> node analytics/dashboards/seed_data.js

const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();

const feedback = [
  { feedbackId: 'FB-001', patientUsername: 'anita',  appointmentId: 'APT-1001', serviceId: 'Physiotherapy',        feedbackText: 'The physiotherapist was wonderful and really listened.', sentimentScore: 0.82,  sentimentMagnitude: 0.9,  sentimentLabel: 'POSITIVE' },
  { feedbackId: 'FB-002', patientUsername: 'ben',    appointmentId: 'APT-1002', serviceId: 'Nutrition Counselling', feedbackText: 'Helpful advice but the wait was a bit long.',            sentimentScore: 0.15,  sentimentMagnitude: 0.6,  sentimentLabel: 'NEUTRAL'  },
  { feedbackId: 'FB-003', patientUsername: 'carlos', appointmentId: 'APT-1003', serviceId: 'Mental Health',        feedbackText: 'Terrible experience, felt rushed and unheard.',          sentimentScore: -0.78, sentimentMagnitude: 0.85, sentimentLabel: 'NEGATIVE' },
  { feedbackId: 'FB-004', patientUsername: 'divya',  appointmentId: 'APT-1005', serviceId: 'Physiotherapy',        feedbackText: 'Okay overall, nothing special.',                         sentimentScore: 0.05,  sentimentMagnitude: 0.2,  sentimentLabel: 'NEUTRAL'  },
  { feedbackId: 'FB-005', patientUsername: 'evan',   appointmentId: 'APT-1005', serviceId: 'Physiotherapy',        feedbackText: 'Fantastic care, I feel so much better already!',         sentimentScore: 0.9,   sentimentMagnitude: 0.95, sentimentLabel: 'POSITIVE' },
  { feedbackId: 'FB-006', patientUsername: 'farah',  appointmentId: 'APT-1007', serviceId: 'Mental Health',        feedbackText: 'Rude staff and confusing booking process.',              sentimentScore: -0.55, sentimentMagnitude: 0.7,  sentimentLabel: 'NEGATIVE' },
];

const appointments = [
  { refCode: 'APT-1001', date: '2026-07-02', service: 'Physiotherapy',        status: 'APPROVED' },
  { refCode: 'APT-1002', date: '2026-07-03', service: 'Nutrition Counselling', status: 'PENDING' },
  { refCode: 'APT-1003', date: '2026-07-03', service: 'Mental Health',        status: 'APPROVED' },
  { refCode: 'APT-1004', date: '2026-07-04', service: 'Physiotherapy',        status: 'CANCELLED' },
  { refCode: 'APT-1005', date: '2026-07-05', service: 'Physiotherapy',        status: 'APPROVED' },
  { refCode: 'APT-1006', date: '2026-07-05', service: 'General Consultation', status: 'REJECTED' },
  { refCode: 'APT-1007', date: '2026-07-06', service: 'Mental Health',        status: 'PENDING' },
];

// role matches the Cognito group name (Patient | Coordinator), per erd.md's
// note that role lives only in Cognito/loginEvents, never on a users table.
const loginEvents = [
  { username: 'anita',  role: 'Patient',     timestamp: '2026-07-20T09:12:00Z' },
  { username: 'ben',    role: 'Patient',     timestamp: '2026-07-20T10:03:00Z' },
  { username: 'carlos', role: 'Patient',     timestamp: '2026-07-21T08:45:00Z' },
  { username: 'divya',  role: 'Patient',     timestamp: '2026-07-21T14:22:00Z' },
  { username: 'evan',   role: 'Patient',     timestamp: '2026-07-22T09:00:00Z' },
  { username: 'farah',  role: 'Patient',     timestamp: '2026-07-22T09:00:00Z' },
  { username: 'anita',  role: 'Patient',     timestamp: '2026-07-23T09:30:00Z' }, // repeat login, same user
  { username: 'grace',  role: 'Coordinator', timestamp: '2026-07-23T08:00:00Z' },
  { username: 'harish', role: 'Coordinator', timestamp: '2026-07-24T08:15:00Z' },
];

async function seed() {
  const batch = db.batch();

  for (const f of feedback) {
    batch.set(db.collection('feedback').doc(f.feedbackId), { ...f, createdAt: new Date() });
  }
  // Appointments are keyed by refCode to match the mirror's document id.
  // syncedAt makes every write a real change: the Firestore->BigQuery stream
  // extension emits no event for a byte-identical write, so without a value
  // that changes each run, re-seeding would never re-stream appointments to
  // BigQuery (feedback already avoids this via its createdAt timestamp).
  for (const a of appointments) {
    batch.set(db.collection('appointments').doc(a.refCode), { ...a, syncedAt: new Date() });
  }
  // Auto-generated IDs are fine here -- loginEvents is queried by
  // username/timestamp, never looked up by document id.
  loginEvents.forEach((e, i) => {
    batch.set(db.collection('loginEvents').doc(`LOGIN-${String(i + 1).padStart(3, '0')}`), e);
  });

  await batch.commit();
  console.log(`Seeded ${feedback.length} feedback docs, ${appointments.length} appointments, ${loginEvents.length} login events.`);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

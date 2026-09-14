const { parseFeedbackRow, toFirestoreDoc } = require('../feedback_row');

// This is the read hop: proves the exact bytes export_feedback_csv.py (AWS)
// writes to S3 parse into the exact Firestore document shape the existing
// GCP-side readers already depend on (analytics/dashboards/seed_data.js,
// docs/architecture/erd.md §3, analytics/dashboards/looker-setup.md §2.1) --
// verified before wiring the live HTTP fetch / Firestore write, so a schema
// mismatch surfaces here rather than after a real cross-cloud round trip.
const EXPORTED_CSV =
  'feedbackId,patientUsername,appointmentId,serviceId,feedbackText,sentimentScore,sentimentMagnitude,sentimentLabel,createdAt\r\n' +
  'FB-1,anita,APT-1,svc-1,"Great service, would come back",0.8,0.9,POSITIVE,2026-07-01\r\n';

test('parseFeedbackRow extracts the row matching the expected feedbackId', () => {
  const row = parseFeedbackRow(EXPORTED_CSV, 'FB-1');
  expect(row.feedbackId).toBe('FB-1');
  expect(row.feedbackText).toBe('Great service, would come back');
});

test('parseFeedbackRow rejects a CSV that does not match the expected feedbackId', () => {
  const row = parseFeedbackRow(EXPORTED_CSV, 'FB-OTHER');
  expect(row).toBeNull();
});

test('toFirestoreDoc produces the exact shape existing GCP-side readers expect', () => {
  const row = parseFeedbackRow(EXPORTED_CSV, 'FB-1');
  const doc = toFirestoreDoc(row);

  expect(doc).toEqual({
    feedbackId: 'FB-1',
    patientUsername: 'anita',
    appointmentId: 'APT-1',
    serviceId: 'svc-1',
    feedbackText: 'Great service, would come back',
    sentimentScore: 0.8,
    sentimentMagnitude: 0.9,
    sentimentLabel: 'POSITIVE',
    createdAt: '2026-07-01',
  });
  expect(typeof doc.sentimentScore).toBe('number');
  expect(typeof doc.sentimentMagnitude).toBe('number');
});

test('toFirestoreDoc turns missing sentiment fields into null instead of NaN/empty string', () => {
  const csv =
    'feedbackId,patientUsername,appointmentId,serviceId,feedbackText,sentimentScore,sentimentMagnitude,sentimentLabel,createdAt\r\n' +
    'FB-2,ben,APT-2,svc-2,No sentiment yet,,,,2026-07-02\r\n';
  const doc = toFirestoreDoc(parseFeedbackRow(csv, 'FB-2'));

  expect(doc.sentimentScore).toBeNull();
  expect(doc.sentimentMagnitude).toBeNull();
  expect(doc.sentimentLabel).toBeNull();
});

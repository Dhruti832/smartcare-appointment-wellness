const { parse } = require('csv-parse/sync');

// Pure parsing/shaping logic, split out from index.js so it can be unit
// tested without a Firestore connection or an HTTP request (see
// test/feedback_row.test.js) -- the same reason mirror_to_firestore.py's
// deserialize step is a separate function from its Firestore call.

const NUMERIC_FIELDS = ['sentimentScore', 'sentimentMagnitude'];

// export_feedback_csv.py (backend/feedback) is the only writer of this CSV,
// so the header/column set is fixed and known ahead of time.
const FIELDS = [
  'feedbackId', 'patientUsername', 'appointmentId', 'serviceId',
  'feedbackText', 'sentimentScore', 'sentimentMagnitude', 'sentimentLabel',
  'createdAt',
];

function parseFeedbackRow(csvText, expectedFeedbackId) {
  const [row] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (!row || row.feedbackId !== expectedFeedbackId) {
    return null;
  }
  return row;
}

// Shape written to Firestore -- must match what analytics/dashboards/seed_data.js
// seeds and what docs/architecture/erd.md §3 / looker-setup.md §2.1 already
// assume the `feedback` collection looks like, since Looker/BigQuery and the
// seed script are existing readers of this exact schema.
function toFirestoreDoc(row) {
  const doc = {};
  for (const field of FIELDS) {
    const value = row[field];
    if (NUMERIC_FIELDS.includes(field)) {
      doc[field] = value === '' || value === undefined ? null : Number(value);
    } else {
      doc[field] = value === undefined || value === '' ? null : value;
    }
  }
  return doc;
}

module.exports = { parseFeedbackRow, toFirestoreDoc, FIELDS };

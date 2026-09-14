const { parse } = require('csv-parse/sync');

// Pure parsing/shaping logic, split out from index.js so it can be unit
// tested without a Firestore connection or an HTTP request (see
// test/appointment_row.test.js). Mirror of analytics/functions/feedback_row.js.

// backend/appointments/mirror_to_firestore.py is the only writer of this CSV,
// so the header/column set is fixed and known ahead of time.
const FIELDS = ['refCode', 'date', 'service', 'status'];

function parseAppointmentRow(csvText, expectedRefCode) {
  const [row] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (!row || row.refCode !== expectedRefCode) {
    return null;
  }
  return row;
}

// Shape written to Firestore's `appointments` collection -- matches what
// analytics/dashboards/seed_data.js seeds and what the chatbot reads for
// appointment lookups.
function toFirestoreDoc(row) {
  const doc = {};
  for (const field of FIELDS) {
    const value = row[field];
    doc[field] = value === undefined || value === '' ? null : value;
  }
  return doc;
}

module.exports = { parseAppointmentRow, toFirestoreDoc, FIELDS };

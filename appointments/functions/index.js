const https = require('https');
const { Firestore } = require('@google-cloud/firestore');
const { parseAppointmentRow, toFirestoreDoc } = require('./appointment_row');

const db = new Firestore();
const FIRESTORE_COLLECTION = 'appointments';

// GCP half of the cross-cloud appointments mirror. AWS's mirror_to_firestore.py
// (backend/appointments) writes each appointment to S3 as CSV and POSTs this
// function a short-lived presigned URL rather than handing GCP a standing AWS
// credential -- this function fetches that one object, parses it, and upserts
// it into Firestore's `appointments` collection, where the chatbot reads it for
// appointment lookups. Mirror of analytics/functions (feedbackMirror); uses the
// keyless S3-presigned pattern because Workload Identity Federation pool
// creation is blocked by org policy on this project.
exports.appointmentsMirror = async (req, res) => {
  const expectedSecret = process.env.EXPORT_SHARED_SECRET;
  if (expectedSecret && req.get('X-Export-Token') !== expectedSecret) {
    return res.status(403).send('Forbidden');
  }

  const { appointmentId, csvUrl } = req.body || {};
  if (!appointmentId || !csvUrl) {
    return res.status(400).send('Missing appointmentId/csvUrl');
  }

  let csvText;
  try {
    csvText = await fetchText(csvUrl);
  } catch (err) {
    console.error(`Failed to fetch export for ${appointmentId}:`, err.message);
    return res.status(502).send('Fetch failed');
  }

  const row = parseAppointmentRow(csvText, appointmentId);
  if (!row) {
    console.error(`CSV content did not match appointmentId ${appointmentId}`);
    return res.status(400).send('CSV content does not match appointmentId');
  }

  await db.collection(FIRESTORE_COLLECTION).doc(appointmentId).set(toFirestoreDoc(row), { merge: true });

  console.log(`Mirrored appointment ${appointmentId} to Firestore`);
  res.status(200).send('OK');
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      if (resp.statusCode !== 200) {
        resp.resume();
        reject(new Error(`Unexpected status ${resp.statusCode}`));
        return;
      }
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

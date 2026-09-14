const https = require('https');
const { Firestore } = require('@google-cloud/firestore');
const { parseFeedbackRow, toFirestoreDoc } = require('./feedback_row');

const db = new Firestore();
const FIRESTORE_COLLECTION = 'feedback';

// GCP half of the cross-cloud feedback mirror (Module 5 / analytics). AWS's
// export_feedback_csv.py (backend/feedback) writes a scored feedback row to
// S3 as CSV and POSTs this function a short-lived presigned URL rather than
// handing GCP a standing AWS credential -- this function's only job is to
// fetch that one object, parse it, and upsert it into Firestore so Looker
// Studio (via the BigQuery export, see analytics/dashboards/looker-setup.md)
// reads it locally. See architectural_decisions.md §9 and §4 for the
// equivalent (Firestore-direct) appointments mirror this pattern mirrors.
exports.feedbackMirror = async (req, res) => {
  const expectedSecret = process.env.EXPORT_SHARED_SECRET;
  if (expectedSecret && req.get('X-Export-Token') !== expectedSecret) {
    return res.status(403).send('Forbidden');
  }

  const { feedbackId, csvUrl } = req.body || {};
  if (!feedbackId || !csvUrl) {
    return res.status(400).send('Missing feedbackId/csvUrl');
  }

  let csvText;
  try {
    csvText = await fetchText(csvUrl);
  } catch (err) {
    console.error(`Failed to fetch export for ${feedbackId}:`, err.message);
    return res.status(502).send('Fetch failed');
  }

  const row = parseFeedbackRow(csvText, feedbackId);
  if (!row) {
    console.error(`CSV content did not match feedbackId ${feedbackId}`);
    return res.status(400).send('CSV content does not match feedbackId');
  }

  await db.collection(FIRESTORE_COLLECTION).doc(feedbackId).set(toFirestoreDoc(row), { merge: true });

  console.log(`Mirrored feedback ${feedbackId} to Firestore`);
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

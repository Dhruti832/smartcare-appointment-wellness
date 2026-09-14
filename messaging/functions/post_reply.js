const { randomUUID } = require('crypto');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const db = new Firestore();

const SENDERS = ['patient', 'coordinator'];

// Closes the messaging loop: until Sprint 3 a concern was one-way (patient →
// Pub/Sub → coordinator's dashboard) with no way to answer it. Replies are
// appended to the `messages` array on the concern's communicationLogs document
// — Pub/Sub routes the *first* message only, the thread afterwards lives in
// Firestore (see docs/sprint-reports/Module3-messaging.md §7).
//
// POST { concernId, sender: 'patient'|'coordinator', senderId, message }
//   → 201 { message, concernId, messageCount }
// GET  ?concernId=<id>
//   → 200 { concernId, patientId, coordinatorId, status, messages: [...] }
exports.postReply = async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method === 'GET') return getThread(req, res);
  if (req.method !== 'POST') return res.status(405).json({ message: 'Use POST or GET' });

  const { concernId, sender, senderId, message } = req.body || {};
  if (!concernId || !sender || !message) {
    return res.status(400).json({ message: 'concernId, sender and message are required' });
  }
  if (!SENDERS.includes(sender)) {
    return res.status(400).json({ message: `sender must be one of: ${SENDERS.join(', ')}` });
  }

  const docRef = db.collection('communicationLogs').doc(concernId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return res.status(404).json({ message: `No concern found with id ${concernId}` });
  }

  // arrayUnion appends atomically, so a patient and a coordinator replying at
  // the same moment cannot overwrite each other (a read-modify-write would).
  // messageId keeps otherwise-identical replies distinct, since arrayUnion
  // treats exact duplicates as already present.
  const entry = {
    messageId: randomUUID(),
    sender,
    senderId: senderId || null,
    text: message,
    sentAt: new Date().toISOString(),
  };

  await docRef.update({
    messages: FieldValue.arrayUnion(entry),
    lastMessageAt: entry.sentAt,
    lastMessageBy: sender,
  });

  const existing = snap.get('messages') || [];
  console.log(`Reply from ${sender} added to concern ${concernId}`);
  return res.status(201).json({
    message: 'Reply added',
    concernId,
    messageCount: existing.length + 1,
  });
};

async function getThread(req, res) {
  const concernId = req.query && req.query.concernId;
  if (!concernId) {
    return res.status(400).json({ message: 'concernId query parameter is required' });
  }

  const snap = await db.collection('communicationLogs').doc(concernId).get();
  if (!snap.exists) {
    return res.status(404).json({ message: `No concern found with id ${concernId}` });
  }

  const data = snap.data();
  return res.status(200).json({
    concernId,
    patientId: data.patientId,
    coordinatorId: data.coordinatorId,
    status: data.status,
    messages: data.messages || [],
  });
}

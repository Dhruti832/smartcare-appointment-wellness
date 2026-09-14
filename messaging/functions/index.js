const { randomUUID } = require('crypto');
const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();

// Pub/Sub push subscriber: forwards a patient concern to a random available
// coordinator. If none is available the concern is still logged (UNASSIGNED)
// so it can be picked up later instead of crashing and being redelivered.
exports.handleMessage = async (req, res) => {
  const message = req.body && req.body.message;
  if (!message || !message.data) return res.status(400).send('No message');

  let data;
  try {
    data = JSON.parse(Buffer.from(message.data, 'base64').toString());
  } catch (err) {
    // Malformed payloads must still be acked, otherwise Pub/Sub redelivers
    // them forever.
    console.error('Dropping malformed message:', err.message);
    return res.status(200).send('Dropped malformed message');
  }

  const { patientId, concern, sessionId } = data;
  const coordinator = await assignCoordinator();
  const now = new Date();

  // `concern` is kept for the existing coordinator dashboard read; the same
  // text also opens the `messages` thread that postReply appends to, so the UI
  // can render one conversation instead of a concern plus separate replies.
  await db.collection('communicationLogs').add({
    patientId: patientId || 'unknown',
    coordinatorId: coordinator ? coordinator.id : null,
    concern: concern || '',
    sessionId: sessionId || null,
    status: coordinator ? 'OPEN' : 'UNASSIGNED',
    createdAt: now,
    messages: [{
      messageId: randomUUID(),
      sender: 'patient',
      senderId: patientId || 'unknown',
      text: concern || '',
      sentAt: now.toISOString(),
    }],
    lastMessageAt: now.toISOString(),
    lastMessageBy: 'patient',
  });

  console.log(
    coordinator
      ? `Concern from patient ${patientId} assigned to coordinator ${coordinator.id}`
      : `No coordinator available — concern from patient ${patientId} logged as UNASSIGNED`
  );
  res.status(200).send('OK');
};

async function assignCoordinator() {
  const snap = await db.collection('coordinators').where('available', '==', true).get();
  if (snap.empty) return null;
  const doc = snap.docs[Math.floor(Math.random() * snap.docs.length)];
  return { id: doc.id, ...doc.data() };
}

// All three functions deploy from this one source bundle; Cloud Functions
// resolves each entry point from the main module's exports.
exports.publishConcern = require('./publish_concern').publishConcern;
exports.postReply = require('./post_reply').postReply;

// Exported for reassign_unassigned.js so the backlog sweep uses the same
// random-assignment rule as live routing.
exports.assignCoordinator = assignCoordinator;

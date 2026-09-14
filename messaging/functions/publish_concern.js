const { PubSub } = require('@google-cloud/pubsub');

const pubsub = new PubSub();
const TOPIC_NAME = process.env.CONCERNS_TOPIC || 'saws-patient-concerns-dev';

// HTTP endpoint for the frontend "submit concern" form and the chatbot's
// SubmitConcern intent. Publishes the concern to Pub/Sub; the subscriber
// (handleMessage) assigns it to a coordinator asynchronously.
exports.publishConcern = async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ message: 'Use POST' });

  const { patientId, concern, sessionId } = req.body || {};
  if (!patientId || !concern) {
    return res.status(400).json({ message: 'patientId and concern are required' });
  }

  const messageId = await pubsub
    .topic(TOPIC_NAME)
    .publishMessage({ json: { patientId, concern, sessionId: sessionId || null } });

  console.log(`Published concern ${messageId} from patient ${patientId}`);
  return res.status(202).json({ message: 'Concern submitted', messageId });
};

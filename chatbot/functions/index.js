const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();

// Dialogflow fulfillment webhook handler
exports.fulfillment = async (req, res) => {
  // Only Dialogflow calls this with a WebhookRequest body (POST,
  // queryResult.intent set) — a bare GET (e.g. someone opening the URL in a
  // browser to sanity-check the deploy) has no body at all and would
  // otherwise crash reading .queryResult.intent off undefined.
  if (!req.body || !req.body.queryResult || !req.body.queryResult.intent) {
    return res.status(400).json({ fulfillmentText: 'This endpoint expects a Dialogflow webhook POST request.' });
  }

  const intent = req.body.queryResult.intent.displayName;
  const params = req.body.queryResult.parameters;
  const sessionId = req.body.session;
  const payload = (req.body.originalDetectIntentRequest && req.body.originalDetectIntentRequest.payload) || {};

  let responseText = '';

  switch (intent) {
    case 'Navigation':
      responseText = getNavigationHelp(params.topic);
      break;
    case 'AppointmentLookup':
      responseText = await lookupAppointment(params.referenceCode);
      break;
    case 'WellnessInquiry':
      responseText = await getWellnessInfo(params.serviceType);
      break;
    case 'SubmitConcern':
      responseText = await submitConcern(params.concern, sessionId, payload.patientId);
      break;
    case 'FAQ':
      responseText = await getFAQ(params.topic);
      break;
    default:
      responseText = 'I can help you navigate SAWS, look up appointments, or answer wellness questions.';
  }

  res.json({ fulfillmentText: responseText });
};

// Static — no Firestore/Pub/Sub dependency, matches the response configured
// directly on the Dialogflow intent. Kept here too so a webhook-enabled
// Navigation intent (or a direct fulfillment call in tests) behaves the same.
function getNavigationHelp(topic) {
  const sections = {
    booking: 'To book an appointment, go to Dashboard > Book Appointment, pick a service and time slot, and confirm.',
    dashboard: 'Your dashboard shows upcoming appointments, wellness packages, and any coordinator messages.',
    profile: 'You can update your profile and security questions from the account menu in the top right.',
  };
  if (topic && sections[topic]) return sections[topic];
  return 'I can help you navigate SAWS: try asking about booking an appointment, your dashboard, or your profile.';
}

async function lookupAppointment(referenceCode) {
  if (!referenceCode) return 'Please provide your appointment reference code.';
  const snap = await db.collection('appointments').doc(referenceCode).get();
  if (!snap.exists) return `No appointment found for reference code ${referenceCode}.`;
  const appt = snap.data();
  const service = await resolveServiceName(appt.service);
  const timePart = appt.time ? ` at ${appt.time}` : '';
  return `Appointment ${referenceCode}: ${service} on ${appt.date}${timePart}. Status: ${appt.status}.`;
}

// The AWS -> Firestore appointment mirror (backend/appointments/mirror_to_firestore.py)
// writes the raw DynamoDB `serviceId` into the `service` field, not a display
// name -- the mirror only touches the appointments table, it has no
// visibility into the services catalog. This module's own Firestore
// `services` collection (seeded by seed_dialogflow_data.js) is keyed by
// auto-generated doc IDs with `name`/`type` fields, so it can't be joined on
// serviceId today either. Try both plausible shapes (a `serviceId` field, or
// the value used directly as the doc ID) so this starts resolving real names
// the moment either side adds that linkage, without needing a redeploy here.
// Until then, fall back to a labeled raw value instead of pretending it's a
// name -- and log it, since a raw ID showing up here is a real signal the
// services catalog needs its own cross-cloud mirror (tracked separately,
// this isn't a fix this module can complete alone).
async function resolveServiceName(serviceValue) {
  if (!serviceValue) return 'an unspecified service';

  const byField = await db.collection('services').where('serviceId', '==', serviceValue).limit(1).get();
  if (!byField.empty) return byField.docs[0].data().name;

  const byDocId = await db.collection('services').doc(serviceValue).get();
  if (byDocId.exists) return byDocId.data().name;

  // No catalog match -- most likely this Firestore `appointments` doc
  // already stores a display name (e.g. the seeded stub, or a future mirror
  // update), so returning it unchanged keeps that case looking normal.
  // If it's actually a raw AWS serviceId, this log line is what surfaces
  // the mismatch (the user sees the raw value either way -- there is no
  // safe way to guess a name from an opaque ID).
  console.warn(`resolveServiceName: no Firestore services doc matches "${serviceValue}" by serviceId or doc ID -- returning it as-is`);
  return serviceValue;
}

async function getWellnessInfo(serviceType) {
  if (!serviceType) return 'Which wellness service are you interested in?';
  const snap = await db.collection('services').where('type', '==', serviceType).limit(3).get();
  if (snap.empty) return `No services found for "${serviceType}".`;
  const names = snap.docs.map((d) => d.data().name).join(', ');
  return `Available ${serviceType} services: ${names}.`;
}

// Publishes to the messaging module's Pub/Sub-backed publishConcern Cloud
// Function so submitted concerns feed the same coordinator-assignment flow
// as the frontend "submit a concern" form (see messaging/README.md). Falls
// back to a direct Firestore write only when PUBLISH_CONCERN_URL isn't
// configured yet (e.g. messaging isn't deployed in this environment) so the
// intent still works end-to-end during early development.
async function submitConcern(concern, sessionId, patientId) {
  if (!concern) return 'Please describe the concern you would like to submit.';

  const publishUrl = process.env.PUBLISH_CONCERN_URL;
  if (publishUrl) {
    const resp = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: patientId || sessionId, concern, sessionId }),
    });
    if (!resp.ok) {
      console.error(`publishConcern returned ${resp.status}`);
      return 'Sorry, I could not submit your concern right now. Please try again shortly.';
    }
    return 'Your concern has been submitted. A wellness coordinator will follow up with you shortly.';
  }

  await db.collection('concerns').add({ concern, sessionId, patientId: patientId || null, createdAt: new Date(), status: 'PENDING' });
  return 'Your concern has been submitted. A wellness coordinator will follow up with you shortly.';
}

async function getFAQ(topic) {
  if (!topic) return "What would you like to know? I can answer questions about hours, booking, and more.";
  const snap = await db.collection('faq').where('topic', '==', topic).limit(1).get();
  if (snap.empty) return `I don't have information on "${topic}" yet. Please contact a coordinator.`;
  return snap.docs[0].data().answer;
}

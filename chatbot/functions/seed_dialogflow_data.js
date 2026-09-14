// One-off seeder: populates Firestore `services` and `faq` (which the
// chatbot owns) plus a single fallback `appointments` doc so AppointmentLookup
// has something to return before the cross-cloud mirror (Appointments/04) is
// wired up end-to-end for a demo. Entity values here must match the
// @service-type and @faq-topic entities in chatbot/dialogflow/entities/.
// Run from chatbot/functions (where the dependencies are installed):
//   node seed_dialogflow_data.js
const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();

const services = [
  { name: 'Morning Yoga', type: 'yoga' },
  { name: 'Restorative Yoga', type: 'yoga' },
  { name: 'Sports Physiotherapy', type: 'physiotherapy' },
  { name: 'Post-injury Physiotherapy', type: 'physiotherapy' },
  { name: '1:1 Nutrition Coaching', type: 'nutrition' },
  { name: 'Mental Health Counselling', type: 'mental-health' },
];

const faqs = [
  { topic: 'hours', answer: 'We are open 9am-5pm, Monday to Friday.' },
  { topic: 'booking', answer: 'You can book an appointment from your dashboard under "Book Appointment" once you are logged in.' },
  { topic: 'cancellation', answer: 'Appointments can be cancelled up to 24 hours in advance from your dashboard, free of charge.' },
  { topic: 'insurance', answer: 'We accept most major insurance providers. Bring your insurance card to your first appointment.' },
  { topic: 'login', answer: 'Login uses a 3-stage process: password, a security question, then a cipher-based one-time code shown at registration.' },
];

// Fallback only — real appointments docs are written by the AWS -> Firestore
// mirror (backend/appointments/mirror_to_firestore.py) keyed by refCode.
const fallbackAppointment = {
  refCode: 'APT-DEMO-1',
  service: 'Sports Physiotherapy',
  date: '2026-07-20',
  time: '10:00',
  status: 'CONFIRMED',
};

(async () => {
  for (const service of services) {
    const ref = await db.collection('services').add(service);
    console.log(`Seeded service ${ref.id} (${service.name}, type: ${service.type})`);
  }

  for (const faq of faqs) {
    const ref = await db.collection('faq').add(faq);
    console.log(`Seeded FAQ ${ref.id} (topic: ${faq.topic})`);
  }

  await db.collection('appointments').doc(fallbackAppointment.refCode).set(fallbackAppointment);
  console.log(`Seeded fallback appointment ${fallbackAppointment.refCode}`);
})();

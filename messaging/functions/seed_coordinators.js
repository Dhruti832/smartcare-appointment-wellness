// One-off seeder: creates a few available coordinators in Firestore so the
// messaging module's random assignment has someone to assign concerns to.
// Run from messaging/functions (where the dependencies are installed):
//   node seed_coordinators.js
const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();

const coordinators = [
  { name: 'Coordinator One', email: 'coordinator1@example.com', available: true },
  { name: 'Coordinator Two', email: 'coordinator2@example.com', available: true },
  { name: 'Coordinator Three', email: 'coordinator3@example.com', available: false },
];

(async () => {
  for (const c of coordinators) {
    const ref = await db.collection('coordinators').add(c);
    console.log(`Seeded coordinator ${ref.id} (${c.name}, available: ${c.available})`);
  }
})();

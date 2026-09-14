// One-off sweep for the UNASSIGNED backlog: concerns submitted while the
// `coordinators` collection was empty were logged with status UNASSIGNED and
// coordinatorId null (by design — the subscriber acks rather than crashing).
// Once coordinators are seeded those concerns are still stranded, so this
// assigns each one using the same random rule as live routing.
//
// Run from messaging/functions (where the dependencies are installed), after
// seed_coordinators.js:
//   node reassign_unassigned.js
const { Firestore } = require('@google-cloud/firestore');
const { assignCoordinator } = require('./index');

const db = new Firestore();

(async () => {
  const snap = await db
    .collection('communicationLogs')
    .where('status', '==', 'UNASSIGNED')
    .get();

  if (snap.empty) {
    console.log('No UNASSIGNED concerns to reassign.');
    return;
  }

  let assigned = 0;
  for (const doc of snap.docs) {
    const coordinator = await assignCoordinator();
    if (!coordinator) {
      console.log(`No coordinator available — leaving ${doc.id} UNASSIGNED. Seed coordinators first.`);
      continue;
    }

    await doc.ref.update({ coordinatorId: coordinator.id, status: 'OPEN' });
    assigned += 1;
    console.log(`Concern ${doc.id} assigned to coordinator ${coordinator.id}`);
  }

  console.log(`Reassigned ${assigned} of ${snap.size} UNASSIGNED concern(s).`);
})();

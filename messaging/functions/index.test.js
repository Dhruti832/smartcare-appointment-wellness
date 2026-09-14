// Covers the Pub/Sub subscriber: random coordinator assignment, the
// no-coordinator fallback, and the message thread the concern now opens with
// (so postReply has something to append to). Firestore and Pub/Sub are mocked.

jest.mock('@google-cloud/firestore');
jest.mock('@google-cloud/pubsub');
const { Firestore } = require('@google-cloud/firestore');

const mockCollection = jest.fn();
Firestore.mockImplementation(() => ({ collection: mockCollection }));

const { handleMessage } = require('./index');

const mockAdd = jest.fn().mockResolvedValue({ id: 'log-1' });
const mockCoordinatorGet = jest.fn();

mockCollection.mockImplementation((name) => {
  if (name === 'coordinators') {
    return { where: jest.fn(() => ({ get: mockCoordinatorGet })) };
  }
  return { add: mockAdd, doc: jest.fn() };
});

function makeReq(payload) {
  return {
    body: { message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') } },
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

function coordinators(...ids) {
  return {
    empty: ids.length === 0,
    docs: ids.map((id) => ({ id, data: () => ({ name: id, available: true }) })),
  };
}

beforeEach(() => {
  mockAdd.mockClear();
  mockCoordinatorGet.mockReset();
});

test('a concern is assigned to an available coordinator and opens a thread', async () => {
  mockCoordinatorGet.mockResolvedValue(coordinators('coord-1'));
  const res = makeRes();

  await handleMessage(makeReq({
    patientId: 'patient-demo-1',
    concern: 'I need to reschedule my appointment',
    sessionId: 'sess-1',
  }), res);

  expect(res.status).toHaveBeenCalledWith(200);
  const doc = mockAdd.mock.calls[0][0];
  expect(doc).toMatchObject({
    patientId: 'patient-demo-1',
    coordinatorId: 'coord-1',
    status: 'OPEN',
    lastMessageBy: 'patient',
  });
  // The concern itself is the first message of the conversation.
  expect(doc.messages).toHaveLength(1);
  expect(doc.messages[0]).toMatchObject({
    sender: 'patient',
    senderId: 'patient-demo-1',
    text: 'I need to reschedule my appointment',
  });
  expect(doc.lastMessageAt).toBe(doc.messages[0].sentAt);
});

test('with no coordinator available the concern is still logged UNASSIGNED', async () => {
  mockCoordinatorGet.mockResolvedValue(coordinators());
  const res = makeRes();

  await handleMessage(makeReq({ patientId: 'patient-demo-2', concern: 'Billing question' }), res);

  // Acked, not failed — otherwise Pub/Sub would redeliver forever.
  expect(res.status).toHaveBeenCalledWith(200);
  expect(mockAdd.mock.calls[0][0]).toMatchObject({
    coordinatorId: null,
    status: 'UNASSIGNED',
  });
  // The thread is seeded either way, so reassign_unassigned.js only has to set
  // the coordinator and status.
  expect(mockAdd.mock.calls[0][0].messages).toHaveLength(1);
});

test('a malformed payload is acked and dropped without writing', async () => {
  const res = makeRes();

  await handleMessage({ body: { message: { data: 'not-base64-json' } } }, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(mockAdd).not.toHaveBeenCalled();
});

test('a request with no Pub/Sub message is rejected', async () => {
  const res = makeRes();

  await handleMessage({ body: {} }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockAdd).not.toHaveBeenCalled();
});

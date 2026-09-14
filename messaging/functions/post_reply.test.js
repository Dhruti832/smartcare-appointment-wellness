// Covers the reply half of the messaging loop: appending coordinator/patient
// replies to a concern's thread, and reading the thread back. Firestore is
// mocked, so these run without a GCP project — the live end-to-end evidence
// (real concern → real reply visible to both sides) is recorded separately in
// messaging/README.md.

jest.mock('@google-cloud/firestore');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

// mockCollection must be wired before post_reply.js runs `new Firestore()` at
// require time, and the module is only required once (module cache), so it is
// a single stable fn reset per test rather than recreated.
const mockCollection = jest.fn();
Firestore.mockImplementation(() => ({ collection: mockCollection }));
FieldValue.arrayUnion = jest.fn((entry) => ({ __arrayUnion: entry }));

const { postReply } = require('./post_reply');

function makeRes() {
  const res = {};
  res.set = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

// Wires db.collection('communicationLogs').doc(id) to a fake document.
function mockDoc({ exists = true, data = {} } = {}) {
  const update = jest.fn().mockResolvedValue({});
  const snap = {
    exists,
    data: () => data,
    get: (field) => data[field],
  };
  mockCollection.mockReturnValue({
    doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue(snap), update })),
  });
  return { update };
}

const openConcern = {
  patientId: 'patient-demo-1',
  coordinatorId: 'coord-1',
  status: 'OPEN',
  messages: [{ messageId: 'm1', sender: 'patient', text: 'I need to reschedule', sentAt: '2026-07-25T10:00:00.000Z' }],
};

beforeEach(() => {
  mockCollection.mockReset();
  FieldValue.arrayUnion.mockClear();
});

describe('POST — appending a reply', () => {
  test('coordinator reply is appended to the thread', async () => {
    const { update } = mockDoc({ data: openConcern });
    const res = makeRes();

    await postReply({
      method: 'POST',
      body: { concernId: 'c-1', sender: 'coordinator', senderId: 'coord-1', message: 'Rebooked for Friday' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ concernId: 'c-1', messageCount: 2 })
    );

    const entry = FieldValue.arrayUnion.mock.calls[0][0];
    expect(entry).toMatchObject({
      sender: 'coordinator',
      senderId: 'coord-1',
      text: 'Rebooked for Friday',
    });
    expect(entry.messageId).toBeTruthy();

    // lastMessageBy is what tells the dashboard whether a patient is still
    // waiting on an answer.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ lastMessageBy: 'coordinator', lastMessageAt: entry.sentAt })
    );
  });

  test('patient can reply on the same thread', async () => {
    mockDoc({ data: openConcern });
    const res = makeRes();

    await postReply({
      method: 'POST',
      body: { concernId: 'c-1', sender: 'patient', senderId: 'patient-demo-1', message: 'Friday works' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(FieldValue.arrayUnion.mock.calls[0][0].sender).toBe('patient');
  });

  test('missing message is rejected', async () => {
    mockDoc({ data: openConcern });
    const res = makeRes();

    await postReply({ method: 'POST', body: { concernId: 'c-1', sender: 'patient' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('an unrecognised sender is rejected', async () => {
    mockDoc({ data: openConcern });
    const res = makeRes();

    await postReply({
      method: 'POST',
      body: { concernId: 'c-1', sender: 'admin', message: 'hello' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(FieldValue.arrayUnion).not.toHaveBeenCalled();
  });

  test('unknown concernId returns 404 and writes nothing', async () => {
    const { update } = mockDoc({ exists: false });
    const res = makeRes();

    await postReply({
      method: 'POST',
      body: { concernId: 'nope', sender: 'coordinator', message: 'hello' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('GET — reading the thread', () => {
  test('returns the full conversation', async () => {
    mockDoc({ data: openConcern });
    const res = makeRes();

    await postReply({ method: 'GET', query: { concernId: 'c-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      concernId: 'c-1',
      patientId: 'patient-demo-1',
      coordinatorId: 'coord-1',
      status: 'OPEN',
      messages: openConcern.messages,
    }));
  });

  test('missing concernId is rejected', async () => {
    const res = makeRes();

    await postReply({ method: 'GET', query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('HTTP plumbing', () => {
  test('CORS preflight is answered so the browser can POST', async () => {
    const res = makeRes();

    await postReply({ method: 'OPTIONS' }, res);

    expect(res.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  test('unsupported methods are rejected', async () => {
    const res = makeRes();

    await postReply({ method: 'DELETE' }, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});

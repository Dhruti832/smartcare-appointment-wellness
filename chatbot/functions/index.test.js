// Simulates the exact HTTP request Dialogflow ES sends a fulfillment webhook
// after it has matched an intent and extracted parameters from an utterance
// (WebhookRequest: queryResult.intent.displayName + queryResult.parameters).
// This is the automated half of the chatbot utterance-testing evidence
// required by the PRD — see docs/testing/chatbot-utterance-tests.md, which
// maps each case here back to the raw utterance that would produce these
// intent + parameters in the live Dialogflow console.

jest.mock('@google-cloud/firestore');
const { Firestore } = require('@google-cloud/firestore');

// Firestore.mockImplementation must be wired before index.js does `new
// Firestore()` at require time, and index.js is only ever required once
// (module cache) — so mockCollection is a single stable fn reset per test,
// not recreated, otherwise index.js's `db` would keep pointing at a stale one.
const mockCollection = jest.fn();
Firestore.mockImplementation(() => ({ collection: mockCollection }));
const { fulfillment } = require('./index');

function makeReq(intent, parameters, session = 'projects/saws/agent/sessions/test-session', payload) {
  return {
    body: {
      session,
      queryResult: { intent: { displayName: intent }, parameters },
      ...(payload ? { originalDetectIntentRequest: { payload } } : {}),
    },
  };
}

function makeRes() {
  const res = {};
  res.json = jest.fn(() => res);
  res.status = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  mockCollection.mockReset();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
  delete process.env.PUBLISH_CONCERN_URL;
});

describe('Navigation intent', () => {
  test('"How do I book an appointment?" -> booking topic -> static navigation help', async () => {
    const res = makeRes();
    await fulfillment(makeReq('Navigation', { topic: 'booking' }), res);
    expect(res.json).toHaveBeenCalledWith({
      fulfillmentText: 'To book an appointment, go to Dashboard > Book Appointment, pick a service and time slot, and confirm.',
    });
  });

  test('"How do I use this app?" -> no topic slot -> generic navigation help', async () => {
    const res = makeRes();
    await fulfillment(makeReq('Navigation', {}), res);
    expect(res.json.mock.calls[0][0].fulfillmentText).toMatch(/I can help you navigate SAWS/);
  });
});

describe('FAQ intent', () => {
  test('"What are your hours?" -> topic=hours -> answer from Firestore', async () => {
    mockCollection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ empty: false, docs: [{ data: () => ({ answer: 'We are open 9am-5pm, Monday to Friday.' }) }] }),
        }),
      }),
    });
    const res = makeRes();
    await fulfillment(makeReq('FAQ', { topic: 'hours' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'We are open 9am-5pm, Monday to Friday.' });
  });

  test('"What is your policy on unicorns?" -> unmatched topic -> fallback text', async () => {
    mockCollection.mockReturnValue({
      where: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) }) }),
    });
    const res = makeRes();
    await fulfillment(makeReq('FAQ', { topic: 'unicorns' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'I don\'t have information on "unicorns" yet. Please contact a coordinator.' });
  });
});

// Helper for AppointmentLookup tests: `resolveServiceName` queries the
// `services` collection separately from the `appointments` doc fetch, so
// these tests need collection() to branch on name rather than returning one
// shared mock for every call.
function mockAppointmentAndServicesCollections({ appointment, servicesByField = { empty: true, docs: [] }, servicesByDocId = { exists: false } }) {
  mockCollection.mockImplementation((name) => {
    if (name === 'appointments') {
      return { doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue(appointment) }) };
    }
    if (name === 'services') {
      return {
        where: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue(servicesByField) }) }),
        doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue(servicesByDocId) }),
      };
    }
    return {};
  });
}

describe('AppointmentLookup intent', () => {
  test('"Look up appointment APT-1001" -> found, doc already stores a display name -> formatted details', async () => {
    mockAppointmentAndServicesCollections({
      appointment: {
        exists: true,
        data: () => ({ service: 'Physiotherapy', date: '2026-07-15', time: '10:00', status: 'CONFIRMED' }),
      },
    });
    const res = makeRes();
    await fulfillment(makeReq('AppointmentLookup', { referenceCode: 'APT-1001' }), res);
    expect(res.json).toHaveBeenCalledWith({
      fulfillmentText: 'Appointment APT-1001: Physiotherapy on 2026-07-15 at 10:00. Status: CONFIRMED.',
    });
  });

  test('"Look up appointment APT-9999" -> not found -> not-found message', async () => {
    mockCollection.mockReturnValue({ doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) }) });
    const res = makeRes();
    await fulfillment(makeReq('AppointmentLookup', { referenceCode: 'APT-9999' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'No appointment found for reference code APT-9999.' });
  });

  test('"Look up my appointment" (no reference code given) -> prompts for it', async () => {
    const res = makeRes();
    await fulfillment(makeReq('AppointmentLookup', { referenceCode: '' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'Please provide your appointment reference code.' });
  });

  test('real mirror shape (no time field, raw serviceId, no catalog match) -> no "at undefined", raw id shown as-is', async () => {
    mockAppointmentAndServicesCollections({
      appointment: {
        exists: true,
        data: () => ({ refCode: 'a1b2c3d4', service: 'a1b2c3d4', date: '2026-07-20', status: 'CONFIRMED' }),
      },
    });
    const res = makeRes();
    await fulfillment(makeReq('AppointmentLookup', { referenceCode: 'a1b2c3d4' }), res);
    expect(res.json).toHaveBeenCalledWith({
      fulfillmentText: 'Appointment a1b2c3d4: a1b2c3d4 on 2026-07-20. Status: CONFIRMED.',
    });
  });

  test('real mirror shape with services catalog enriched by serviceId -> resolves to the display name', async () => {
    mockAppointmentAndServicesCollections({
      appointment: {
        exists: true,
        data: () => ({ refCode: 'a1b2c3d4', service: 'svc-physio-01', date: '2026-07-20', status: 'CONFIRMED' }),
      },
      servicesByField: { empty: false, docs: [{ data: () => ({ name: 'Sports Physiotherapy' }) }] },
    });
    const res = makeRes();
    await fulfillment(makeReq('AppointmentLookup', { referenceCode: 'a1b2c3d4' }), res);
    expect(res.json).toHaveBeenCalledWith({
      fulfillmentText: 'Appointment a1b2c3d4: Sports Physiotherapy on 2026-07-20. Status: CONFIRMED.',
    });
  });
});

describe('WellnessInquiry intent', () => {
  test('"What yoga services do you offer?" -> matching services -> names listed', async () => {
    mockCollection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ empty: false, docs: [{ data: () => ({ name: 'Morning Yoga' }) }, { data: () => ({ name: 'Restorative Yoga' }) }] }),
        }),
      }),
    });
    const res = makeRes();
    await fulfillment(makeReq('WellnessInquiry', { serviceType: 'yoga' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'Available yoga services: Morning Yoga, Restorative Yoga.' });
  });

  test('"Do you offer astrology?" -> no matches -> not-found message', async () => {
    mockCollection.mockReturnValue({
      where: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ empty: true, docs: [] }) }) }),
    });
    const res = makeRes();
    await fulfillment(makeReq('WellnessInquiry', { serviceType: 'astrology' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'No services found for "astrology".' });
  });
});

describe('SubmitConcern intent', () => {
  test('"I want to report a problem with my care" -> PUBLISH_CONCERN_URL set -> POSTs to messaging publishConcern', async () => {
    process.env.PUBLISH_CONCERN_URL = 'https://us-central1-saws.cloudfunctions.net/saws-publish-concern-dev';
    global.fetch.mockResolvedValue({ ok: true });
    const res = makeRes();
    await fulfillment(
      makeReq('SubmitConcern', { concern: 'My appointment was rescheduled without notice' }, 'projects/saws/agent/sessions/sess-1', { patientId: 'patient-42' }),
      res
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://us-central1-saws.cloudfunctions.net/saws-publish-concern-dev',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ patientId: 'patient-42', concern: 'My appointment was rescheduled without notice', sessionId: 'projects/saws/agent/sessions/sess-1' }),
      })
    );
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'Your concern has been submitted. A wellness coordinator will follow up with you shortly.' });
  });

  test('publishConcern unreachable (non-2xx) -> friendly retry message, no crash', async () => {
    process.env.PUBLISH_CONCERN_URL = 'https://us-central1-saws.cloudfunctions.net/saws-publish-concern-dev';
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    const res = makeRes();
    await fulfillment(makeReq('SubmitConcern', { concern: 'App keeps crashing' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'Sorry, I could not submit your concern right now. Please try again shortly.' });
  });

  test('PUBLISH_CONCERN_URL unset -> falls back to direct Firestore write', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'concern-1' });
    mockCollection.mockReturnValue({ add });
    const res = makeRes();
    await fulfillment(makeReq('SubmitConcern', { concern: 'Long wait times at the clinic' }), res);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ concern: 'Long wait times at the clinic', status: 'PENDING' }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'Your concern has been submitted. A wellness coordinator will follow up with you shortly.' });
  });

  test('empty concern text -> prompts for a description, no write/publish', async () => {
    const res = makeRes();
    await fulfillment(makeReq('SubmitConcern', { concern: '' }), res);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'Please describe the concern you would like to submit.' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Unmatched / default', () => {
  test('unrecognized intent name -> generic fallback text', async () => {
    const res = makeRes();
    await fulfillment(makeReq('Default Fallback Intent', {}), res);
    expect(res.json.mock.calls[0][0].fulfillmentText).toMatch(/navigate SAWS/);
  });
});

describe('Malformed request (not a Dialogflow webhook call)', () => {
  test('no body at all (e.g. a bare GET on the URL) -> 400, no crash', async () => {
    const res = makeRes();
    await fulfillment({ body: undefined }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'This endpoint expects a Dialogflow webhook POST request.' });
  });

  test('body present but missing queryResult -> 400, no crash', async () => {
    const res = makeRes();
    await fulfillment({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ fulfillmentText: 'This endpoint expects a Dialogflow webhook POST request.' });
  });
});

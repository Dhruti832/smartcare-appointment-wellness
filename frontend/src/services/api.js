import axios from 'axios';

// Auth and appointments are separate API Gateways (terraform outputs
// auth_api_endpoint / appointments_api_endpoint). REACT_APP_API_BASE_URL
// remains as a single-URL fallback should they ever be unified.
const API_BASE = process.env.REACT_APP_API_BASE_URL;
const AUTH_API_BASE = process.env.REACT_APP_AUTH_API_URL || API_BASE;
const APPOINTMENTS_API_BASE = process.env.REACT_APP_APPOINTMENTS_API_URL || API_BASE;
const PUBLISH_CONCERN_URL = process.env.REACT_APP_PUBLISH_CONCERN_URL;
const POST_REPLY_URL = process.env.REACT_APP_POST_REPLY_URL;
const GCP_PROJECT_ID = process.env.REACT_APP_GCP_PROJECT_ID;
const FIREBASE_API_KEY = process.env.REACT_APP_FIREBASE_API_KEY;

// Protected routes expect `Authorization: Bearer <Cognito ID token>`
// (docs/api/api-contract.md §1); the token appears in localStorage once
// stage-3 login succeeds.
function withAuthHeader(config) {
  const idToken = localStorage.getItem('idToken');
  if (idToken) config.headers.Authorization = `Bearer ${idToken}`;
  return config;
}

const authApi = axios.create({ baseURL: AUTH_API_BASE });
authApi.interceptors.request.use(withAuthHeader);

const api = axios.create({ baseURL: APPOINTMENTS_API_BASE });
api.interceptors.request.use(withAuthHeader);

export function apiError(err, fallback) {
  return (err.response && err.response.data && err.response.data.message) || fallback;
}

export const authAPI = {
  register: (data) => authApi.post('/auth/register', data).then((res) => res.data),
  loginStage1: (data) => authApi.post('/auth/login/stage1', data).then((res) => res.data),
  loginStage2: (data) => authApi.post('/auth/login/stage2', data).then((res) => res.data),
  loginStage3: (data) => authApi.post('/auth/login/stage3', data).then((res) => res.data),
  getProfile: (idToken) =>
    authApi.get('/auth/me', { headers: { Authorization: `Bearer ${idToken}` } }).then((res) => res.data),
};

// Endpoints below follow the shared contract envelope { message, data }.
export const appointmentAPI = {
  book: (data) => api.post('/appointments', data).then((res) => res.data),
  getMine: () => api.get('/appointments/me').then((res) => res.data),
  listByStatus: (status) => api.get('/appointments', { params: { status } }).then((res) => res.data),
  getOne: (appointmentId) => api.get(`/appointments/${appointmentId}`).then((res) => res.data),
  approve: (appointmentId) => api.patch(`/appointments/${appointmentId}/approve`).then((res) => res.data),
  reject: (appointmentId, rejectionReason) =>
    api.patch(`/appointments/${appointmentId}/reject`, { rejectionReason }).then((res) => res.data),
  cancel: (appointmentId) => api.patch(`/appointments/${appointmentId}/cancel`).then((res) => res.data),
  getLogs: (appointmentId) => api.get(`/appointments/${appointmentId}/logs`).then((res) => res.data),
};

export const servicesAPI = {
  getAll: () => api.get('/services').then((res) => res.data),
  getById: (serviceId) => api.get(`/services/${serviceId}`).then((res) => res.data),
  create: (data) => api.post('/services', data).then((res) => res.data),
  update: (serviceId, data) => api.put(`/services/${serviceId}`, data).then((res) => res.data),
};

export const feedbackAPI = {
  submit: (data) => api.post('/feedback', data).then((res) => res.data),
  getAll: (serviceId) =>
    api.get('/feedback', { params: serviceId ? { serviceId } : {} }).then((res) => res.data),
};
// 
// Messaging (Member 5): the concern form POSTs { patientId, concern, sessionId }
// straight to the publishConcern Cloud Function, a per-deployment URL from the
// terraform output `publish_concern_url`, so it lives in .env, never in code.
export const messagingAPI = {
  isConfigured: () => Boolean(PUBLISH_CONCERN_URL),
  submitConcern: (data) => axios.post(PUBLISH_CONCERN_URL, data).then((res) => res.data),
};

// Coordinator dashboard reads the Firestore `communicationLogs` collection that
// messaging's handleMessage function writes. Sprint-2 prototype: Firestore REST
// API with an API key (needs read access allowed in the Firestore rules).
function fromFirestoreValue(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.mapValue !== undefined) return fromFirestoreFields(value.mapValue.fields);
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(fromFirestoreValue);
  return null;
}

function fromFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
}

export const communicationAPI = {
  isConfigured: () => Boolean(GCP_PROJECT_ID),
  getLogs: () =>
    axios
      .get(
        `https://firestore.googleapis.com/v1/projects/${GCP_PROJECT_ID}/databases/(default)/documents/communicationLogs`,
        { params: { pageSize: 50, ...(FIREBASE_API_KEY ? { key: FIREBASE_API_KEY } : {}) } }
      )
      .then((res) =>
        (res.data.documents || []).map((doc) => ({
          id: doc.name.split('/').pop(),
          ...fromFirestoreFields(doc.fields),
        }))
      ),
  // Reply half of the messaging loop (messaging/functions/post_reply.js):
  // appends to the same concern document's `messages` array that getLogs
  // above already reads. concernId is the Firestore document id (getLogs'
  // `id` field), not the sessionId the concern was originally submitted with.
  isReplyConfigured: () => Boolean(POST_REPLY_URL),
  sendReply: ({ concernId, sender, senderId, message }) =>
    axios.post(POST_REPLY_URL, { concernId, sender, senderId, message }).then((res) => res.data),
};

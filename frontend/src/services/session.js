// Session helpers on top of the tokens stage-3 login stores in localStorage.

export function getIdToken() {
  return localStorage.getItem('idToken');
}

export function getRole() {
  return localStorage.getItem('role');
}

export function isLoggedIn() {
  return Boolean(getIdToken());
}

// The Cognito ID token is a JWT; its payload carries the username/email the
// dashboards need (e.g. patientId on the concern form) without another API call.
export function getUser() {
  const token = getIdToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      username: payload['cognito:username'] || payload.email || payload.sub,
      email: payload.email || '',
    };
  } catch {
    return null;
  }
}

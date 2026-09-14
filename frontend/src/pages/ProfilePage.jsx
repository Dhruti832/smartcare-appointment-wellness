import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appointmentAPI, authAPI, servicesAPI } from '../services/api';
import { getIdToken, getRole, getUser, isLoggedIn } from '../services/session';

// Auth's job ends at a successful login; this is where the app actually
// renders who's logged in. Local session data (getUser/getRole, decoded
// from the ID token at login) renders immediately with no loading flicker;
// /auth/me is called alongside it to exercise the live authorizer path and
// show the roles Cognito itself reports, in case they ever diverge.
//
// Logout lives here rather than in the navbar -- it's account-page content,
// not global chrome, and this keeps it next to the session it's ending.
export default function ProfilePage() {
  const navigate = useNavigate();
  const user = getUser();
  const role = getRole();
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [services, setServices] = useState([]);

  useEffect(() => {
    if (!isLoggedIn()) {
      navigate('/login');
      return;
    }
    authAPI
      .getProfile(getIdToken())
      .then((data) => setRoles(data.roles || []))
      .catch(() => setError('Could not reach the auth service for a live role check, showing your session info instead.'));

    if (role === 'Patient') {
      servicesAPI
        .getAll()
        .then((res) => setServices(res.data || []))
        .catch(() => setServices([]));
      appointmentAPI
        .getMine()
        .then((res) => setAppointments(res.data || []))
        .catch(() => setAppointments([]));
    }
  }, [navigate, role]);

  const handleLogout = () => {
    localStorage.removeItem('idToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('role');
    navigate('/login');
  };

  if (!user) return null;

  const serviceName = (serviceId) => {
    const svc = services.find((s) => s.serviceId === serviceId);
    return svc ? svc.name : serviceId;
  };

  const initials = user.username
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  return (
    <div className="page page-center">
      <div className="card card-wide">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <span className="avatar" style={{ width: 56, height: 56, fontSize: '1.1rem' }}>
            {initials}
          </span>
          <div>
            <h2 className="card-title" style={{ margin: 0 }}>
              {user.username}
            </h2>
            {role && <span className="badge">{role}</span>}
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Account</h3>
        <div className="field">
          <label>Email</label>
          <p style={{ margin: 0 }}>{user.email || '-'}</p>
        </div>
        <div className="field">
          <label>Role</label>
          <p style={{ margin: 0 }}>{role || '-'}</p>
        </div>
        {roles && (
          <div className="field">
            <label>Cognito groups (live, via /auth/me)</label>
            <p style={{ margin: 0 }}>{roles.length > 0 ? roles.join(', ') : '-'}</p>
          </div>
        )}

        {role === 'Patient' && (
          <div className="section">
            <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>My bookings</h3>
            {appointments.length === 0 ? (
              <p className="card-subtitle">No appointments yet.</p>
            ) : (
              appointments.map((a) => (
                <div className="appt-card" key={a.appointmentId}>
                  <div className="appt-card-info">
                    <div className="appt-card-title">{serviceName(a.serviceId)}</div>
                    <div className="appt-card-sub">Reference {a.appointmentId}</div>
                  </div>
                  <span className="appt-card-when">
                    📅 {a.date}, {a.time}
                  </span>
                  <span className={`status ${String(a.status).toLowerCase()}`}>{a.status}</span>
                </div>
              ))
            )}
          </div>
        )}

        <div className="section">
          <button className="btn btn-secondary" type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

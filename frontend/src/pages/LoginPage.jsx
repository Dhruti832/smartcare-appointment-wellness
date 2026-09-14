import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

// 3-stage sequential MFA login: Cognito password -> security Q/A -> Caesar cipher.
// Each stage's response carries the sessionId the next stage must present, so a
// client can't skip ahead to a later stage without passing the one before it.
export default function LoginPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState(1);
  const [formData, setFormData] = useState({});
  const [session, setSession] = useState({ sessionId: '', securityQuestion: '', cipherClue: '', caesarShift: null });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (field) => (e) => setFormData({ ...formData, [field]: e.target.value });

  const handleStage1 = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authAPI.loginStage1({ username: formData.username, password: formData.password });
      setSession({ sessionId: data.sessionId, securityQuestion: data.securityQuestion, cipherClue: '', caesarShift: null });
      setStage(2);
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleStage2 = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authAPI.loginStage2({ sessionId: session.sessionId, answer: formData.answer });
      setSession((prev) => ({ ...prev, cipherClue: data.cipherClue, caesarShift: data.caesarShift }));
      setStage(3);
    } catch {
      setError('Incorrect security answer');
    } finally {
      setLoading(false);
    }
  };

  const handleStage3 = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authAPI.loginStage3({ sessionId: session.sessionId, cipherAnswer: formData.cipherAnswer });
      // Backend returns the raw Cognito group name (plural: "Patients" /
      // "Coordinators"), but the API contract and every role check in this
      // app (App.js, Navbar.jsx) use the singular form, so normalize once here
      // so nothing downstream has to know about the mismatch.
      const role = (data.role || '').replace(/s$/, '');
      localStorage.setItem('idToken', data.idToken);
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('role', role);
      navigate(role === 'Coordinator' ? '/coordinator' : '/dashboard');
    } catch {
      setError('Invalid cipher code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page page-center">
      <div className="card">
        <h2 className="card-title">Sign in</h2>
        <p className="card-subtitle">Stage {stage} of 3 · sequential multi-factor authentication</p>

        <div className="stepper">
          <Dot n={1} stage={stage} label="Password" />
          <Line done={stage > 1} />
          <Dot n={2} stage={stage} label="Security Q&A" />
          <Line done={stage > 2} />
          <Dot n={3} stage={stage} label="Cipher" />
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {stage === 1 && (
          <form onSubmit={handleStage1}>
            <div className="field">
              <label>Email</label>
              <input type="email" placeholder="you@example.com" onChange={update('username')} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" placeholder="••••••••" onChange={update('password')} required />
            </div>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Checking…' : 'Next'}
            </button>
          </form>
        )}

        {stage === 2 && (
          <form onSubmit={handleStage2}>
            <div className="field">
              <label>{session.securityQuestion}</label>
              <input placeholder="Your answer" onChange={update('answer')} required />
            </div>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Checking…' : 'Next'}
            </button>
          </form>
        )}

        {stage === 3 && (
          <form onSubmit={handleStage3}>
            <div className="field">
              <label>Security check: solve your clue</label>
              <div className="cipher-clue">{session.cipherClue}</div>
              <p className="field-hint" style={{ marginTop: 0 }}>
                Hint: shift each letter back {session.caesarShift} place{session.caesarShift === 1 ? '' : 's'} in the alphabet, and that spells your healthcare code word.
              </p>
              <input placeholder="Enter your healthcare code word" onChange={update('cipherAnswer')} required />
            </div>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Login'}
            </button>
          </form>
        )}

        <p className="field-hint" style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link to="/register">Need an account? Register</Link>
        </p>
      </div>
    </div>
  );
}

function Dot({ n, stage, label }) {
  const state = n < stage ? 'done' : n === stage ? 'active' : '';
  return (
    <span className={`stepper-dot ${state}`} title={label}>
      {n < stage ? '✓' : n}
    </span>
  );
}

function Line({ done }) {
  return <span className={`stepper-line ${done ? 'done' : ''}`} />;
}
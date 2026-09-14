import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

const PATIENT_SECURITY_QUESTIONS = [
  "What is your pet's name?",
  'What is your mother’s maiden name?',
  'What was the name of your first school?',
  'What city were you born in?',
  'What is your favorite book?',
];

const COORDINATOR_SECURITY_QUESTIONS = [
  'What was your first job title?',
  'What is the name of your professional mentor?',
  'What was the name of your first workplace?',
  'What city did you complete your training in?',
  'What is your staff ID number?',
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ role: 'PATIENT' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const update = (field) => (e) => setFormData({ ...formData, [field]: e.target.value });
  const securityQuestions = formData.role === 'COORDINATOR' ? COORDINATOR_SECURITY_QUESTIONS : PATIENT_SECURITY_QUESTIONS;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authAPI.register(formData);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err?.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page page-center">
      <div className="card">
        <h2 className="card-title">Create your account</h2>
        <p className="card-subtitle">You'll use these details across all 3 login stages.</p>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">Registration successful. Redirecting to login...</div>}

        {!success && (
          <form onSubmit={handleSubmit}>
            <div className="role-toggle">
              <div
                className={`role-option ${formData.role === 'PATIENT' ? 'active' : ''}`}
                onClick={() => setFormData({ ...formData, role: 'PATIENT', securityQuestion: undefined })}
              >
                Registered Patient
              </div>
              <div
                className={`role-option ${formData.role === 'COORDINATOR' ? 'active' : ''}`}
                onClick={() => setFormData({ ...formData, role: 'COORDINATOR', securityQuestion: undefined })}
              >
                Wellness Coordinator
              </div>
            </div>

            <div className="field">
              <label>Email</label>
              <input type="email" placeholder="you@example.com" onChange={update('email')} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" placeholder="••••••••" onChange={update('password')} required />
            </div>
            <div className="field">
              <label>Security question</label>
              <select key={formData.role} defaultValue="" onChange={update('securityQuestion')} required>
                <option value="" disabled>
                  Select a security question
                </option>
                {securityQuestions.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Security answer</label>
              <input placeholder="Your answer" onChange={update('securityAnswer')} required />
            </div>
            <div className="field">
              <label>Healthcare code word</label>
              <input placeholder="A word only you know" onChange={update('healthcareCode')} required />
              <p className="field-hint">Used to generate your Caesar cipher clue at login stage 3.</p>
            </div>

            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        <p className="field-hint" style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link to="/login">Already have an account? Login</Link>
        </p>
      </div>
    </div>
  );
}
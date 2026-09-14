import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { feedbackAPI, servicesAPI } from '../services/api';
import { getRole } from '../services/session';

// Feedback rows only carry serviceId + a raw ISO timestamp, so resolve the
// former against the services list and make the latter human-readable
// rather than rendering API internals straight to the page.
function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Public page: guests can browse all patient feedback with the sentiment the
// analytics module attaches. Patients submit feedback from their dashboard.
export default function FeedbackPage() {
  const [feedback, setFeedback] = useState(null); // null = loading, [] = empty/error
  const [services, setServices] = useState([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    feedbackAPI
      .getAll()
      .then((res) => setFeedback(res.data || []))
      .catch(() => {
        setFailed(true);
        setFeedback([]);
      });
    servicesAPI
      .getAll()
      .then((res) => setServices(res.data || []))
      .catch(() => setServices([]));
  }, []);

  const serviceName = (serviceId) => {
    const svc = services.find((s) => s.serviceId === serviceId);
    return svc ? svc.name : serviceId;
  };

  return (
    <div className="page">
      <div className="container">
        <h1>Patient feedback</h1>
        <p className="card-subtitle">
          What patients say about our services, with sentiment analysed automatically.
          {getRole() === 'Patient' && (
            <>
              {' '}
              Share yours from your <Link to="/dashboard">dashboard</Link>.
            </>
          )}
        </p>

        {feedback === null ? (
          <p className="card-subtitle">Loading…</p>
        ) : failed ? (
          <div className="alert alert-error">Feedback service is unreachable right now. Try again later.</div>
        ) : feedback.length === 0 ? (
          <p className="card-subtitle">No feedback submitted yet.</p>
        ) : (
          <div className="grid section">
            {feedback.map((f) => (
              <div className="tile" key={f.feedbackId}>
                <p className="feedback-quote">“{f.feedbackText}”</p>
                <p className="feedback-meta">
                  {serviceName(f.serviceId)} · {formatDate(f.createdAt)}
                </p>
                {f.sentimentLabel && (
                  <span className={`status ${String(f.sentimentLabel).toLowerCase()}`}>{f.sentimentLabel}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

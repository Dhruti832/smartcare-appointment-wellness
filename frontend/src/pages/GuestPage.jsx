import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { feedbackAPI, servicesAPI } from '../services/api';
import ChatbotWidget from '../components/ChatbotWidget';

// Feedback rows only carry serviceId + a raw ISO timestamp, so resolve the
// former against the services list and make the latter human-readable
// rather than rendering API internals straight to the page.
function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Public-facing page: layout follows the guest landing + feature section
// wireframes in saws UI Wireframes.pdf.
export default function GuestPage() {
  const [services, setServices] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    servicesAPI
      .getAll()
      .then((res) => setServices(res.data || []))
      .catch(() => setServices([]));
    feedbackAPI
      .getAll()
      .then((res) => setFeedback((res.data || []).slice(0, 6)))
      .catch(() => setFeedback([]));
  }, []);

  const serviceName = (serviceId) => {
    const svc = (services || []).find((s) => s.serviceId === serviceId);
    return svc ? svc.name : serviceId;
  };

  return (
    <div className="page">
      <div className="container">
        <section className="hero2">
          <div>
            <span className="eyebrow">Efficient · Accessible · Reliable</span>
            <h1>SmartCare Appointment and Wellness System</h1>
            <p className="lede">
              The serverless platform designed for modern healthcare. Streamline patient intake, automate
              scheduling, and focus on what matters most: patient wellness.
            </p>
            <div className="hero-actions" style={{ justifyContent: 'flex-start' }}>
              <Link to="/login">
                <button className="btn">Book appointment</button>
              </Link>
              <a href="#features">
                <button className="btn btn-secondary">Learn more</button>
              </a>
            </div>
          </div>
          <div className="hero-visual">
            <div className="float-card tl">
              <span className="float-card-icon">🩺</span>
              <div>
                <div className="float-card-label">Services offered</div>
                <div className="float-card-value">{services && services.length > 0 ? services.length : '-'}</div>
              </div>
            </div>
            <div className="float-card br">
              <span className="float-card-icon">💬</span>
              <div>
                <div className="float-card-label">Patient reviews</div>
                <div className="float-card-value">{feedback && feedback.length > 0 ? feedback.length : '-'}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="feature-head">
            <h2>Discover our serverless healthcare platform in action</h2>
            <p>
              SAWS integrates seamlessly into your care journey: a unified space for appointment booking,
              coordinator messaging, and patient feedback with zero server overhead.
            </p>
          </div>
          <div className="grid">
            <div className="tile">
              <h3>📅 Smart appointment booking</h3>
              <p>
                Book consultations and wellness sessions in seconds; a wellness coordinator reviews and
                confirms every request.
              </p>
            </div>
            <div className="tile">
              <h3>🔐 3-stage secure login</h3>
              <p>Password, security question, and cipher challenge. Your records stay yours.</p>
              <p className="section" style={{ marginTop: '0.9rem' }}>
                <span className="status open">● Multi-factor authentication active</span>
              </p>
            </div>
            <div className="tile">
              <h3>🤖 AI virtual assistant</h3>
              <p>
                Navigation help, FAQs, wellness inquiries, and appointment lookup by reference code, right
                from the chat widget.
              </p>
            </div>
          </div>
          <div className="cta-card section">
            <h3>Ready to elevate your wellness experience?</h3>
            <p>Join the growing community of patients managing their healthcare with SAWS.</p>
            <Link to="/register">
              <button className="btn">Get started today</button>
            </Link>
          </div>
        </section>

        <section className="section">
          <h2>Available services</h2>
          {services === null ? (
            <p className="card-subtitle">Loading services…</p>
          ) : services.length === 0 ? (
            <p className="card-subtitle">Service list is unavailable right now. Check back soon.</p>
          ) : (
            <div className="grid">
              {services.map((s) => (
                <Link to={`/services/${s.serviceId}`} className="tile" key={s.serviceId} style={{ display: 'block' }}>
                  <h3>{s.name}</h3>
                  {s.doctorName && <p className="card-subtitle">👩‍⚕️ {s.doctorName}</p>}
                  <p>{s.description}</p>
                  {s.promoLabel && s.discountedPrice ? (
                    <p className="card-subtitle">
                      {s.durationMinutes} min ·{' '}
                      <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>${s.price}</span>{' '}
                      <strong>${s.discountedPrice}</strong>{' '}
                      <span className="status open">{s.promoLabel}</span>
                    </p>
                  ) : (
                    <p className="card-subtitle">
                      {s.durationMinutes} min · ${s.price}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <h2>What patients say</h2>
          {feedback === null ? (
            <p className="card-subtitle">Loading feedback…</p>
          ) : feedback.length === 0 ? (
            <p className="card-subtitle">
              No feedback to show yet. See the <Link to="/feedback">feedback page</Link> later.
            </p>
          ) : (
            <div className="grid">
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
          <p className="field-hint">
            <Link to="/feedback">Browse all feedback →</Link>
          </p>
        </section>
      </div>
      <ChatbotWidget />
    </div>
  );
}

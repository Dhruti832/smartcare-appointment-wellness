import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { servicesAPI } from '../services/api';
import { getRole, isLoggedIn } from '../services/session';

// Guest-page service tiles previously weren't clickable even though
// servicesAPI.getById existed unused. This is the click-through target:
// service detail, then straight into booking with the service pre-picked.
export default function ServiceDetailPage() {
  const { serviceId } = useParams();
  const [service, setService] = useState(null); // null = loading, false = not found
  const role = getRole();

  useEffect(() => {
    servicesAPI
      .getById(serviceId)
      .then((res) => setService(res.data || res))
      .catch(() => setService(false));
  }, [serviceId]);

  const bookHref = !isLoggedIn()
    ? '/login'
    : role === 'Patient'
    ? `/dashboard?service=${encodeURIComponent(serviceId)}#book`
    : null;

  return (
    <div className="page">
      <div className="container">
        {service === null ? (
          <p className="card-subtitle">Loading service…</p>
        ) : service === false ? (
          <div className="alert alert-error">
            Couldn't find that service. <Link to="/">Back to services</Link>.
          </div>
        ) : (
          <div className="card card-wide section">
            <h1 style={{ marginTop: 0 }}>{service.name}</h1>
            <p className="card-subtitle">{service.type}</p>
            {service.doctorName && <p className="card-subtitle">👩‍⚕️ {service.doctorName}</p>}
            <p>{service.description}</p>
            {service.promoLabel && service.discountedPrice ? (
              <p className="card-subtitle">
                {service.durationMinutes} min ·{' '}
                <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>${service.price}</span>{' '}
                <strong>${service.discountedPrice}</strong>{' '}
                <span className="status open">{service.promoLabel}</span>
              </p>
            ) : (
              <p className="card-subtitle">
                {service.durationMinutes} min · ${service.price}
              </p>
            )}
            {bookHref ? (
              <Link to={bookHref}>
                <button className="btn">Book this service</button>
              </Link>
            ) : (
              <p className="field-hint">Log in as a patient to book this service.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

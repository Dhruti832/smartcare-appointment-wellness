import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export default function Navbar() {
  const location = useLocation();
  const role = localStorage.getItem('role');
  const isLoggedIn = Boolean(localStorage.getItem('idToken'));

  return (
    <header className="navbar" key={location.pathname}>
      <Link to="/" className="navbar-brand">
        <span className="navbar-brand-icon">🩺</span>
        SAWS
      </Link>
      <nav className="navbar-links">
        <Link className="navbar-link" to="/feedback">
          Feedback
        </Link>
        {isLoggedIn ? (
          <>
            {role === 'Patient' && (
              <Link className="navbar-link" to="/dashboard">
                Dashboard
              </Link>
            )}
            {role === 'Coordinator' && (
              <Link className="navbar-link" to="/coordinator">
                Dashboard
              </Link>
            )}
            <Link className="navbar-link" to="/profile">
              Profile
            </Link>
            {role && <span className="badge">{role}</span>}
          </>
        ) : (
          <>
            <Link className="navbar-link" to="/login">
              Login
            </Link>
            <Link className="navbar-link" to="/register">
              Register
            </Link>
          </>
        )}
        <Link to={role === 'Patient' ? '/dashboard#book' : '/login'}>
          <button className="btn btn-inline">Book appointment</button>
        </Link>
      </nav>
    </header>
  );
}
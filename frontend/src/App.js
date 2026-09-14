import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import GuestPage from './pages/GuestPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfilePage from './pages/ProfilePage';
import PatientDashboard from './pages/PatientDashboard';
import CoordinatorDashboard from './pages/CoordinatorDashboard';
import FeedbackPage from './pages/FeedbackPage';
import ServiceDetailPage from './pages/ServiceDetailPage';
import { getRole, isLoggedIn } from './services/session';

function RequireRole({ role, children }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  if (role && getRole() !== role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<GuestPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/services/:serviceId" element={<ServiceDetailPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireRole role="Patient">
              <PatientDashboard />
            </RequireRole>
          }
        />
        <Route
          path="/coordinator"
          element={
            <RequireRole role="Coordinator">
              <CoordinatorDashboard />
            </RequireRole>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

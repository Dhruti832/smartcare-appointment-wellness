import React from 'react';

// Sidebar dashboard shell from the Sprint 1 wireframes (saws UI Wireframes.pdf):
// user block + icon nav on the left, content pane on the right.
export default function DashLayout({ name, role, nav, children }) {
  const initials = (name || '?')
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  return (
    <div className="dash">
      <aside className="dash-sidebar">
        <div className="dash-user">
          <span className="avatar">{initials}</span>
          <div>
            <div className="dash-user-name">{name}</div>
            <div className="dash-user-role">{role}</div>
          </div>
        </div>
        <nav>
          {nav.map((item) => (
            <a key={item.label} className={`dash-nav-item ${item.active ? 'active' : ''}`} href={item.href}>
              <span>{item.icon}</span> {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="dash-main">{children}</main>
    </div>
  );
}

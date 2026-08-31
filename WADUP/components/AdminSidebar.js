import Link from 'next/link';
import { useRouter } from 'next/router';
import { isSuperAdmin } from '../lib/admin';

export default function AdminSidebar({ adminRole }) {
  const router = useRouter();
  const superAdmin = isSuperAdmin(adminRole);

  const isActive = (href) => router.pathname === href;

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-logo">
        <Link href="/">WadUp</Link>
        <span className="admin-sidebar-tag">Admin</span>
      </div>

      <nav className="admin-nav">
        <Link href="/admin" className={`admin-nav-link${isActive('/admin') ? ' active' : ''}`}>
          🏠 Overview
        </Link>
        <Link href="/admin/venues" className={`admin-nav-link${isActive('/admin/venues') ? ' active' : ''}`}>
          📍 Venues
        </Link>
        {superAdmin && (
          <Link href="/admin/ambassadors" className={`admin-nav-link${isActive('/admin/ambassadors') ? ' active' : ''}`}>
            🧑‍🤝‍🧑 Ambassadors
          </Link>
        )}
        {superAdmin && (
          <span className="admin-nav-link disabled" title="Coming soon">
            📊 Analytics
          </span>
        )}
        <Link href="/admin/reports" className={`admin-nav-link${isActive('/admin/reports') ? ' active' : ''}`}>
          🚩 Reports
        </Link>
      </nav>

      <div className="admin-sidebar-footer">
        <div className="admin-role-badge">{superAdmin ? 'Super Admin' : 'Ambassador'}</div>
        {!superAdmin && adminRole?.cities?.length > 0 && (
          <div className="admin-role-cities">{adminRole.cities.join(', ')}</div>
        )}
        <Link href="/" className="admin-exit-link">← Back to map</Link>
      </div>
    </aside>
  );
}

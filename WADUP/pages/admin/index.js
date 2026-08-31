import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import { getAdminRole, isSuperAdmin } from '../../lib/admin';
import AdminSidebar from '../../components/AdminSidebar';

export default function AdminOverview() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [adminRole, setAdminRole] = useState(null);
  const [stats, setStats] = useState(null);

  const bootstrap = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    console.log('[admin] /admin bootstrap: session user id =', session?.user?.id || null);
    if (!session?.user) {
      console.log('[admin] /admin bootstrap: no session -> redirecting home');
      router.replace('/');
      return;
    }

    const role = await getAdminRole(supabase, session.user.id);
    console.log('[admin] /admin bootstrap: adminRole =', role);
    if (!role) {
      console.log('[admin] /admin bootstrap: no admin role -> redirecting home');
      router.replace('/');
      return;
    }

    setAdminRole(role);
    setChecking(false);

    let venueQuery = supabase.from('venues').select('id, is_hidden', { count: 'exact' });
    if (!isSuperAdmin(role) && role.cities?.length) venueQuery = venueQuery.in('city', role.cities);
    const { data: venues } = await venueQuery;

    setStats({
      totalVenues: venues?.length || 0,
      hiddenVenues: (venues || []).filter(v => v.is_hidden).length,
    });
  }, [router]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  if (checking) return <div className="venue-page-status admin-loading"><div className="cover-spin" /></div>;

  return (
    <>
      <Head>
        <title>Admin — WadUp</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="admin-shell">
        <AdminSidebar adminRole={adminRole} />
        <main className="admin-main">
          <h1 className="admin-page-title">Overview</h1>
          <p className="admin-page-sub">
            Signed in as {isSuperAdmin(adminRole) ? 'a super admin' : 'an ambassador'}
            {!isSuperAdmin(adminRole) && adminRole.cities?.length > 0 && <> for {adminRole.cities.join(', ')}</>}.
          </p>

          {stats && (
            <div className="admin-stat-cards">
              <div className="admin-stat-card">
                <div className="admin-stat-num">{stats.totalVenues}</div>
                <div className="admin-stat-label">Venues in scope</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-num">{stats.hiddenVenues}</div>
                <div className="admin-stat-label">Hidden</div>
              </div>
            </div>
          )}

          <div className="admin-quick-links">
            <a href="/admin/venues" className="admin-quick-link">📍 Manage Venues</a>
            {isSuperAdmin(adminRole) && (
              <a href="/admin/ambassadors" className="admin-quick-link">🧑‍🤝‍🧑 Manage Ambassadors</a>
            )}
            <a href="/admin/reports" className="admin-quick-link">🚩 Moderation Queue</a>
          </div>
        </main>
      </div>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { getAdminRole, isSuperAdmin } from '../../lib/admin';
import AdminSidebar from '../../components/AdminSidebar';

export default function RestaurantCoverage() {
  const router = useRouter();
  const [role, setRole] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace('/'); return; }
      const adminRole = await getAdminRole(supabase, session.user.id);
      if (!isSuperAdmin(adminRole)) { router.replace('/admin'); return; }
      setRole(adminRole);
      const response = await fetch('/api/admin/restaurant-coverage', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load coverage');
      setData(payload);
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => { refresh(); }, [refresh]);
  const c = data?.counts || {};
  const progress = data?.totalTiles ? Math.round(100 * (c.done || 0) / data.totalTiles) : 0;
  const panel = { background: '#151e2b', border: '1px solid #344153', borderRadius: 12, padding: 18 };
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 };
  return <>
    <Head><title>Restaurant Coverage — WadUp Admin</title><meta name="robots" content="noindex,nofollow" /></Head>
    <div className="admin-shell">
      <AdminSidebar adminRole={role} />
      <main className="admin-main">
        <h1 className="admin-page-title">Restaurant Coverage</h1>
        <p className="admin-page-sub">Nationwide import progress, overnight runs and review queue.</p>
        <button onClick={refresh} disabled={loading} style={{ padding: '9px 16px', marginBottom: 18, cursor: 'pointer' }}>
          {loading ? 'Refreshing…' : 'Refresh dashboard'}
        </button>
        {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
        {data && <>
          <div style={grid}>
            {[
              ['Restaurants on map', data.restaurantCount],
              ['Pending approval', data.pendingCount],
              ['Tiles completed', c.done || 0],
              ['Tiles remaining', (c.queued || 0) + (c.running || 0)],
              ['Tiles with errors', c.error || 0],
              ['New listings staged', data.stagedFromCoverage],
            ].map(([label, value]) => <div key={label} style={panel}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{value.toLocaleString()}</div>
              <div style={{ opacity: .75, fontSize: 13 }}>{label}</div>
            </div>)}
          </div>
          <section style={{ ...panel, marginTop: 20 }}>
            <h2 style={{ marginTop: 0 }}>Geographic progress — {progress}%</h2>
            <div style={{ height: 12, background: '#334155', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#38bdf8' }} />
            </div>
            <p>{c.done || 0} of {data.totalTiles} tiles searched. A searched tile is not guaranteed to contain every restaurant.</p>
            {data.regions.map(region => {
              const total = region.queued + region.running + region.done + region.error;
              return <div key={region.name} style={{ marginTop: 12 }}>
                <strong>{region.name}</strong>
                <div style={{ opacity: .75, fontSize: 13 }}>
                  {region.done}/{total} searched · {region.queued} queued · {region.error} errors · {region.staged} staged
                </div>
              </div>;
            })}
          </section>
          <section style={{ ...panel, marginTop: 20 }}>
            <h2 style={{ marginTop: 0 }}>Importer status</h2>
            <p style={{ color: '#fbbf24' }}>{data.billingGuard}</p>
            <p>Overnight worker scheduled for 3–7 AM Eastern. Discovery is staged for approval, not automatically published.</p>
            <Link href="/admin/venues">Review pending restaurants</Link>
          </section>
          <section style={{ ...panel, marginTop: 20, overflowX: 'auto' }}>
            <h2 style={{ marginTop: 0 }}>Recent overnight runs</h2>
            {!data.recentRuns.length ? <p>No importer runs recorded yet.</p> :
              <table style={{ width: '100%', textAlign: 'left', borderSpacing: '0 10px' }}>
                <thead><tr><th>Started</th><th>Tile</th><th>Status</th><th>API calls</th><th>Staged</th></tr></thead>
                <tbody>{data.recentRuns.map(run => <tr key={run.id}>
                  <td>{new Date(run.started_at).toLocaleString()}</td>
                  <td>{run.tile_id}</td><td>{run.status}</td><td>{run.api_calls}</td><td>{run.staged}</td>
                </tr>)}</tbody>
              </table>}
          </section>
          {data.errors.length > 0 && <section style={{ ...panel, marginTop: 20 }}>
            <h2 style={{ marginTop: 0 }}>Tiles requiring attention</h2>
            {data.errors.map(e => <p key={e.id}>Tile {e.id}: {e.message}</p>)}
          </section>}
          <p style={{ opacity: .65, marginTop: 16, fontSize: 12 }}>
            Updated {new Date(data.generatedAt).toLocaleString()}. Counts are live database results.
          </p>
        </>}
      </main>
    </div>
  </>;
}

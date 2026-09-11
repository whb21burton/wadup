import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import { getAdminRole } from '../../lib/admin';
import AdminSidebar from '../../components/AdminSidebar';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const CONFIDENCE_CLASS = (c) => (c >= 80 ? 'confidence-high' : c >= 60 ? 'confidence-mid' : 'confidence-low');

export default function AdminReports() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [adminRole, setAdminRole] = useState(null);
  const [session, setSession] = useState(null);

  const [tab, setTab] = useState('reports'); // 'reports' | 'scraped'

  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [scrapedEvents, setScrapedEvents] = useState(null);
  const [scrapedError, setScrapedError] = useState('');
  const [scrapedBusyId, setScrapedBusyId] = useState(null);

  const bootstrap = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s?.user) { router.replace('/'); return; }
    const role = await getAdminRole(supabase, s.user.id);
    if (!role) { router.replace('/'); return; }
    setSession(s);
    setAdminRole(role);
    setChecking(false);
  }, [router]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const loadReports = useCallback(async (activeSession) => {
    const s = activeSession || session;
    if (!s) return;
    setError('');
    try {
      const res = await fetch('/api/admin/moderate-review', {
        headers: { Authorization: `Bearer ${s.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load reports');
      setReports(data.reports || []);
    } catch (e) {
      setError(e.message);
      setReports([]);
    }
  }, [session]);

  useEffect(() => { if (session) loadReports(session); }, [session, loadReports]);

  const act = async (reportId, action) => {
    if (action === 'remove_review' && !window.confirm('Permanently delete this review?')) return;
    if (action === 'suspend_user' && !window.confirm('Suspend this reviewer’s account?')) return;
    setBusyId(reportId);
    setError('');
    try {
      const res = await fetch('/api/admin/moderate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ reportId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      setReports(prev => prev.filter(r => r.id !== reportId));
    } catch (e) {
      setError(e.message);
    }
    setBusyId(null);
  };

  // Read directly via the session-scoped client rather than a dedicated API
  // route — scraped_events_pending's RLS policy already allows any
  // admin_roles member to select from it (see the migration), so there's no
  // need for a server route just to list rows; only approve/reject (real
  // writes) go through review-scraped-event.js.
  const loadScrapedEvents = useCallback(async () => {
    setScrapedError('');
    const { data, error } = await supabase
      .from('scraped_events_pending')
      .select('*')
      .eq('status', 'pending')
      .order('scraped_at', { ascending: false });
    if (error) { setScrapedError(error.message); setScrapedEvents([]); return; }
    setScrapedEvents(data || []);
  }, []);

  useEffect(() => { if (session && tab === 'scraped') loadScrapedEvents(); }, [session, tab, loadScrapedEvents]);

  const reviewScrapedEvent = async (eventId, action) => {
    setScrapedBusyId(eventId);
    setScrapedError('');
    try {
      const res = await fetch('/api/admin/review-scraped-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ event_id: eventId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      setScrapedEvents(prev => prev.filter(e => e.id !== eventId));
    } catch (e) {
      setScrapedError(e.message);
    }
    setScrapedBusyId(null);
  };

  if (checking) return <div className="venue-page-status admin-loading"><div className="cover-spin" /></div>;

  return (
    <>
      <Head>
        <title>Moderation Queue — WadUp Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="admin-shell">
        <AdminSidebar adminRole={adminRole} />
        <main className="admin-main">
          <h1 className="admin-page-title">Moderation</h1>

          <div className="admin-view-tabs">
            <button className={`admin-view-tab${tab === 'reports' ? ' active' : ''}`} onClick={() => setTab('reports')}>🚩 Reports</button>
            <button className={`admin-view-tab${tab === 'scraped' ? ' active' : ''}`} onClick={() => setTab('scraped')}>🤖 Scraped Events</button>
          </div>

          {tab === 'reports' && <>
          {error && <div className="admin-modal-error">⚠️ {error}</div>}

          {reports === null ? (
            <div className="admin-sync-desc">Loading reports…</div>
          ) : reports.length === 0 ? (
            <div className="admin-sync-desc">No open reports. 🎉</div>
          ) : (
            <div className="admin-report-list">
              {reports.map(r => (
                <div key={r.id} className="admin-report-card">
                  <div className="admin-report-header">
                    <span className="admin-venue-name">{r.reviews?.venues?.name || 'Venue removed'}</span>
                    <span className="admin-venue-meta">{formatDate(r.created_at)}</span>
                  </div>
                  <div className="admin-report-meta">
                    Reported by @{r.reporter?.username || 'unknown'} · Reason: {r.reason}
                    {r.reviews?.author?.username && <> · Review by @{r.reviews.author.username}</>}
                  </div>
                  {r.reviews?.overall_rating != null && (
                    <div className="review-rating-line">
                      <span className="review-overall-rating">{Number(r.reviews.overall_rating).toFixed(1)}/10</span>
                    </div>
                  )}
                  <p className="admin-report-content">{r.reviews?.content || '(review no longer exists)'}</p>
                  <div className="admin-report-actions">
                    <button disabled={busyId === r.id} onClick={() => act(r.id, 'dismiss')}>Dismiss Report</button>
                    <button
                      className="admin-danger-btn"
                      disabled={busyId === r.id || !r.reviews}
                      onClick={() => act(r.id, 'remove_review')}
                    >
                      Remove Review
                    </button>
                    <button
                      className="admin-danger-btn"
                      disabled={busyId === r.id || !r.reviews}
                      onClick={() => act(r.id, 'suspend_user')}
                    >
                      Suspend User
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </>}

          {tab === 'scraped' && <>
          {scrapedError && <div className="admin-modal-error">⚠️ {scrapedError}</div>}

          {scrapedEvents === null ? (
            <div className="admin-sync-desc">Loading scraped events…</div>
          ) : scrapedEvents.length === 0 ? (
            <div className="admin-sync-desc">No pending scraped events. 🎉</div>
          ) : (
            <div className="admin-scraped-table">
              <div className="admin-scraped-row admin-scraped-header">
                <span>Venue</span>
                <span>Event</span>
                <span>Date</span>
                <span>Time</span>
                <span>Performer</span>
                <span>Confidence</span>
                <span>Actions</span>
              </div>
              {scrapedEvents.map(ev => (
                <div key={ev.id} className="admin-scraped-row">
                  <span>{ev.venue_name}</span>
                  <span>{ev.event_name}</span>
                  <span>{ev.event_date}</span>
                  <span>{ev.event_time || '—'}</span>
                  <span>{ev.performer || '—'}</span>
                  <span className={CONFIDENCE_CLASS(ev.confidence)}>{ev.confidence}%</span>
                  <span className="admin-scraped-actions">
                    <button disabled={scrapedBusyId === ev.id} onClick={() => reviewScrapedEvent(ev.id, 'approve')}>✅ Approve</button>
                    <button className="admin-danger-btn" disabled={scrapedBusyId === ev.id} onClick={() => reviewScrapedEvent(ev.id, 'reject')}>❌ Reject</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          </>}
        </main>
      </div>
    </>
  );
}

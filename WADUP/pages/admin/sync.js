import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import { getAdminRole, isSuperAdmin } from '../../lib/admin';
import { venueCategories } from '../../lib/data';
import { isChain, isBlockedPrimaryType, BAR_PRIMARY_TYPES } from '../../lib/placesSync';
import AdminSidebar from '../../components/AdminSidebar';

const CATEGORIES = [
  { id: 'nightlife', label: '🍺 Bars & Nightlife' },
  { id: 'restaurant', label: '🍔 Restaurants' },
  { id: 'events', label: '🎵 Events' },
  { id: 'sports', label: '🏟️ Sports' },
  { id: 'outdoors', label: '🌳 Outdoors' },
  { id: 'activities', label: '🎳 Activities' },
];

async function authedFetch(url, session, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// A live venue's stored subcategory is primaryType with underscores turned
// into spaces (see lib/placesSync.js's mapPlaceToRow) — undo that to check
// it against the same blocklists sync-preview.js flags candidates with.
function wrongTypeReason(v) {
  if (isChain(v.name)) return 'chain';
  const primaryType = (v.subcategory || '').replace(/ /g, '_');
  if (!primaryType) return null;
  if (isBlockedPrimaryType(primaryType)) return 'blocked type';
  if (venueCategories(v).includes('nightlife') && !BAR_PRIMARY_TYPES.includes(primaryType)) return 'not a bar type';
  return null;
}

export default function SyncManager() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [adminRole, setAdminRole] = useState(null);
  const [session, setSession] = useState(null);

  const [category, setCategory] = useState('nightlife');
  const [previewResults, setPreviewResults] = useState(null);
  const [previewSummary, setPreviewSummary] = useState(null);
  const [approvedIds, setApprovedIds] = useState(new Set());
  const [rejectedIds, setRejectedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [currentVenues, setCurrentVenues] = useState([]);
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [venueSearch, setVenueSearch] = useState('');
  const [actionError, setActionError] = useState('');

  // Sync Manager can trigger real Google API cost and bulk live-table
  // writes — restricted to super_admin, same as Ambassadors/Analytics.
  const bootstrap = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s?.user) { router.replace('/'); return; }
    const role = await getAdminRole(supabase, s.user.id);
    if (!role || !isSuperAdmin(role)) { router.replace('/'); return; }
    setSession(s);
    setAdminRole(role);
    setChecking(false);
  }, [router]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const loadCurrentVenues = useCallback(async () => {
    setLoadingVenues(true);
    const { data } = await supabase
      .from('venues')
      .select('id, name, google_place_id, source, subcategory, categories, category, is_hidden')
      .eq('city', 'Chattanooga')
      .order('name', { ascending: true });
    setCurrentVenues((data || []).filter(v => venueCategories(v).includes(category)));
    setLoadingVenues(false);
  }, [category]);

  useEffect(() => { if (session) loadCurrentVenues(); }, [session, loadCurrentVenues]);

  const fetchPreview = async () => {
    setLoading(true);
    setPreviewError('');
    setPreviewResults(null);
    setPreviewSummary(null);
    try {
      const data = await authedFetch(`/api/places/sync-preview?category=${category}`, session, null, 'GET');
      const venues = data.venues || [];
      setPreviewResults(venues);
      setPreviewSummary({ totalFound: data.totalFound ?? venues.length, alreadyKnown: data.alreadyKnown ?? 0, refreshed: data.refreshed ?? 0 });
      // Auto-approve non-chains, auto-reject known bad types — admin can
      // still flip any individual card before saving.
      const approved = new Set();
      const rejected = new Set();
      venues.forEach(v => {
        if (v.isChain || v.isBlockedType) rejected.add(v.google_place_id);
        else approved.add(v.google_place_id);
      });
      setApprovedIds(approved);
      setRejectedIds(rejected);
    } catch (e) {
      setPreviewError(e.message);
    }
    setLoading(false);
  };

  const approveAll = () => {
    setApprovedIds(new Set(previewResults.map(v => v.google_place_id)));
    setRejectedIds(new Set());
  };
  const approve = (id) => {
    setApprovedIds(prev => new Set(prev).add(id));
    setRejectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };
  const reject = (id) => {
    setRejectedIds(prev => new Set(prev).add(id));
    setApprovedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const saveApproved = async () => {
    setSaving(true);
    setPreviewError('');
    try {
      const toSave = previewResults.filter(v => approvedIds.has(v.google_place_id));
      const toReject = previewResults.filter(v => rejectedIds.has(v.google_place_id));
      const data = await authedFetch('/api/places/sync-save', session, { venues: toSave, rejected: toReject, category });
      setPreviewResults(null);
      setApprovedIds(new Set());
      setRejectedIds(new Set());
      loadCurrentVenues();
      window.alert(`Saved ${data.saved} venue${data.saved === 1 ? '' : 's'}, recorded ${data.rejected} rejection${data.rejected === 1 ? '' : 's'}.`);
    } catch (e) {
      setPreviewError(e.message);
    }
    setSaving(false);
  };

  const hideVenue = async (v) => {
    setActionError('');
    try {
      await authedFetch('/api/admin/update-venue', session, { venueId: v.id, updates: { is_hidden: !v.is_hidden } });
      loadCurrentVenues();
    } catch (e) { setActionError(e.message); }
  };

  const deleteVenue = async (v) => {
    if (!window.confirm(`Permanently delete "${v.name}"? This cannot be undone.`)) return;
    setActionError('');
    try {
      await authedFetch('/api/admin/delete-venue', session, { venueId: v.id });
      loadCurrentVenues();
    } catch (e) { setActionError(e.message); }
  };

  const visibleCurrentVenues = currentVenues.filter(v =>
    !venueSearch.trim() || v.name.toLowerCase().includes(venueSearch.trim().toLowerCase())
  );

  if (checking) return <div className="venue-page-status admin-loading"><div className="cover-spin" /></div>;

  return (
    <>
      <Head>
        <title>Sync Manager — WadUp Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="admin-shell">
        <AdminSidebar adminRole={adminRole} />
        <main className="admin-main">
          <h1 style={{ color: '#FFFC00', fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', letterSpacing: '0.03em', marginBottom: '6px' }}>
            🔄 Sync Manager
          </h1>
          <p className="admin-page-sub">Preview Google Places results before anything gets saved, and manage what&apos;s already live.</p>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                onClick={() => { setCategory(c.id); setPreviewResults(null); }}
                style={{
                  padding: '8px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                  background: category === c.id ? '#FFFC00' : '#0a1628',
                  color: category === c.id ? '#000' : '#fff',
                  fontWeight: category === c.id ? 800 : 400,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          <button
            onClick={fetchPreview}
            disabled={loading}
            style={{
              padding: '12px 24px', background: '#00e5ff', color: '#000', border: 'none', borderRadius: '8px',
              fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '16px',
            }}
          >
            {loading ? '⏳ Fetching from Google...' : '🔍 Preview Google Results'}
          </button>

          {previewError && <div style={{ color: '#ff6666', marginBottom: '16px' }}>⚠️ {previewError}</div>}

          {previewSummary && (
            <div style={{ color: '#9fc3cc', marginBottom: '12px', fontSize: '0.85rem' }}>
              Found {previewSummary.totalFound} places from Google → {previewSummary.totalFound - previewSummary.alreadyKnown} are new
              {previewSummary.alreadyKnown > 0 && ` (${previewSummary.alreadyKnown} already in your database, rating/hours refreshed)`}
            </div>
          )}

          {previewResults && (
            <div style={{ marginBottom: '40px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h2 style={{ color: '#00e5ff' }}>Preview ({previewResults.length} new)</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={approveAll}
                    style={{ padding: '8px 16px', background: '#00e676', color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✅ Approve All
                  </button>
                  <button
                    onClick={saveApproved}
                    disabled={saving}
                    style={{ padding: '8px 16px', background: '#FFFC00', color: '#000', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 800 }}
                  >
                    {saving ? '⏳ Saving...' : '💾 Save Approved'}
                  </button>
                </div>
              </div>

              {previewResults.map(v => (
                <div
                  key={v.google_place_id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
                    marginBottom: '6px', borderRadius: '8px',
                    background: rejectedIds.has(v.google_place_id) ? '#ff000015' : approvedIds.has(v.google_place_id) ? '#00ff0010' : '#0a1628',
                    border: `1px solid ${rejectedIds.has(v.google_place_id) ? '#ff4444' : approvedIds.has(v.google_place_id) ? '#00e676' : '#1a2a4a'}`,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{v.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#aaa' }}>
                      {v.address} · ⭐{v.google_rating ?? '—'} ·{' '}
                      <span style={{ color: v.isBlockedType ? '#ff4444' : '#00e5ff' }}>{v.primaryType || 'unknown type'}</span>
                    </div>
                    {v.isChain && <div style={{ fontSize: '0.7rem', color: '#ff8844' }}>⚠️ Chain detected</div>}
                    {v.isBlockedType && <div style={{ fontSize: '0.7rem', color: '#ff4444' }}>⛔ Blocked type: {v.primaryType}</div>}
                  </div>
                  <button
                    onClick={() => approve(v.google_place_id)}
                    style={{ padding: '6px 12px', background: approvedIds.has(v.google_place_id) ? '#00e676' : '#1a2a4a', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✅
                  </button>
                  <button
                    onClick={() => reject(v.google_place_id)}
                    style={{ padding: '6px 12px', background: rejectedIds.has(v.google_place_id) ? '#ff4444' : '#1a2a4a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ❌
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h2 style={{ color: '#00e5ff' }}>
                Current {CATEGORIES.find(c => c.id === category)?.label} ({currentVenues.length})
              </h2>
              <input
                value={venueSearch}
                onChange={(e) => setVenueSearch(e.target.value)}
                placeholder="Search current venues..."
                style={{ padding: '8px 12px', background: '#0a1628', border: '1px solid #1a2a4a', borderRadius: '8px', color: '#fff', width: '240px' }}
              />
            </div>

            {actionError && <div style={{ color: '#ff6666', marginBottom: '12px' }}>⚠️ {actionError}</div>}

            {loadingVenues ? (
              <div style={{ color: '#888' }}>Loading…</div>
            ) : visibleCurrentVenues.length === 0 ? (
              <div style={{ color: '#888' }}>No venues match.</div>
            ) : (
              visibleCurrentVenues.map(v => {
                const reason = wrongTypeReason(v);
                return (
                  <div
                    key={v.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
                      marginBottom: '6px', borderRadius: '8px', background: '#0a1628',
                      border: `1px solid ${reason ? '#ff4444' : '#1a2a4a'}`,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: reason ? '#ff8888' : '#fff' }}>
                        {v.name}{v.is_hidden ? ' (hidden)' : ''}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#888' }}>
                        {v.google_place_id || 'no google_place_id'} · {v.source}
                        {reason && <span style={{ color: '#ff4444' }}> · ⛔ {reason}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => hideVenue(v)}
                      style={{ padding: '6px 12px', background: '#1a2a4a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}
                    >
                      {v.is_hidden ? 'Show' : 'Hide'}
                    </button>
                    <button
                      onClick={() => deleteVenue(v)}
                      style={{ padding: '6px 12px', background: '#ff4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}
                    >
                      Delete
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </main>
      </div>
    </>
  );
}

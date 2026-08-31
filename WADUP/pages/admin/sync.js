import { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { CATEGORY_LABELS } from '../../lib/data';
import { supabase } from '../../lib/supabase';

// The password prompt below is a convenience UI gate only — the real check
// happens server-side in pages/api/places/sync.js and
// pages/api/admin/hide-venue.js (X-Admin-Password vs
// process.env.ADMIN_SYNC_PASSWORD). A wrong password here just means every
// sync/delete attempt gets a 401 back from the API; nothing sensitive is
// decided on the client.
export default function AdminSync() {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const [venues, setVenues] = useState([]);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [venueSearch, setVenueSearch] = useState('');
  const [hidingId, setHidingId] = useState(null);
  const [hideError, setHideError] = useState('');

  const runSync = async () => {
    setSyncing(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/places/sync', {
        method: 'POST',
        headers: { 'X-Admin-Password': password },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sync failed');
      } else {
        setResult(data);
        loadVenues();
      }
    } catch (e) {
      setError('Sync failed — network error');
    }
    setSyncing(false);
  };

  // venues.is_hidden has a public SELECT policy, so listing (including
  // already-hidden rows, so the admin can see what's already gone) doesn't
  // need the admin password — only the actual hide action does.
  const loadVenues = useCallback(async () => {
    setVenuesLoading(true);
    const { data } = await supabase
      .from('venues')
      .select('id, name, category, city, is_hidden')
      .order('name', { ascending: true });
    setVenues(data || []);
    setVenuesLoading(false);
  }, []);

  useEffect(() => { if (unlocked) loadVenues(); }, [unlocked, loadVenues]);

  const filteredVenues = useMemo(() => {
    const q = venueSearch.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(v =>
      v.name.toLowerCase().includes(q) || (v.city || '').toLowerCase().includes(q)
    );
  }, [venues, venueSearch]);

  const hideVenue = async (venue) => {
    if (venue.is_hidden) return;
    setHidingId(venue.id);
    setHideError('');
    try {
      const res = await fetch('/api/admin/hide-venue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
        body: JSON.stringify({ venueId: venue.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setHideError(data.error || 'Hide failed');
      } else {
        setVenues(prev => prev.map(v => v.id === venue.id ? { ...v, is_hidden: true } : v));
      }
    } catch (e) {
      setHideError('Hide failed — network error');
    }
    setHidingId(null);
  };

  return (
    <>
      <Head>
        <title>Admin — Sync Venues</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="admin-sync-page">
        <h1>🔄 Sync Chattanooga Venues</h1>

        {!unlocked ? (
          <div className="admin-gate">
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && password) setUnlocked(true); }}
            />
            <button
              className="admin-sync-btn"
              onClick={() => { if (password) setUnlocked(true); }}
              disabled={!password}
            >
              Unlock
            </button>
          </div>
        ) : (
          <>
            <p className="admin-sync-desc">
              Pulls real venues from Google Places (New) within 20km of downtown Chattanooga
              across several category groups (bars/nightlife, restaurants/cafes/bakeries/takeaway,
              live music/concerts, activities, outdoors, sports, movies/comedy), skips national
              chains, and upserts the rest into the <code>venues</code> table, keyed on
              <code> google_place_id</code> so re-running this is always safe — existing venues
              get refreshed, not duplicated.
            </p>

            <button className="admin-sync-btn" onClick={runSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync Chattanooga Venues'}
            </button>

            {error && <div className="admin-sync-error">⚠️ {error}</div>}

            {result && (
              <div className="admin-sync-result">
                <div className="admin-sync-summary">
                  ✅ {result.added} added &nbsp;·&nbsp; 🔄 {result.updated} updated &nbsp;·&nbsp;
                  📦 {result.totalFetched} total fetched &nbsp;·&nbsp; 🚫 {result.skippedChains || 0} chains skipped
                </div>
                {Object.keys(result.byCategory || {}).length > 0 && (
                  <ul className="admin-sync-breakdown">
                    {Object.entries(result.byCategory).map(([cat, n]) => (
                      <li key={cat}>{CATEGORY_LABELS[cat] || cat}: {n}</li>
                    ))}
                  </ul>
                )}
                {result.errors?.length > 0 && (
                  <div className="admin-sync-warnings">
                    ⚠️ {result.errors.length} type group(s) had errors:
                    <ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            <div className="admin-venues-section">
              <h2>🗑️ Manage Venues</h2>
              <p className="admin-sync-desc">
                Deleting a venue here doesn&apos;t remove its row — it sets <code>is_hidden</code> to
                true, which hides it from the map, search, trending, and Discover for every user,
                permanently. There&apos;s no undo in this UI; un-hiding requires a direct database edit.
              </p>
              <input
                className="admin-venue-search"
                type="text"
                placeholder="Search venues by name or city…"
                value={venueSearch}
                onChange={(e) => setVenueSearch(e.target.value)}
              />
              {hideError && <div className="admin-sync-error">⚠️ {hideError}</div>}

              {venuesLoading ? (
                <div className="admin-sync-desc">Loading venues…</div>
              ) : (
                <div className="admin-venue-list">
                  {filteredVenues.length === 0 ? (
                    <div className="admin-sync-desc">No venues match &ldquo;{venueSearch}&rdquo;.</div>
                  ) : filteredVenues.map(v => (
                    <div key={v.id} className={`admin-venue-row${v.is_hidden ? ' hidden' : ''}`}>
                      <div className="admin-venue-info">
                        <div className="admin-venue-name">{v.name}</div>
                        <div className="admin-venue-meta">
                          {CATEGORY_LABELS[v.category] || v.category} · {v.city}
                          {v.is_hidden && <span className="admin-venue-hidden-tag"> · hidden</span>}
                        </div>
                      </div>
                      <button
                        className="admin-venue-delete-btn"
                        onClick={() => hideVenue(v)}
                        disabled={v.is_hidden || hidingId === v.id}
                      >
                        {v.is_hidden ? 'Hidden' : hidingId === v.id ? 'Hiding…' : '🗑️ Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

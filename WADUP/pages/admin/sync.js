import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { CATEGORY_LABELS } from '../../lib/data';

// The password prompt below is a convenience UI gate only — the real check
// happens server-side in pages/api/places/sync.js (X-Admin-Password vs
// process.env.ADMIN_SYNC_PASSWORD). A wrong password here just means every
// sync attempt gets a 401 back from the API; nothing sensitive is decided
// on the client.
//
// This page used to also have its own venue hide/delete list, but that's
// now fully superseded by /admin/venues (Edit/Hide/Show/Delete, category
// management, and real admin_roles-based auth instead of a shared
// password) — see pages/admin/venues.js.
export default function AdminSync() {
  const [password, setPassword] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const runSync = async () => {
    if (!password) { setError('Enter the admin password first'); return; }
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
      }
    } catch (e) {
      setError('Sync failed — network error');
    }
    setSyncing(false);
  };

  return (
    <>
      <Head>
        <title>Admin — Sync Venues</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="admin-sync-page">
        <h1>🔄 Sync Chattanooga Venues</h1>

        {/* The button is always visible up front — no separate "Unlock" step
            hiding it. Typing the password is still required to actually run
            a sync: it's sent straight through to pages/api/places/sync.js,
            which checks it server-side against process.env.ADMIN_SYNC_PASSWORD.
            The password is never baked into the page itself (that would mean
            shipping it to every visitor's browser bundle) — it has to be
            typed here, same as before. */}
        <div className="admin-gate">
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && password && !syncing) runSync(); }}
          />
        </div>

        <button className="admin-sync-btn" onClick={runSync} disabled={syncing || !password}>
          {syncing ? 'Syncing…' : 'Sync Chattanooga Venues'}
        </button>

        <p className="admin-sync-desc">
          Pulls real venues from Google Places (New) across ~56 specific place-type searches
          (bars, breweries, a dozen+ restaurant subtypes, concert halls, museums, parks, golf
          courses, and more) run against 5 overlapping search areas covering greater
          Chattanooga (downtown, Hamilton Place, North Shore/Hixson, Lookout Mountain/Southside),
          skips national chains, and upserts the rest into a review queue for approval — see the{' '}
          <Link href="/admin/venues">Venue Manager</Link>&apos;s Pending tab. Keyed on
          <code> google_place_id</code>, so re-running this is always safe — existing venues get
          refreshed, not duplicated. This is a much larger sync than it used to be (~280 API
          calls) and can take up to a minute.
        </p>

        {error && <div className="admin-sync-error">⚠️ {error}</div>}

        {result && (
          <div className="admin-sync-result">
            <div className="admin-sync-summary">
              📋 {result.added_to_queue} added to review queue &nbsp;·&nbsp;
              🔄 {result.already_live} live venues refreshed &nbsp;·&nbsp;
              📦 {result.totalFetched} total fetched &nbsp;·&nbsp;
              🚫 {result.skippedChains || 0} chains skipped
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
                ⚠️ {result.errors.length} search(es) had errors:
                <ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        <div className="admin-venues-section">
          <p className="admin-sync-desc">
            Need to edit, hide, or delete a venue? Head to the{' '}
            <Link href="/admin/venues">Venue Manager</Link> — it has full edit/hide/delete
            controls and requires a real WadUp admin account rather than this page&apos;s
            shared password.
          </p>
        </div>
      </div>
    </>
  );
}

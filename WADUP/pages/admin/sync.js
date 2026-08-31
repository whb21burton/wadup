import { useState } from 'react';
import Head from 'next/head';
import { CATEGORY_LABELS } from '../../lib/data';

// The password prompt below is a convenience UI gate only — the real check
// happens server-side in pages/api/places/sync.js (X-Admin-Password vs
// process.env.ADMIN_SYNC_PASSWORD). A wrong password here just means every
// sync attempt gets a 401 back from the API; nothing sensitive is decided
// on the client.
export default function AdminSync() {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

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
              across 7 category groups (bars/nightlife, restaurants, live music/concerts,
              activities, outdoors, sports, movies/comedy) and upserts them into the
              <code> venues</code> table, keyed on <code>google_place_id</code> so re-running
              this is always safe — existing venues get refreshed, not duplicated.
            </p>

            <button className="admin-sync-btn" onClick={runSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync Chattanooga Venues'}
            </button>

            {error && <div className="admin-sync-error">⚠️ {error}</div>}

            {result && (
              <div className="admin-sync-result">
                <div className="admin-sync-summary">
                  ✅ {result.added} added &nbsp;·&nbsp; 🔄 {result.updated} updated &nbsp;·&nbsp; 📦 {result.totalFetched} total fetched
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
          </>
        )}
      </div>
    </>
  );
}

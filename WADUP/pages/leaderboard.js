import { useEffect, useState, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import { BADGES } from '../lib/badges';

const DEFAULT_CITY = 'Chattanooga';
const AVATAR_COLORS = ['#FF4500', '#00E5FF', '#FFD700', '#7cffb0', '#ff6fb0', '#9b8cff'];
function avatarColor(username) {
  const chars = [...(username || '?')];
  const sum = chars.reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

const WINDOWS = [
  { id: 'all',   label: '🌍 All Time' },
  { id: 'month', label: '📅 This Month' },
  { id: 'week',  label: '🌙 This Week' },
];

function windowStartIso(windowId) {
  const now = new Date();
  if (windowId === 'week')  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (windowId === 'month') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

// All-time uses profiles.wadup_points directly (already a public running
// total) — cheap and exact. Month/Week need points *earned in that window*,
// which points_log_activity (user_id + points + when, no `reason`) is the
// public, privacy-safe source for — see the phase3_badges_and_leaderboard_views
// migration. There's no per-city column on that view, so city-scoping for
// those two windows happens after aggregating in JS, same approach as the
// trending-score math in lib/rankings.js.
async function loadLeaderboard(windowId, scope, city) {
  if (windowId === 'all') {
    let q = supabase.from('profiles').select('id, username, city, wadup_points')
      .order('wadup_points', { ascending: false }).limit(50);
    if (scope === 'city' && city) q = q.eq('city', city);
    const { data } = await q;
    return (data || []).map(p => ({ id: p.id, username: p.username, city: p.city, points: p.wadup_points || 0 }));
  }

  const since = windowStartIso(windowId);
  const { data: activity } = await supabase.from('points_log_activity').select('user_id, points').gte('created_at', since);
  const sums = {};
  (activity || []).forEach(r => { sums[r.user_id] = (sums[r.user_id] || 0) + r.points; });
  const userIds = Object.keys(sums);
  if (!userIds.length) return [];

  const { data: profiles } = await supabase.from('profiles').select('id, username, city').in('id', userIds);
  let rows = (profiles || []).map(p => ({ id: p.id, username: p.username, city: p.city, points: sums[p.id] || 0 }));
  if (scope === 'city' && city) rows = rows.filter(p => p.city === city);
  return rows.sort((a, b) => b.points - a.points).slice(0, 50);
}

export default function Leaderboard() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [city,    setCity]    = useState(null);

  const [scope,   setScope]   = useState('city'); // 'city' | 'national'
  const [windowId,setWindowId]= useState('all');
  const [rows,    setRows]    = useState([]);
  const [topBadges, setTopBadges] = useState({}); // user_id -> badge label
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    let cancelled = false;
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data, error }) => { if (!cancelled && !error) setProfile(data); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (profile?.city) { setCity(profile.city); return; }
    if (typeof window === 'undefined' || !navigator.geolocation) { setCity(DEFAULT_CITY); return; }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`/api/geocode?latlng=${pos.coords.latitude},${pos.coords.longitude}`);
          const data = await res.json();
          const locality = (data.results?.[0]?.address_components || []).find(c => c.types.includes('locality'));
          if (!cancelled) setCity(locality?.long_name || DEFAULT_CITY);
        } catch (e) { if (!cancelled) setCity(DEFAULT_CITY); }
      },
      () => { if (!cancelled) setCity(DEFAULT_CITY); },
      { timeout: 5000 }
    );
    return () => { cancelled = true; };
  }, [profile]);

  const load = useCallback(async () => {
    if (scope === 'city' && !city) return;
    setLoading(true);
    const leaderboardRows = await loadLeaderboard(windowId, scope, city);
    setRows(leaderboardRows);

    if (leaderboardRows.length) {
      const { data: badgeRows } = await supabase
        .from('user_badges').select('user_id, badge_id').in('user_id', leaderboardRows.map(r => r.id));
      const badgesByUser = {};
      (badgeRows || []).forEach(row => {
        (badgesByUser[row.user_id] = badgesByUser[row.user_id] || []).push(row.badge_id);
      });
      const topBadgeByUser = {};
      Object.entries(badgesByUser).forEach(([userId, ids]) => {
        const top = BADGES.find(b => ids.includes(b.id));
        if (top) topBadgeByUser[userId] = top.label;
      });
      setTopBadges(topBadgeByUser);
    } else {
      setTopBadges({});
    }
    setLoading(false);
  }, [windowId, scope, city]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Head>
        <title>Leaderboard — WadUp</title>
        <meta name="description" content="Top WadUp points earners, local and nationwide." />
      </Head>

      <div className="leaderboard-page">
        <div className="disco-header">
          <Link href="/" className="venue-back-btn" aria-label="Back to map">←</Link>
          <div>
            <h1>Leaderboard</h1>
            {scope === 'city' && city && <div className="disco-subtitle">📍 {city}</div>}
          </div>
        </div>

        <div className="leaderboard-scope-toggle">
          <button className={`scope-btn${scope === 'city' ? ' active' : ''}`} onClick={() => setScope('city')}>📍 My City</button>
          <button className={`scope-btn${scope === 'national' ? ' active' : ''}`} onClick={() => setScope('national')}>🌎 National</button>
        </div>

        <div className="leaderboard-window-tabs">
          {WINDOWS.map(w => (
            <button
              key={w.id}
              className={`quick-filter-btn${windowId === w.id ? ' active' : ''}`}
              onClick={() => setWindowId(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="venue-page-status"><div className="cover-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="venue-empty-note">No points earned {scope === 'city' ? 'in this city' : ''} for this period yet.</p>
        ) : (
          <div className="leaderboard-list">
            {rows.map((row, i) => (
              <Link key={row.id} href={`/profile/${row.username}`} className="leaderboard-row">
                <div className="leaderboard-rank">#{i + 1}</div>
                <div className="leaderboard-avatar" style={{ background: avatarColor(row.username) }}>
                  {(row.username || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="leaderboard-info">
                  <div className="leaderboard-username">@{row.username}</div>
                  {topBadges[row.id] && <div className="leaderboard-top-badge">{topBadges[row.id]}</div>}
                </div>
                <div className="leaderboard-points">🔥 {row.points.toLocaleString()}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

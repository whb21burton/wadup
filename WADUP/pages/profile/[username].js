import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { CATEGORY_LABELS } from '../../lib/data';
import { getUserBadges } from '../../lib/badges';

const AVATAR_COLORS = ['#FF4500', '#00E5FF', '#FFD700', '#7cffb0', '#ff6fb0', '#9b8cff'];
function avatarColor(username) {
  const chars = [...(username || '?')];
  const sum = chars.reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TABS = [
  { id: 'reviews',  label: 'Reviews' },
  { id: 'checkins', label: 'Check-ins' },
  { id: 'saved',    label: 'Saved Places' },
  { id: 'photos',   label: 'Photos' },
];

export default function UserProfile() {
  const router = useRouter();
  const { username, tab: tabParam } = router.query;

  const [session,       setSession]       = useState(null);
  const [viewerProfile, setViewerProfile] = useState(null);
  const [profile,       setProfile]       = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [notFound,      setNotFound]      = useState(false);

  const [badges, setBadges] = useState([]);
  const [stats,  setStats]  = useState({ reviews: 0, checkins: 0, saved: 0, photos: 0 });

  const [activeTab,    setActiveTab]    = useState('reviews');
  const [reviews,      setReviews]      = useState(null);
  const [checkins,     setCheckins]     = useState(null);
  const [savedVenues,  setSavedVenues]  = useState(null);
  const [photos,       setPhotos]       = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setViewerProfile(null); return; }
    let cancelled = false;
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data, error }) => { if (!cancelled && !error) setViewerProfile(data); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (typeof tabParam === 'string' && TABS.some(t => t.id === tabParam)) setActiveTab(tabParam);
  }, [tabParam]);

  const isOwner = !!(viewerProfile && profile && viewerProfile.id === profile.id);

  const loadProfile = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setNotFound(false);

    const { data: profileData, error } = await supabase
      .from('profiles').select('*').eq('username', username).single();
    if (error || !profileData) { setNotFound(true); setLoading(false); return; }
    setProfile(profileData);

    const [
      badgeList,
      { count: reviewCount },
      { data: checkinStats },
      { data: savedStats },
      { count: photoCount },
    ] = await Promise.all([
      getUserBadges(profileData.id),
      supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('user_id', profileData.id),
      supabase.from('user_checkin_stats').select('total_checkins').eq('user_id', profileData.id).maybeSingle(),
      supabase.from('user_saved_stats').select('saved_count').eq('user_id', profileData.id).maybeSingle(),
      supabase.from('venue_photos').select('id', { count: 'exact', head: true }).eq('user_id', profileData.id),
    ]);

    setBadges(badgeList);
    setStats({
      reviews: reviewCount || 0,
      checkins: checkinStats?.total_checkins || 0,
      saved: savedStats?.saved_count || 0,
      photos: photoCount || 0,
    });
    setLoading(false);
  }, [username]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Reviews and photos are publicly readable; check-ins and saved places are
  // RLS-restricted to their own owner (private by design — nobody else can
  // see exactly which venues/when you checked into or bookmarked), so those
  // two tabs only actually fetch detail when the viewer is the profile owner.
  useEffect(() => {
    if (!profile) return;
    if (activeTab === 'reviews' && reviews === null) {
      supabase.from('reviews').select('*, venues(id, name, category, subcategory)')
        .eq('user_id', profile.id).order('created_at', { ascending: false })
        .then(({ data }) => setReviews(data || []));
    } else if (activeTab === 'checkins' && isOwner && checkins === null) {
      supabase.from('checkins').select('*, venues(id, name, city, state)')
        .eq('user_id', profile.id).order('created_at', { ascending: false })
        .then(({ data }) => setCheckins(data || []));
    } else if (activeTab === 'saved' && isOwner && savedVenues === null) {
      supabase.from('saved_venues').select('created_at, venues(*)')
        .eq('user_id', profile.id).order('created_at', { ascending: false })
        .then(({ data }) => setSavedVenues(data || []));
    } else if (activeTab === 'photos' && photos === null) {
      supabase.from('venue_photos').select('*, venues(id, name)')
        .eq('user_id', profile.id).order('created_at', { ascending: false })
        .then(({ data }) => setPhotos(data || []));
    }
  }, [activeTab, profile, isOwner, reviews, checkins, savedVenues, photos]);

  const goToTab = (tabId) => {
    setActiveTab(tabId);
    router.replace({ pathname: router.pathname, query: { ...router.query, tab: tabId } }, undefined, { shallow: true });
  };

  if (loading) {
    return <div className="venue-page-status"><div className="cover-spin" /></div>;
  }
  if (notFound) {
    return (
      <div className="venue-page-status">
        <p>User not found.</p>
        <Link href="/" className="venue-back-link">← Back to map</Link>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>@{profile.username} — WadUp</title>
        <meta name="description" content={`@${profile.username}'s profile on WadUp`} />
      </Head>

      <div className="profile-page">
        <div className="profile-page-header">
          <Link href="/" className="venue-back-btn" aria-label="Back to map">←</Link>
          <div className="profile-hero-avatar" style={{ background: avatarColor(profile.username) }}>
            {(profile.username || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="profile-hero-name">@{profile.username}</div>
          <div className="profile-hero-location">
            📍 {profile.city || 'Unknown city'}
            {profile.is_local && <span className="local-badge">📍 Local</span>}
          </div>
          <div className="profile-hero-points">🔥 {(profile.wadup_points || 0).toLocaleString()} WadUp Points</div>
        </div>

        {badges.length > 0 && (
          <div className="profile-badges-row">
            {badges.map(b => (
              <div key={b.id} className="profile-badge" title={b.desc}>{b.label}</div>
            ))}
          </div>
        )}

        <div className="profile-stats-row">
          <div className="pstat-block"><div className="pstat-num">{stats.reviews}</div><div className="pstat-label">Reviews</div></div>
          <div className="pstat-block"><div className="pstat-num">{stats.checkins}</div><div className="pstat-label">Check-ins</div></div>
          <div className="pstat-block"><div className="pstat-num">{stats.saved}</div><div className="pstat-label">Places Saved</div></div>
          <div className="pstat-block"><div className="pstat-num">{stats.photos}</div><div className="pstat-label">Photos</div></div>
        </div>

        <div className="profile-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`profile-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => goToTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="profile-tab-content">
          {activeTab === 'reviews' && (
            reviews === null ? (
              <div className="venue-page-status" style={{ minHeight: 120 }}><div className="cover-spin" /></div>
            ) : reviews.length === 0 ? (
              <p className="venue-empty-note">No reviews yet.</p>
            ) : (
              <div className="reviews-list">
                {reviews.map(r => (
                  <div key={r.id} className="review-card">
                    <div className="review-card-header">
                      {r.venues ? (
                        <Link href={`/venue/${r.venues.id}`} className="review-username">{r.venues.name}</Link>
                      ) : (
                        <span className="review-username">Venue removed</span>
                      )}
                      <span className="review-date">{formatDate(r.created_at)}</span>
                    </div>
                    <div className="review-stars">{'★'.repeat(r.rating || 0)}{'☆'.repeat(5 - (r.rating || 0))}</div>
                    {r.tags?.length > 0 && (
                      <div className="review-tags">
                        {r.tags.map(t => <span key={t} className="review-tag">{t}</span>)}
                      </div>
                    )}
                    {r.content && <p className="review-content">{r.content}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'checkins' && (
            !isOwner ? (
              <p className="venue-empty-note">🔒 Check-in history is private.</p>
            ) : checkins === null ? (
              <div className="venue-page-status" style={{ minHeight: 120 }}><div className="cover-spin" /></div>
            ) : checkins.length === 0 ? (
              <p className="venue-empty-note">No check-ins yet.</p>
            ) : (
              <div className="checkin-list">
                {checkins.map(c => (
                  <Link key={c.id} href={c.venues ? `/venue/${c.venues.id}` : '#'} className="checkin-item">
                    <span className="checkin-icon">📍</span>
                    <div className="checkin-item-text">
                      <div className="checkin-venue-name">{c.venues?.name || 'Venue removed'}</div>
                      <div className="checkin-venue-city">{c.venues?.city}{c.venues?.state ? `, ${c.venues.state}` : ''}</div>
                    </div>
                    <div className="checkin-date">{formatDate(c.created_at)}</div>
                  </Link>
                ))}
              </div>
            )
          )}

          {activeTab === 'saved' && (
            !isOwner ? (
              <p className="venue-empty-note">🔒 Saved places are private.</p>
            ) : savedVenues === null ? (
              <div className="venue-page-status" style={{ minHeight: 120 }}><div className="cover-spin" /></div>
            ) : savedVenues.length === 0 ? (
              <p className="venue-empty-note">No saved places yet.</p>
            ) : (
              <div className="browse-grid">
                {savedVenues.map(s => s.venues && (
                  <Link key={s.venues.id} href={`/venue/${s.venues.id}`} className="browse-card">
                    <div className="browse-card-name">{s.venues.name}</div>
                    <div className="browse-card-sub">{s.venues.subcategory || CATEGORY_LABELS[s.venues.category] || ''}</div>
                    <div className="browse-card-meta">
                      <span>📍 {s.venues.city}{s.venues.state ? `, ${s.venues.state}` : ''}</span>
                      {(s.venues.total_ratings || 0) >= 5 && (
                        <span className="browse-card-rating">⭐ {(s.venues.average_rating || 0).toFixed(1)}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}

          {activeTab === 'photos' && (
            photos === null ? (
              <div className="venue-page-status" style={{ minHeight: 120 }}><div className="cover-spin" /></div>
            ) : photos.length === 0 ? (
              <p className="venue-empty-note">No photos yet.</p>
            ) : (
              <div className="profile-photo-grid">
                {photos.map(p => (
                  <Link key={p.id} href={p.venues ? `/venue/${p.venues.id}` : '#'} className="profile-photo-tile">
                    <img src={p.url} alt={p.caption || p.venues?.name || ''} />
                  </Link>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}

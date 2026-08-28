import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { CATEGORY_LABELS } from '../../lib/data';
import AuthSidebar from '../../components/AuthSidebar';
import WriteReviewModal from '../../components/WriteReviewModal';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const EVENT_TYPE_ICONS = {
  live_music: '🎵',
  trivia:     '🧠',
  specials:   '🏷️',
  happy_hour: '⏰',
};
const EVENT_TYPE_LABELS = {
  live_music: 'Live Music',
  trivia:     'Trivia',
  specials:   'Specials',
  happy_hour: 'Happy Hour',
};

function formatTime12h(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function ensureUrl(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Postgres `timestamp without time zone` columns (venue_events.start_time/
// end_time, reviews.created_at) come back from PostgREST with no timezone
// suffix, e.g. "2026-08-28T15:58:28.88". JavaScript's Date parser treats a
// string like that as LOCAL time, not UTC — silently shifting every instant
// by the viewer's UTC offset (verified: a 4-hour shift on this machine,
// enough to make "Live Now" never trigger). Force UTC interpretation.
function parseUtcTimestamp(ts) {
  if (!ts) return null;
  const hasTz = /[Z]$|[+-]\d{2}:?\d{2}$/.test(ts);
  return new Date(hasTz ? ts : `${ts}Z`);
}

function isLiveNow(ev) {
  if (!ev.start_time || !ev.end_time) return false;
  const now = Date.now();
  return now >= parseUtcTimestamp(ev.start_time).getTime() && now <= parseUtcTimestamp(ev.end_time).getTime();
}

function formatEventTime(ev) {
  if (!ev.start_time) return 'Date TBD';
  const start = parseUtcTimestamp(ev.start_time);
  const dateStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} · ${timeStr}`;
}

function formatReviewDate(iso) {
  return parseUtcTimestamp(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const SORT_OPTIONS = [
  { id: 'recent',  label: 'Most Recent' },
  { id: 'helpful', label: 'Most Helpful' },
  { id: 'highest', label: 'Highest Rated' },
  { id: 'lowest',  label: 'Lowest Rated' },
];

const REPORT_REASON = 'inappropriate_or_spam';

export default function VenuePage() {
  const router = useRouter();
  const { id } = router.query;

  const [venue,     setVenue]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [notFound,  setNotFound]  = useState(false);
  const [reviews,   setReviews]   = useState([]);
  const [events,    setEvents]    = useState([]);
  const [schedule,  setSchedule]  = useState([]);
  const [sortMode,  setSortMode]  = useState('recent');
  const [rankings,  setRankings]  = useState({ trending: null, bestRated: null });

  const [session,  setSession]  = useState(null);
  const [profile,  setProfile]  = useState(null);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const [myLikes,     setMyLikes]     = useState(new Set());
  const [saved,        setSaved]       = useState(false);
  const [checkedIn,    setCheckedIn]   = useState(false);
  const [reportedIds,  setReportedIds] = useState(new Set());
  const [shareCopied,  setShareCopied] = useState(false);

  // ── Auth session — same pattern used on the map page ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    let cancelled = false;
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data, error }) => { if (!cancelled && !error) setProfile(data); });
    return () => { cancelled = true; };
  }, [session]);

  const requireLogin = useCallback(() => setRightSidebarOpen(true), []);

  // ── Fetch the venue + everything hanging off it ──
  const loadVenue = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);

    const { data: venueData, error: venueErr } = await supabase
      .from('venues').select('*').eq('id', id).single();

    if (venueErr || !venueData) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setVenue(venueData);

    const [{ data: reviewData }, { data: eventData }, { data: scheduleData }] = await Promise.all([
      // profiles!reviews_user_id_fkey disambiguates the embed — reviews also
      // reaches profiles indirectly via review_likes (many-to-many), so the
      // bare `profiles(...)` embed is ambiguous and PostgREST rejects it
      // outright (verified directly against the REST API: PGRST201).
      supabase.from('reviews').select('*, profiles!reviews_user_id_fkey(username, city, is_local)').eq('venue_id', id).order('created_at', { ascending: false }),
      // Filtering on start_time >= now would exclude any event currently in
      // progress (its start_time is necessarily in the past), which would
      // make the "🔴 Live Now" badge structurally unreachable. Filter on
      // end_time instead so ongoing events stay included until they're over.
      supabase.from('venue_events').select('*').eq('venue_id', id).gte('end_time', new Date().toISOString()).order('start_time', { ascending: true }),
      supabase.from('venue_schedule').select('*').eq('venue_id', id).order('day_of_week', { ascending: true }),
    ]);
    setReviews(reviewData || []);
    setEvents(eventData || []);
    setSchedule(scheduleData || []);

    // Rankings within the same city — gated on having enough peers for the
    // number to mean anything, rather than trivially always being "#1".
    if (venueData.city) {
      const [{ data: byRating }, { data: byPopularity }] = await Promise.all([
        supabase.from('venues').select('id').eq('city', venueData.city).order('average_rating', { ascending: false }),
        supabase.from('venues').select('id').eq('city', venueData.city).order('total_ratings', { ascending: false }),
      ]);
      const enough = (list) => Array.isArray(list) && list.length >= 3;
      const rank = (list) => {
        const idx = list.findIndex(v => v.id === venueData.id);
        return idx >= 0 && idx < 10 ? idx + 1 : null;
      };
      setRankings({
        bestRated: enough(byRating) ? rank(byRating) : null,
        trending:  enough(byPopularity) ? rank(byPopularity) : null,
      });
    }

    setLoading(false);
  }, [id]);

  useEffect(() => { loadVenue(); }, [loadVenue]);

  // ── My own like / saved state (RLS only lets us see our own rows anyway) ──
  // Keyed on the *set of review ids*, not the `reviews` array reference —
  // toggleLike's own optimistic update to a review's `likes` count creates a
  // new array each time, which would otherwise re-trigger this fetch and
  // clobber the optimistic myLikes update before the write even lands.
  const reviewIdsKey = useMemo(() => reviews.map(r => r.id).join(','), [reviews]);
  useEffect(() => {
    if (!session?.user || !reviewIdsKey) { setMyLikes(new Set()); return; }
    supabase
      .from('review_likes')
      .select('review_id')
      .eq('user_id', session.user.id)
      .in('review_id', reviewIdsKey.split(','))
      .then(({ data }) => setMyLikes(new Set((data || []).map(r => r.review_id))));
  }, [session, reviewIdsKey]);

  useEffect(() => {
    if (!session?.user || !venue?.id) { setSaved(false); return; }
    supabase
      .from('saved_venues')
      .select('venue_id')
      .eq('user_id', session.user.id)
      .eq('venue_id', venue.id)
      .maybeSingle()
      .then(({ data }) => setSaved(!!data));
  }, [session, venue?.id]);

  const applyLikeDelta = (reviewId, delta, liked) => {
    setMyLikes(prev => {
      const next = new Set(prev);
      liked ? next.add(reviewId) : next.delete(reviewId);
      return next;
    });
    setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, likes: Math.max((r.likes || 0) + delta, 0) } : r));
  };

  const toggleLike = async (reviewId) => {
    if (!session) { requireLogin(); return; }
    const alreadyLiked = myLikes.has(reviewId);
    const delta = alreadyLiked ? -1 : 1;

    applyLikeDelta(reviewId, delta, !alreadyLiked);

    const { error } = alreadyLiked
      ? await supabase.from('review_likes').delete().eq('user_id', session.user.id).eq('review_id', reviewId)
      : await supabase.from('review_likes').insert({ user_id: session.user.id, review_id: reviewId });

    // Roll back the optimistic update if the write didn't actually land —
    // otherwise the displayed count silently drifts from the real value.
    if (error) applyLikeDelta(reviewId, -delta, alreadyLiked);
  };

  const submitReport = async (reviewId) => {
    if (!session) { requireLogin(); return; }
    if (reportedIds.has(reviewId)) return;
    setReportedIds(prev => new Set(prev).add(reviewId));
    await supabase.from('review_reports').insert({
      review_id: reviewId,
      reporter_id: session.user.id,
      reason: REPORT_REASON,
    });
  };

  const toggleSave = async () => {
    if (!session) { requireLogin(); return; }
    if (saved) {
      setSaved(false);
      await supabase.from('saved_venues').delete().eq('user_id', session.user.id).eq('venue_id', venue.id);
    } else {
      setSaved(true);
      await supabase.from('saved_venues').insert({ user_id: session.user.id, venue_id: venue.id });
    }
  };

  const checkIn = async () => {
    if (!session) { requireLogin(); return; }
    setCheckedIn(true);
    await supabase.from('checkins').insert({ user_id: session.user.id, venue_id: venue.id });
    setTimeout(() => setCheckedIn(false), 4000);
  };

  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try { await navigator.share({ title: venue?.name, url }); } catch (e) { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (e) { /* clipboard unavailable */ }
  };

  const sortedReviews = [...reviews].sort((a, b) => {
    if (sortMode === 'helpful') return (b.likes || 0) - (a.likes || 0);
    if (sortMode === 'highest') return (b.rating || 0) - (a.rating || 0);
    if (sortMode === 'lowest')  return (a.rating || 0) - (b.rating || 0);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if (loading) {
    return (
      <div className="venue-page-status">
        <div className="cover-spin" />
      </div>
    );
  }

  if (notFound || !venue) {
    return (
      <div className="venue-page-status">
        <p>Venue not found.</p>
        <Link href="/venue" className="venue-back-link">← Browse venues</Link>
      </div>
    );
  }

  const social = venue.social_links || {};

  return (
    <>
      <Head>
        <title>{venue.name} — WadUp</title>
        <meta name="description" content={venue.description || `${venue.name} on WadUp`} />
      </Head>

      <div className="venue-page">
        <div className="venue-header">
          <div
            className="venue-cover"
            style={venue.cover_photo_url ? { backgroundImage: `url(${venue.cover_photo_url})` } : undefined}
          >
            {!venue.cover_photo_url && <div className="venue-cover-gradient" />}
            <Link href="/" className="venue-back-btn" aria-label="Back to map">←</Link>
            <button
              className="right-sidebar-toggle venue-account-btn"
              onClick={() => setRightSidebarOpen(v => !v)}
              aria-label="Account"
            >
              {profile ? (profile.username || '?').slice(0, 1).toUpperCase() : '👤'}
            </button>
          </div>

          <div className="venue-header-content">
            <h1 className="venue-name">{venue.name}</h1>
            {venue.is_verified && <div className="venue-verified">✓ Verified Business</div>}

            <div className="venue-rating-line">
              {(venue.total_ratings || 0) < 5
                ? <span className="venue-new-badge">New on WadUp</span>
                : <span>⭐ {(venue.average_rating || 0).toFixed(1)} · {venue.total_ratings} Ratings</span>}
            </div>

            {(rankings.trending || rankings.bestRated) && (
              <div className="venue-rankings">
                {rankings.trending && <span>🔥 #{rankings.trending} Trending</span>}
                {rankings.trending && rankings.bestRated && <span className="venue-rankings-sep">·</span>}
                {rankings.bestRated && <span>🏆 #{rankings.bestRated} Best Rated</span>}
              </div>
            )}

            <div className="venue-location">📍 {venue.city}{venue.state ? `, ${venue.state}` : ''}</div>
            <div className="venue-category-line">
              {CATEGORY_LABELS[venue.category] || venue.category}
              {venue.subcategory ? ` · ${venue.subcategory}` : ''}
            </div>

            <div className="venue-actions">
              <button className="venue-action-btn" onClick={checkIn}>
                {checkedIn ? '✓ Checked In' : '📍 Check In'}
              </button>
              <button className="venue-action-btn venue-action-primary" onClick={() => setShowReviewModal(true)}>
                ✍️ Review
              </button>
              <button className="venue-action-btn" onClick={toggleSave}>
                {saved ? '★ Saved' : '☆ Save'}
              </button>
              <button className="venue-action-btn" onClick={share}>
                {shareCopied ? 'Copied!' : '🔗 Share'}
              </button>
            </div>
          </div>
        </div>

        <div className="venue-body">
          <section className="venue-section">
            <h2>About</h2>
            {venue.description && <p className="venue-description">{venue.description}</p>}

            {schedule.length > 0 && (
              <div className="venue-hours">
                {DAY_NAMES.map((name, i) => {
                  const row = schedule.find(s => s.day_of_week === i);
                  return (
                    <div key={i} className="venue-hours-row">
                      <span>{name}</span>
                      <span>{row ? `${formatTime12h(row.open_time)} – ${formatTime12h(row.close_time)}` : 'Closed'}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="venue-contact-row">
              {venue.phone && <a href={`tel:${venue.phone}`}>📞 {venue.phone}</a>}
              {venue.website && (
                <a href={ensureUrl(venue.website)} target="_blank" rel="noreferrer">🌐 {venue.website}</a>
              )}
            </div>

            {(social.instagram || social.facebook || social.twitter) && (
              <div className="venue-social-row">
                {social.instagram && <a href={ensureUrl(social.instagram)} target="_blank" rel="noreferrer">Instagram</a>}
                {social.facebook && <a href={ensureUrl(social.facebook)} target="_blank" rel="noreferrer">Facebook</a>}
                {social.twitter && <a href={ensureUrl(social.twitter)} target="_blank" rel="noreferrer">Twitter</a>}
              </div>
            )}
          </section>

          <section className="venue-section">
            <h2>What&apos;s Happening</h2>
            {events.length === 0 ? (
              <p className="venue-empty-note">No upcoming events posted yet.</p>
            ) : (
              <div className="venue-events-list">
                {events.map(ev => (
                  <div key={ev.id} className="venue-event-row">
                    <span className="venue-event-icon">{EVENT_TYPE_ICONS[ev.event_type] || '🎉'}</span>
                    <div className="venue-event-info">
                      <div className="venue-event-title">
                        {ev.title}
                        {isLiveNow(ev) && <span className="live-now-badge">🔴 Live Now</span>}
                      </div>
                      <div className="venue-event-meta">
                        {EVENT_TYPE_LABELS[ev.event_type] || 'Event'} · {formatEventTime(ev)}
                        {ev.is_free ? ' · Free' : ''}
                      </div>
                      {ev.description && <p className="venue-event-desc">{ev.description}</p>}
                      {ev.ticket_url && (
                        <a className="venue-event-tickets" href={ev.ticket_url} target="_blank" rel="noreferrer">
                          Tickets →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="venue-section">
            <div className="reviews-header">
              <h2>Reviews</h2>
              <select
                className="reviews-sort"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
              >
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>

            <button className="write-review-btn" onClick={() => setShowReviewModal(true)}>
              Write a Review
            </button>

            {sortedReviews.length === 0 ? (
              <p className="venue-empty-note">No reviews yet — be the first!</p>
            ) : (
              <div className="reviews-list">
                {sortedReviews.map(r => (
                  <div key={r.id} className="review-card">
                    <div className="review-card-header">
                      <span className="review-username">{r.profiles?.username || 'Anonymous'}</span>
                      {r.profiles?.is_local && r.profiles?.city === venue.city && (
                        <span className="local-badge">📍 Local</span>
                      )}
                      <span className="review-date">{formatReviewDate(r.created_at)}</span>
                    </div>
                    <div className="review-stars">
                      {'★'.repeat(r.rating || 0)}{'☆'.repeat(5 - (r.rating || 0))}
                    </div>
                    {r.tags?.length > 0 && (
                      <div className="review-tags">
                        {r.tags.map(t => <span key={t} className="review-tag">{t}</span>)}
                      </div>
                    )}
                    {r.content && <p className="review-content">{r.content}</p>}
                    {r.photo_urls?.length > 0 && (
                      <div className="review-photos">
                        {r.photo_urls.map((u, i) => <img key={i} src={u} alt="" />)}
                      </div>
                    )}
                    <div className="review-actions">
                      <button
                        className={`review-action-btn${myLikes.has(r.id) ? ' active' : ''}`}
                        onClick={() => toggleLike(r.id)}
                      >
                        👍 Helpful ({r.likes || 0})
                      </button>
                      <button
                        className="review-action-btn"
                        onClick={() => submitReport(r.id)}
                        disabled={reportedIds.has(r.id)}
                      >
                        {reportedIds.has(r.id) ? 'Reported' : 'Report'}
                      </button>
                    </div>
                    {r.business_response && (
                      <div className="business-response">
                        <div className="business-response-label">Response from {venue.name}</div>
                        <p>{r.business_response}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {!venue.owner_id && (
            <section className="venue-section claim-section">
              <p>
                Is this your business?{' '}
                <button className="claim-link" onClick={() => setRightSidebarOpen(true)}>
                  Claim this business →
                </button>
              </p>
            </section>
          )}
        </div>
      </div>

      <WriteReviewModal
        open={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        venueId={venue.id}
        session={session}
        onRequireLogin={() => { setShowReviewModal(false); requireLogin(); }}
        onSubmitted={() => { setShowReviewModal(false); loadVenue(); }}
      />

      <AuthSidebar
        open={rightSidebarOpen}
        onClose={() => setRightSidebarOpen(false)}
        session={session}
        profile={profile}
      />
    </>
  );
}

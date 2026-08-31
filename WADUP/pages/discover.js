import { useEffect, useState, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import { CATEGORY_LABELS, tmSegmentToCat, tmSportEmoji } from '../lib/data';
import { getTrendingVenues, getBestRated, getLocalFavorites } from '../lib/rankings';

const DEFAULT_CITY   = 'Chattanooga';
const DEFAULT_COORDS = { lat: 35.0456, lng: -85.3096 };
const TM_AFFILIATE_ID = process.env.NEXT_PUBLIC_TM_AFFILIATE_ID || 'YOUR_AFFILIATE_ID';

function withTMAffiliateTracking(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('camefrom', TM_AFFILIATE_ID);
    return u.toString();
  } catch (e) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}camefrom=${encodeURIComponent(TM_AFFILIATE_ID)}`;
  }
}

// venue_events.start_time/end_time are `timestamp without time zone` columns
// that actually hold UTC wall-clock values with no 'Z' suffix — see the
// identical note in pages/venue/[id].js. Re-append 'Z' before parsing so JS
// doesn't silently reinterpret them in the viewer's local timezone.
function parseUtcTimestamp(ts) {
  if (!ts) return null;
  const hasTz = /[Z]$|[+-]\d{2}:?\d{2}$/.test(ts);
  return new Date(hasTz ? ts : `${ts}Z`);
}

function utcDayBounds(date) {
  const start = new Date(date); start.setUTCHours(0, 0, 0, 0);
  const end   = new Date(date); end.setUTCHours(23, 59, 59, 999);
  return [start, end];
}

// Fri 00:00 UTC through Sun 23:59:59 UTC of the current (or, Mon–Thu, the
// upcoming) weekend — mirrors the day-math used for the map's day strip.
function weekendUtcBounds() {
  const now = new Date();
  const day = now.getUTCDay();
  const fridayOffset = day === 5 ? 0 : day === 6 ? -1 : day === 0 ? -2 : 5 - day;
  const fri = new Date(now);
  fri.setUTCDate(now.getUTCDate() + fridayOffset);
  fri.setUTCHours(0, 0, 0, 0);
  const sunEnd = new Date(fri);
  sunEnd.setUTCDate(fri.getUTCDate() + 2);
  sunEnd.setUTCHours(23, 59, 59, 999);
  return [fri, sunEnd];
}

function formatEventDate(startTs) {
  const d = parseUtcTimestamp(startTs);
  if (!d) return 'Date TBD';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatTmDate(dateStr, timeStr) {
  if (!dateStr) return 'Date TBD';
  const label = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return timeStr ? `${label} · ${timeStr.slice(0, 5)}` : label;
}

// One Ticketmaster fetch (server-side proxy) for a single date window, scoped
// to the user's own city — unlike the map's fetchTM, which staggers fetches
// across a dozen major-metro regions for a nationwide pin layer.
async function fetchTMEvents(lat, lng, start, end) {
  const qs = new URLSearchParams({
    size: 100, sort: 'date,asc', radius: 75, unit: 'miles',
    latlong: `${lat},${lng}`,
    startDateTime: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endDateTime: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  try {
    const res  = await fetch(`/api/tm?${qs}`);
    const data = await res.json();
    const events = data._embedded?.events || [];
    return events.map(ev => {
      const ven = ev._embedded?.venues?.[0] || {};
      const loc = ven.location || {};
      const lat2 = parseFloat(loc.latitude), lng2 = parseFloat(loc.longitude);
      const classification = ev.classifications?.[0] || {};
      const cat = tmSegmentToCat(ev.classifications, ev.name);
      const img = (ev.images?.find(i => i.ratio === '16_9' && i.width > 500) || ev.images?.[0])?.url || '';
      const norm = {
        id: ev.id, name: ev.name, cat,
        segment: classification.segment?.name, genre: classification.genre?.name, subGenre: classification.subGenre?.name,
        city: ven.city?.name || '', state: ven.state?.stateCode || '',
        lat: lat2, lng: lng2,
        dateStr: ev.dates?.start?.localDate || '', timeStr: ev.dates?.start?.localTime || '',
        img, url: ev.url || '',
      };
      if (cat === 'sports') norm.sportEmoji = tmSportEmoji(norm);
      return norm;
    }).filter(e => !isNaN(e.lat) && !isNaN(e.lng));
  } catch (e) {
    return [];
  }
}

function normalizeVenueCard(v, rank) {
  return {
    key: 'v_' + v.id,
    href: `/venue/${v.id}`,
    external: false,
    image: v.cover_photo_url || null,
    name: v.name,
    subtitle: [CATEGORY_LABELS[v.category] || v.category, v.subcategory].filter(Boolean).join(' · '),
    rating: (v.total_ratings || 0) >= 5 ? v.average_rating : null,
    ratingCount: v.total_ratings || 0,
    rank: rank || null,
    city: v.city, state: v.state,
    dateLabel: null,
  };
}

function normalizeVenueEventCard(ve) {
  const v = ve.venues || {};
  return {
    key: 've_' + ve.id,
    href: v.id ? `/venue/${v.id}` : '#',
    external: false,
    image: v.cover_photo_url || null,
    name: ve.title,
    subtitle: [CATEGORY_LABELS[v.category] || v.category, v.subcategory].filter(Boolean).join(' · '),
    rating: (v.total_ratings || 0) >= 5 ? v.average_rating : null,
    ratingCount: v.total_ratings || 0,
    rank: null,
    city: v.city, state: v.state,
    dateLabel: formatEventDate(ve.start_time),
  };
}

function normalizeTMCard(ev) {
  return {
    key: 'tm_' + ev.id,
    href: withTMAffiliateTracking(ev.url),
    external: true,
    image: ev.img || null,
    name: ev.name,
    subtitle: CATEGORY_LABELS[ev.cat] || ev.cat,
    rating: null,
    ratingCount: 0,
    rank: null,
    city: ev.city, state: ev.state,
    dateLabel: formatTmDate(ev.dateStr, ev.timeStr),
  };
}

function DiscoverCard({ item }) {
  const body = (
    <>
      <div className="disco-card-media" style={item.image ? { backgroundImage: `url(${item.image})` } : undefined}>
        {!item.image && <div className="disco-card-gradient" />}
        {item.rank && <div className="disco-card-rank">#{item.rank}</div>}
      </div>
      <div className="disco-card-body">
        <div className="disco-card-name">{item.name}</div>
        {item.subtitle && <div className="disco-card-sub">{item.subtitle}</div>}
        <div className="disco-card-meta">
          {item.rating != null && <span className="disco-card-rating">⭐ {item.rating.toFixed(1)} ({item.ratingCount})</span>}
          {item.dateLabel && <span className="disco-card-date">📅 {item.dateLabel}</span>}
        </div>
        <div className="disco-card-city">📍 {item.city}{item.state ? `, ${item.state}` : ''}</div>
      </div>
    </>
  );
  return item.external ? (
    <a className="disco-card" href={item.href} target="_blank" rel="noreferrer">{body}</a>
  ) : (
    <Link className="disco-card" href={item.href}>{body}</Link>
  );
}

function DiscoverSection({ title, items, emptyText }) {
  return (
    <div className="disco-section">
      <h2 className="disco-section-title">{title}</h2>
      {items.length === 0 ? (
        <div className="disco-empty">{emptyText}</div>
      ) : (
        <div className="disco-scroll">
          {items.map(item => <DiscoverCard key={item.key} item={item} />)}
        </div>
      )}
    </div>
  );
}

export default function Discover() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [city,    setCity]    = useState(null);
  const [coords,  setCoords]  = useState(DEFAULT_COORDS);
  const [loading, setLoading] = useState(true);

  const [trendingVenues,    setTrendingVenues]    = useState([]);
  const [bestRatedVenues,   setBestRatedVenues]   = useState([]);
  const [localFavorites,    setLocalFavorites]    = useState([]);
  const [tonightVenueEvents,setTonightVenueEvents]= useState([]);
  const [tonightTM,         setTonightTM]         = useState([]);
  const [weekendVenueEvents,setWeekendVenueEvents]= useState([]);
  const [weekendTM,         setWeekendTM]         = useState([]);

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

  // Resolve "user's city": their profile's home city, else their current
  // location reverse-geocoded, else a sane default so the page never dead-ends.
  useEffect(() => {
    if (profile?.city) { setCity(profile.city); return; }
    if (typeof window === 'undefined' || !navigator.geolocation) { setCity(DEFAULT_CITY); return; }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (cancelled) return;
        setCoords({ lat, lng });
        try {
          const res = await fetch(`/api/geocode?latlng=${lat},${lng}`);
          const data = await res.json();
          const comps = data.results?.[0]?.address_components || [];
          const locality = comps.find(c => c.types.includes('locality'));
          if (!cancelled) setCity(locality?.long_name || DEFAULT_CITY);
        } catch (e) {
          if (!cancelled) setCity(DEFAULT_CITY);
        }
      },
      () => { if (!cancelled) setCity(DEFAULT_CITY); },
      { timeout: 5000 }
    );
    return () => { cancelled = true; };
  }, [profile]);

  const loadDiscovery = useCallback(async () => {
    if (!city) return;
    setLoading(true);

    const [todayStart, todayEnd] = utcDayBounds(new Date());
    const [weekendStart, weekendEnd] = weekendUtcBounds();

    const [
      trendingData, bestRatedData, localFavData,
      tonightVE, weekendVE,
      tonightTMData, weekendTMData,
    ] = await Promise.all([
      getTrendingVenues(city, 20),
      getBestRated(city, 20),
      getLocalFavorites(city, 10),
      supabase.from('venue_events').select('*, venues!inner(*)').eq('venues.city', city).eq('venues.is_hidden', false)
        .lte('start_time', todayEnd.toISOString()).gte('end_time', todayStart.toISOString())
        .order('start_time', { ascending: true }),
      supabase.from('venue_events').select('*, venues!inner(*)').eq('venues.city', city).eq('venues.is_hidden', false)
        .gte('start_time', weekendStart.toISOString()).lte('start_time', weekendEnd.toISOString())
        .order('start_time', { ascending: true }),
      fetchTMEvents(coords.lat, coords.lng, todayStart, todayEnd),
      fetchTMEvents(coords.lat, coords.lng, weekendStart, weekendEnd),
    ]);

    setTrendingVenues(trendingData);
    setBestRatedVenues(bestRatedData);
    setLocalFavorites(localFavData);
    setTonightVenueEvents(tonightVE.data || []);
    setWeekendVenueEvents(weekendVE.data || []);
    setTonightTM(tonightTMData);
    setWeekendTM(weekendTMData);
    setLoading(false);
  }, [city, coords]);

  useEffect(() => { loadDiscovery(); }, [loadDiscovery]);

  const trendingCards     = useMemo(() => trendingVenues.map((v, i) => normalizeVenueCard(v, i + 1)), [trendingVenues]);
  const bestRatedCards    = useMemo(() => bestRatedVenues.map(v => normalizeVenueCard(v)), [bestRatedVenues]);
  const localFavoriteCards= useMemo(() => localFavorites.map(v => normalizeVenueCard(v)), [localFavorites]);
  const tonightCards      = useMemo(() => [
    ...tonightVenueEvents.map(normalizeVenueEventCard),
    ...tonightTM.map(normalizeTMCard),
  ], [tonightVenueEvents, tonightTM]);
  const weekendCards      = useMemo(() => [
    ...weekendVenueEvents.map(normalizeVenueEventCard),
    ...weekendTM.map(normalizeTMCard),
  ], [weekendVenueEvents, weekendTM]);

  return (
    <>
      <Head>
        <title>Discover — WadUp</title>
        <meta name="description" content="Trending venues, top-rated spots, and events happening tonight and this weekend on WadUp." />
      </Head>

      <div className="disco-page">
        <div className="disco-header">
          <Link href="/" className="venue-back-btn" aria-label="Back to map">←</Link>
          <div>
            <h1>Discover</h1>
            {city && <div className="disco-subtitle">📍 {city}</div>}
          </div>
        </div>

        {loading ? (
          <div className="venue-page-status"><div className="cover-spin" /></div>
        ) : (
          <>
            <DiscoverSection title="🔥 Trending Now" items={trendingCards} emptyText="Nothing trending yet — check back soon." />
            <DiscoverSection title="⭐ Best Rated" items={bestRatedCards} emptyText="No venues with enough ratings yet." />
            <DiscoverSection title="🌙 Tonight" items={tonightCards} emptyText="No events found for tonight." />
            <DiscoverSection title="📅 This Weekend" items={weekendCards} emptyText="No events found for this weekend." />
            <DiscoverSection title="🏆 Local Favorites" items={localFavoriteCards} emptyText="Not enough reviews yet to crown local favorites." />
          </>
        )}
      </div>
    </>
  );
}

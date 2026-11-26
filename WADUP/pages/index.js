import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  CATEGORY_CHIPS, CATEGORY_LABELS,
  isVenueEligible, getVenueBadges, effectiveRating, effectiveRatingCount, hasWadupRating,
  venueMatchesChip, venueCategories, isChain, formatTime, getEventIcon,
  localIsoDate, normalizeTimeStr, venueRatingTier
} from '../lib/data';
import { getLiveTrendingVenueIds, getBestRated, getScheduleTrendingVenues } from '../lib/rankings';
import { supabase } from '../lib/supabase';
import { getAdminRole } from '../lib/admin';
import AuthSidebar from '../components/AuthSidebar';
import AdminEditPanel from '../components/AdminEditPanel';
import MapCoverEditor from '../components/MapCoverEditor';
import { escapeHtml, renderEventPopup } from '../lib/event-popup';
import { EVENT_VENUES, matchEventVenue } from '../lib/event-venues';
import { mergeOfficialEventRows } from '../lib/reconcile-venue-performances';
import { preferredTicketRecord, suppressTicketDuplicates } from '../lib/ticket-quality';
import { matchPerformance } from '../lib/venue-schedule';



const GMAPS_KEY = process.env.NEXT_PUBLIC_GMAPS_KEY;
// Falls back to the real Impact affiliate ID (not a placeholder) so this
// works today even before NEXT_PUBLIC_TM_AFFILIATE_ID is set on Vercel.
const TM_AFFILIATE_ID = process.env.NEXT_PUBLIC_TM_AFFILIATE_ID || '7691820';

function restaurantFoodIcon(v) {
  // Only the primary category controls the map icon; a secondary bar tag
  // must never turn a restaurant into a beer / cocktail marker.
  const cats = venueCategories(v);
  if (!cats.includes('restaurant')) return null;
  if (v.custom_emoji) return v.custom_emoji;
  const subs = Array.isArray(v.subcategories) && v.subcategories.length ? v.subcategories : [v.subcategory].filter(Boolean);
  const food = subs.map(x => String(x).toLowerCase());
  const first = food.find(x => /burger|wings?|pizza|mexican|taco|steak|seafood|lobster|bbq|barbecue|sushi|japanese|italian|greek|breakfast|brunch/.test(x)) || '';
  const has = re => food.some(x => re.test(x));
  const name = String(v.name || '').toLowerCase();
  const wings = has(/wings?/);
  // Explicitly ordered first food choice is the primary food selection.
  if (/burger/.test(first)) return wings ? 'winged-burger' : '🍔';
  if (/pizza/.test(first)) return wings ? 'winged-pizza' : '🍕';
  if (/wings?/.test(first)) return '🍗';
  if (/mexican|taco|tex.mex/.test(first)) return '🌮';
  if (/steak/.test(first)) return '🥩';
  if (/seafood|lobster/.test(first)) return '🦞';
  if (/bbq|barbecue/.test(first)) return '🍖';
  if (/sushi|japanese|hibachi|asian|chinese|thai|korean|vietnamese/.test(first)) return '🥢';
  if (/italian|greek/.test(first)) return '🍝';
  if (/breakfast|brunch/.test(first)) return '🍳';
  if (has(/burger/)) return wings ? 'winged-burger' : '🍔';
  if (has(/pizza/)) return wings ? 'winged-pizza' : '🍕';
  if (wings) return '🍗';
  if (has(/mexican|taco|tex.mex/)) return '🌮';
  if (has(/steak/)) return '🥩';
  if (has(/seafood|lobster/)) return '🦞';
  if (has(/sushi|japanese|hibachi|asian|chinese|thai|korean|vietnamese/)) return '🥢';
  if (/blue moose/.test(name)) return wings ? 'winged-burger' : '🍔';
  if (/fuji|japanese|hibachi|sushi/.test(name)) return '🥢';
  if (/lobster|seafood|crab/.test(name)) return '🦞';
  if (/steakhouse|steak/.test(name)) return '🥩';
  if (/mexican|taco|taqueria/.test(name)) return '🌮';
  if (/pizza|pizzeria/.test(name)) return '🍕';
  if (/burger/.test(name)) return '🍔';
  return '🍽️';
}
function foodIconElement(icon) {
  const el = document.createElement('span');
  if (icon === 'winged-burger') {
    const img = document.createElement('img');
    img.src = '/icons/winged-burger.svg';
    img.alt = 'Winged burger';
    img.style.cssText = 'display:block;width:30px;height:26px;object-fit:contain;';
    el.appendChild(img);
  } else if (icon === 'winged-pizza') {
    el.textContent = '🪽🍕🪽';
  } else {
    el.textContent = icon || '';
  }
  el.style.cssText += 'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;line-height:1;';
  return el;
}
const CATEGORY_ICONS = { events: '🎵', nightlife: '🍸', restaurant: '🍔', sports: '🏟️', outdoors: '🌳', activities: '🎳' };
const ACTIVITY_ICONS = [
  [/bowling/i, '🎳'], [/pickleball/i, '🏓'], [/disc golf/i, '🥏'], [/golf/i, '⛳'],
  [/amusement park/i, '🎢'], [/trampoline/i, '🤸'], [/playground/i, '🛝'],
  [/creative classes/i, '🎨'], [/aquarium/i, '🐠'], [/zoo/i, '🦒'],
  [/climbing/i, '🧗'], [/kayak|canoe/i, '🛶'], [/paddleboard/i, '🏄'],
  [/skate park|skateboard/i, '🛹'], [/skating|ice rink|roller rink/i, '⛸️'],
  [/basketball/i, '🏀'], [/hockey/i, '🏒'], [/escape/i, '🔐'],
  [/axe throw/i, '🪓'], [/arcade|pinball/i, '🕹️'],
  [/kart|racing/i, '🏎️'], [/museum/i, '🏛️'],
];
function activityIcon(v) {
  const terms = [v.subcategory, ...(v.subcategories || [])].filter(Boolean).join(' ');
  return ACTIVITY_ICONS.find(([re]) => re.test(terms))?.[1] || '🎳';
}
function outdoorIcon(v) {
  const terms = [v.subcategory, ...(v.subcategories || [])].filter(Boolean).join(' ');
  if (/dog park/i.test(terms)) return '🌳🐕';
  if (/raft|rafting|whitewater/i.test(terms)) return '🚣';
  if (/kayak|canoe/i.test(terms)) return '🛶';
  if (/paddleboard/i.test(terms)) return '🏄';
  if (/climb/i.test(terms)) return '🧗';
  if (/bike|cycling/i.test(terms)) return '🚴';
  if (/hiking|trail/i.test(terms)) return '🥾';
  if (/outdoor shop/i.test(terms)) return '🎒';
  if (/campground/i.test(terms)) return '🏕️';
  if (/nature preserve/i.test(terms)) return '🌿';
  if (/outdoor attraction/i.test(terms)) return '🏞️';
  return '🌳';
}

// Event classification is based on the individual scheduled event, not merely
// the venue's category. Ticketmaster's segment/genre are more reliable than
// title guesses, with title-based specificity for the actual emoji.
function eventKind(ev) {
  const title = String(ev.name || ev.title || '').toLowerCase();
  const segment = String(ev.segment || '').toLowerCase();
  const genre = String(ev.genre || ev.subGenre || '').toLowerCase();
  const type = String(ev.event_type || '').toLowerCase();
  const all = [title, segment, genre, type].join(' ');
  if (/sport|football|basketball|baseball|softball|soccer|hockey|golf|tennis|wrestling|boxing|mma|ufc|nascar|racing|race|regatta|marathon|triathlon|ironman|volleyball|lacrosse|rodeo|motocross|pickleball/.test(all)) return 'Sports';
  if (/comedy|comedian|stand.up|improv/.test(all)) return 'Comedy';
  if (/theat|theater|theatre|broadway|musical|opera|ballet|dance performance|performing arts|play\b/.test(all)) return 'Theater';
  if (/festival|farmers.market|market|fair\b|expo|parade|food.truck|craft.show|art.show/.test(all)) return 'Festivals & Markets';
  if (/music|concert|live_music|dj|band|singer|karaoke|rock|country|hip.hop|jazz|blues|pop\b/.test(all)) return 'Music';
  if (ev.venueType === 'theater') return 'Theater';
  if (ev.venueType === 'music') return 'Music';
  return 'Festivals & Markets';
}
function specificEventEmoji(ev) {
  const title = String(ev.name || ev.title || '').toLowerCase();
  const all = [title, ev.segment, ev.genre, ev.subGenre, ev.event_type].filter(Boolean).join(' ').toLowerCase();
  // Prefer specific event titles/genres over generic source-provided icons.
  const icons = [
    [/basketball|nba\b|wnba\b/, '🏀'], [/football|nfl\b/, '🏈'],
    [/baseball|mlb\b|softball/, '⚾'], [/golf|pga\b|lpga\b/, '🏌️'],
    [/soccer|football club|mls\b/, '⚽'], [/hockey|nhl\b/, '🏒'],
    [/tennis/, '🎾'], [/volleyball/, '🏐'], [/boxing|mma|ufc|wrestling/, '🥊'],
    [/regatta|rowing|boat race/, '🚣'], [/ironman|triathlon/, '🏊'],
    [/marathon|5k\b|10k\b|half.marathon|running race/, '🏃'],
    [/nascar|motorsport|auto racing|grand prix|formula 1|indycar/, '🏎️'],
    [/rodeo/, '🤠'], [/pickleball/, '🏓'],
    [/farmers.market|farmers market/, '🥕'], [/food festival|food.truck/, '🍔'],
    [/art festival|art fair|craft fair/, '🎨'], [/holiday market|christmas market/, '🎄'],
    [/comedy|comedian|stand.up|improv/, '😂'], [/karaoke/, '🎤'],
    [/opera/, '🎼'], [/ballet/, '🩰'], [/theat|theater|theatre|broadway|musical|stage play/, '🎭'],
    // Consistent music pins: genre-specific microphones/instruments looked
    // like unrelated categories. Every Ticketmaster music event uses 🎵.
    [/jazz|rock concert|rock music|dj\b|electronic|edm|country music|country concert|hip.hop|rap concert|concert|live.music|live music|music|band|singer/, '🎵'],
    [/festival|fair\b|market|expo/, '🎪'],
  ];
  return icons.find(([re]) => re.test(all))?.[1] || ({ Sports:'🏆', Music:'🎵', Theater:'🎭', Comedy:'😂', 'Festivals & Markets':'🎪' }[eventKind(ev)] || '🎟️');
}
function matchesEventSubcategories(ev, selected) {
  return !selected?.length || selected.some(s => s.toLowerCase() === eventKind(ev).toLowerCase());
}

function tmMatchesSportFilter(ev, selected) {
  if (!selected?.length) return true;
  const details = [ev.genre, ev.subGenre, ev.name].filter(Boolean).join(' ').toLowerCase();
  return selected.some(s => s === 'Other Sports'
    ? !/football|baseball|basketball|soccer|hockey|golf|racing|nascar|formula|indycar|tennis/i.test(details)
    : (s === 'Racing' ? /racing|nascar|formula|indycar|grand prix/i.test(details)
      : details.includes(s.toLowerCase())));
}


// ── Day strip helpers ──
function buildDays() {
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const today = new Date();
  return Array.from({length:7}, (_,i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    return {
      label: days[d.getDay()],
      num: d.getDate(),
      // localIsoDate, not toISOString() — label/num above are already local,
      // so a UTC iso made each button's id disagree with the day it is
      // visibly labelled with, from 8pm local onward.
      iso: localIsoDate(d),
      isToday: i === 0,
    };
  });
}

// ── "🔥 Trending Now" / "🏆 Top 10" sidebar helpers ──
// A venue's pin/card icon always reflects its *primary* (first) category —
// see venueCategories() in lib/data.js for the categories[]-with-category
// fallback this reads from.
function venueEmoji(v) {
  const primary = venueCategories(v)[0];
  return venueCategories(v).includes('restaurant') ? restaurantFoodIcon(v) : v.custom_emoji || (primary === 'activities' ? activityIcon(v) : primary === 'outdoors' ? outdoorIcon(v) : CATEGORY_ICONS[primary]) || '📍';
}

// ── Two-tier pin system ── the rating used to ORDER pins/sidebar items falls
// back — first to an admin-set admin_rating, then to Google's rating — only
// so a freshly-synced, highly-rated venue (or one an admin has manually
// vetted before it has real reviews) doesn't sort behind a middling one just
// for lacking WadUp reviews yet. Never used for DISPLAY — none of these
// three are on the same 0-10 scale as each other (weighted_rating and
// admin_rating are; google_rating is out of 5), so only the real
// weighted_rating is ever shown on a pin/card, and only once it's nonzero.
function areaRatingOf(v) {
  return venueRatingTier(v)?.value || 0;
}

// A venue's _areaRank is scoped to the current map viewport (see
// updateAreaRanks) — undefined/null (never computed, e.g. currently outside
// the viewport) falls through to 'discovery' same as any rank beyond 10.
function getVenueTier(areaRank) {
  return areaRank != null && areaRank <= 10 ? 'top10' : 'discovery';
}

function getRankStyle(rank) {
  if (rank === 1) return { bg: '#FFD700', color: '#000', shadow: '0 2px 14px rgba(255,215,0,0.65)', prefix: '👑 #1' };
  if (rank === 2) return { bg: '#C0C0C0', color: '#000', shadow: '0 2px 14px rgba(192,192,192,0.6)', prefix: '🥈 #2' };
  if (rank === 3) return { bg: '#CD7F32', color: '#fff', shadow: '0 2px 14px rgba(205,127,50,0.6)', prefix: '🥉 #3' };
  return { bg: '#fff', color: '#171717', shadow: '0 2px 8px rgba(0,0,0,0.18)', prefix: `#${rank}` };
}

const EVENT_TYPE_ICON  = { live_music: '🎵', trivia: '🧠', happy_hour: '⏰', specials: '🏷️', activities: '🎳', sports_game: '🏟️', event: '🎫', dj: '🎧', comedy: '🎤', karaoke: '🎙️', other: '🎉' };
const EVENT_TYPE_LABEL = { live_music: 'Live Music', trivia: 'Trivia', happy_hour: 'Happy Hour', specials: 'Specials', activities: 'Activities', sports_game: 'Game', event: 'Event', dj: 'DJ', comedy: 'Comedy', karaoke: 'Karaoke', other: 'Event' };

function timeToMinsLocal(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function trendingReasonBadge(v) {
  const s = v._scheduleEntry;
  if (!s) return null;
  const icon  = EVENT_TYPE_ICON[s.event_type] || '🔥';
  const label = EVENT_TYPE_LABEL[s.event_type] || 'Event';
  const now = new Date();
  const diff = timeToMinsLocal(s.start_time) - (now.getHours() * 60 + now.getMinutes());
  if (diff <= 0) return `${icon} ${label} — happening now`;
  if (diff <= 5) return `${icon} ${label} starting soon`;
  return `${icon} ${label} in ${diff}min`;
}

export default function WadUp() {
  const mapRef       = useRef(null);
  const mapObj       = useRef(null);
  const userLocationMarkerRef = useRef(null);
  const userAccuracyCircleRef = useRef(null);
  const userLocationRef = useRef(null);
  const locationWatchRef = useRef(null);
  const updateUserLocationMarker = (location, targetMap = mapObj.current) => {
    if (!targetMap || !window.google?.maps || !location) return;
    const position = { lat: location.lat, lng: location.lng };
    if (!userLocationMarkerRef.current) {
      userLocationMarkerRef.current = new window.google.maps.Marker({
        position, map: targetMap,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 9, fillColor: '#4285F4', fillOpacity: 1,
          strokeColor: '#fff', strokeWeight: 2,
        },
        zIndex: 999,
        title: 'Your approximate location',
      });
    } else {
      userLocationMarkerRef.current.setPosition(position);
      userLocationMarkerRef.current.setMap(targetMap);
    }
    if (!userAccuracyCircleRef.current) {
      userAccuracyCircleRef.current = new window.google.maps.Circle({
        map: targetMap, center: position, radius: location.accuracy || 0,
        strokeColor: '#4285F4', strokeOpacity: 0.5, strokeWeight: 1,
        fillColor: '#4285F4', fillOpacity: 0.08,
        clickable: false,
      });
    } else {
      userAccuracyCircleRef.current.setCenter(position);
      userAccuracyCircleRef.current.setRadius(location.accuracy || 0);
      userAccuracyCircleRef.current.setMap(targetMap);
    }
  };
  const infoWindow   = useRef(null);
  const mapMarkers   = useRef({});
  const tmMarkers    = useRef({});
  const overlays     = useRef({});
  const tmEventsRef  = useRef([]);
  const tmCacheRef = useRef(null);
  const tmRequestRef = useRef(0);
  const venuesRef    = useRef([]);
  const trendingVenueIds = useRef(new Set());
  const bestRatedVenueIds = useRef(new Set());
  const eventVenueIdsTodayRef = useRef(new Set());
  // Raw venue_events rows (today forward — see fetchVenueEvents), one entry
  // per scheduled event regardless of which day it falls on. The Events chip
  // filters/ranks against this client-side by whichever day is selected in
  // the day-strip (activeDateRef), the same "load once, filter per day"
  // pattern fetchTM already uses for tm_events_cache below.
  const venueEventsRef = useRef([]);
  const mapInitStarted = useRef(false);
  const filterPinsRef = useRef(null);
  // updateAreaRanks (defined earlier in this component than dropVenuePin)
  // needs to call the CURRENT dropVenuePin — going through a ref instead of
  // closing over the identifier directly avoids the temporal-dead-zone
  // ReferenceError this exact cross-callback-reference pattern hit earlier
  // this session (see the dropVenuePin/openEditPanel fix).
  const dropVenuePinRef = useRef(null);
  const dropBarPinRef = useRef(null);
  const dropTMPinRef = useRef(null);
  const updateAreaRanksRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const searchInputRef = useRef(null);

  // Every live pin, keyed by id — click handlers look themselves up here to
  // call their own openPopup.
  const pinRegistry   = useRef(new Map());  // id -> { id, type, marker, overlay, el, lat, lng, openPopup }

  const [userPos,        setUserPos]        = useState({lat:35.0456, lng:-85.3096});
  const [activeChip,     setActiveChip]     = useState('wadup');
  const [hasMustSeeInView, setHasMustSeeInView] = useState(false);
  const [activeDate,     setActiveDate]     = useState(localIsoDate());
  // filterPins reads these refs, not the state above, so it always sees the
  // current value regardless of when its own closure was created — the
  // state setters below update the ref SYNCHRONOUSLY, in the same click
  // handler, rather than waiting a render cycle for a useEffect to catch up.
  const activeCategoryRef = useRef('wadup');
  const activeDateRef = useRef(localIsoDate());
  // Desktop sidebar's category dropdown — see onCategoryClick/onSubcategoryClick
  // and renderDesktopCategoryList. Same synchronous-ref pattern as
  // activeCategoryRef: filterPins always reads the ref, never the state.
  const [activeSubcategory, setActiveSubcategory] = useState([]);
  const activeSubcategoryRef = useRef({});
  const [subcategoryByChip, setSubcategoryByChip] = useState({});
  const matchesSelectedVenue = (venue, date) => {
    const chip = activeCategoryRef.current;
    return chip === 'wadup'
      ? venueEventsRef.current.some(e => e.venue_id === venue.id && (e.start_time || '').slice(0, 10) === date && !isReplacedLegacyEvent(e) && !['happy_hour', 'specials'].includes(e.event_type) && (date !== localIsoDate() || !e.end_time || new Date(e.end_time.replace(' ', 'T')).getTime() >= Date.now()))
      : venueMatchesChip(chip, venue, chip === 'events' ? [] : (activeSubcategoryRef.current[chip] || [])) &&
        (chip !== 'events' || (() => { const event = getVenueEventForDay(venue.id, date); return !!event && matchesEventSubcategories({ ...event, name: event.name || event.title || venue.name }, activeSubcategoryRef.current.events || []); })());
  };
  const matchesSelectedTM = (ev, date) => {
    const chip = activeCategoryRef.current;
    return (chip === 'wadup' || (chip === 'events' && matchesEventSubcategories(ev, activeSubcategoryRef.current.events || []))) &&
      (ev.showings || [ev]).some(show => isTMEventVisibleForDay(show, date));
  };
  const [feedRevision, setFeedRevision] = useState(0);
  const [feedNow, setFeedNow] = useState(() => Date.now());
  const [openDropdown, setOpenDropdown] = useState(null);
  const subcategoryByChipRef = useRef({});
  const openDropdownRef = useRef(null);
  useEffect(() => { subcategoryByChipRef.current = subcategoryByChip; }, [subcategoryByChip]);
  useEffect(() => { openDropdownRef.current = openDropdown; }, [openDropdown]); // which category's subcategory list is expanded
  const [trendingNow,    setTrendingNow]    = useState([]);
  const [topRanked,      setTopRanked]      = useState([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [mapReady,       setMapReady]       = useState(false);
  const [mapLoadError, setMapLoadError] = useState('');
  const [showSplash,     setShowSplash]     = useState(true);
  // A venue-profile return must never show the welcome screen again.
  useEffect(() => {
    try { if (window.sessionStorage.getItem('wadup_map_state')) setShowSplash(false); } catch (e) { /* storage unavailable */ }
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wadupFeedExpanded, setWadupFeedExpanded] = useState(true);
  const [zoomClass,      setZoomClass]      = useState('zoom-near');
  const [showAddBanner,  setShowAddBanner]  = useState(false);
  const [sheetExpanded,  setSheetExpanded]  = useState(false);
  const [installPlatform, setInstallPlatform] = useState('other'); // 'ios' | 'android' | 'other'
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [session,         setSession]         = useState(null);
  const [profile,         setProfile]         = useState(null);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  // ── Admin map controls ──
  // adminRoleRef exists because the venue-pin popup HTML is a plain string
  // built inside dropVenuePin (a memoized callback), not JSX — it needs the
  // CURRENT admin status at popup-build time, not whatever `adminRole` value
  // was closed over when dropVenuePin was last recreated.
  const [adminRole,      setAdminRole]      = useState(null);
  const adminRoleRef = useRef(null);
  useEffect(() => { adminRoleRef.current = adminRole; }, [adminRole]);
  // The slide-in AdminEditPanel — opened via the "✏️ Edit Venue" button
  // inside a venue's popup (see dropVenuePin's iwHtml + window.__wadupEditVenue
  // below), never via a separate mode toggle or right-click menu.
  const [editPanelVenue, setEditPanelVenue] = useState(null);
  const [mapPhotoVenue,setMapPhotoVenue] = useState(null);
  const sessionRef = useRef(null);
  useEffect(()=>{sessionRef.current=session},[session]);
  const [relocating,     setRelocating]     = useState(false);
  const [relocateTarget, setRelocateTarget] = useState(null); // { lat, lng } | null
  const [mapActionError,   setMapActionError]   = useState('');
  const [mapActionSuccess, setMapActionSuccess] = useState('');

  // ── Search overlay ──
  const [searchOpen,         setSearchOpen]         = useState(false);
  const [searchQuery,        setSearchQuery]        = useState('');
  const [searchResults,      setSearchResults]      = useState({ places: [], events: [], categories: [] });
  const [activeResultIndex,  setActiveResultIndex]  = useState(0);

  const sheetTouchStartY = useRef(null);
  const sheetTouchDeltaY = useRef(0);
  const deferredInstallPrompt = useRef(null);

  const days = buildDays();

  // ── Auto-sync Chattanooga venues from Google Places — fire-and-forget;
  // the route itself checks venues.last_google_sync and only actually
  // triggers a sync if it's been 7+ days, so this is nearly always a no-op
  // network call on page load. ──
  useEffect(() => {
    fetch('/api/places/auto-sync').catch(() => {});
  }, []);

  // ── Add-to-home-screen banner (mobile, not already installed, not dismissed) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let dismissed = false;
    try { dismissed = window.localStorage.getItem('wadup_hide_add_banner') === '1'; }
    catch (e) { dismissed = false; }

    let iosStandalone = false;
    try { iosStandalone = window.navigator.standalone === true; }
    catch (e) { iosStandalone = false; }

    let displayModeStandalone = false;
    try { displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches; }
    catch (e) { displayModeStandalone = false; }

    // Equivalent to: window.navigator.standalone !== true && !window.matchMedia('(display-mode: standalone)').matches
    const shouldShow = !dismissed && !iosStandalone && !displayModeStandalone;
    setShowAddBanner(shouldShow);
  }, []);

  const dismissAddBanner = useCallback(() => {
    setShowAddBanner(false);
    try { window.localStorage.setItem('wadup_hide_add_banner', '1'); } catch (e) { /* localStorage unavailable */ }
  }, []);

  // ── Detect iOS vs Android so tapping the banner can show the right instructions ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = window.navigator.userAgent || '';
    const isIOS     = /iPad|iPhone|iPod/.test(ua)
      || (ua.includes('Macintosh') && (window.navigator.maxTouchPoints || 0) > 1);
    const isAndroid = /Android/.test(ua);
    setInstallPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'other');
  }, []);

  // ── Auth session — persisted across reloads via Supabase ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ── Fetch the profile row whenever the logged-in user changes ──
  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('id, username, city, account_type')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (!cancelled && !error) setProfile(data);
      });
    return () => { cancelled = true; };
  }, [session]);

  // ── Admin role — gates the "✏️ Edit Venue" button inside a venue's popup ──
  useEffect(() => {
    if (!session?.user) { setAdminRole(null); return; }
    let cancelled = false;
    getAdminRole(supabase, session.user.id).then(role => { if (!cancelled) setAdminRole(role); });
    return () => { cancelled = true; };
  }, [session]);

  // ── Capture Chrome's native "Add to Home Screen" prompt for later use ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      deferredInstallPrompt.current = e;
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  // ── Banner tap: trigger native Chrome install prompt, or show instructions ──
  const onAddBannerTap = useCallback(async () => {
    if (installPlatform === 'android' && deferredInstallPrompt.current) {
      const promptEvent = deferredInstallPrompt.current;
      deferredInstallPrompt.current = null;
      try {
        promptEvent.prompt();
        await promptEvent.userChoice;
      } catch (e) { /* user dismissed or prompt unavailable */ }
      return;
    }
    setShowInstallModal(true);
  }, [installPlatform]);

  // ── Swipeable trending sheet ──
  const onSheetTouchStart = useCallback((e) => {
    sheetTouchStartY.current = e.touches[0].clientY;
    sheetTouchDeltaY.current = 0;
  }, []);
  const onSheetTouchMove = useCallback((e) => {
    if (sheetTouchStartY.current == null) return;
    sheetTouchDeltaY.current = e.touches[0].clientY - sheetTouchStartY.current;
  }, []);
  const onSheetTouchEnd = useCallback(() => {
    if (sheetTouchStartY.current == null) return;
    const delta = sheetTouchDeltaY.current;
    if (delta < -30) setSheetExpanded(true);
    else if (delta > 30) setSheetExpanded(false);
    sheetTouchStartY.current = null;
    sheetTouchDeltaY.current = 0;
  }, []);

  // ── 🔥 Trending Now / 🏆 Top 10 sidebar lists — city-scoped, filtered by
  // the active chip only (not the day strip or Tonight/Weekend, which only
  // affect TM event pins). Independent of the map/viewport entirely, unlike
  // the old viewport-scoped trending list this replaces. ──
  const loadSidebarLists = useCallback(async (chip, subcategory) => {
    setSidebarLoading(true);
    try {
      const nowList = await getScheduleTrendingVenues(supabase, chip, 'Chattanooga', subcategory);
      setTrendingNow(nowList);
    } catch (e) {
      /* sidebar lists are a nice-to-have — leave whatever was showing */
    }
    setSidebarLoading(false);
  }, []);

  useEffect(() => { loadSidebarLists(activeChip, activeSubcategory.length === 1 ? activeSubcategory[0] : null); }, [activeChip, activeSubcategory, loadSidebarLists]);

  // ── Filter map pins — flags drive direct marker/overlay visibility ──
  // Reads activeCategoryRef/activeDateRef (never the activeChip/activeDate
  // state directly) so every caller — a click handler, or an async callback
  // running long after the render that created it — always sees the current
  // filter, not whatever was current when this particular closure was made.
  const filterPins = useCallback(() => {
    const map = mapObj.current;
    if (!map) return;

    const chip = activeCategoryRef.current;
    const date = activeDateRef.current;
    Object.entries(mapMarkers.current).forEach(([id, entry]) => {
      const venue = venuesRef.current.find(v => v.id === id);
      if (!venue) return;
      // Events chip needs the same "category tag alone isn't enough, it
      // needs a real venue_events row for the selected day" rule
      // updateAreaRanks already applies (see getVenueEventForDay) — without
      // this, a venue tagged 'events' but with nothing on today (e.g.
      // Barrelhouse Ballroom on a night with no show) stayed visible here
      // if its pin already existed from viewing a different chip, since
      // this loop only ever HIDES pins, and updateAreaRanks only ever
      // RE-DROPS ones that pass its own (correct) eligibility check —
      // nothing reconciled the two for a pin this loop was leaving shown.
      const show = matchesSelectedVenue(venue, date || todayIsoStr());
      entry.marker.setMap(show ? map : null);
      // Venue pins track their overlay in the separate `overlays` ref, not on
      // this mapMarkers entry (unlike TM pins below, whose entry bundles
      // both) — reading `entry.overlay` here would silently no-op every
      // time, since it's always undefined for a venue, leaving the actually
      // -visible custom pin overlay never hidden regardless of the filter.
      const overlay = overlays.current[id];
      if (overlay) overlay.setMap(show ? map : null);
    });

    Object.entries(tmMarkers.current).forEach(([id, entry]) => {
      const ev = entry.event;
      if (!ev) return;
      const show = matchesSelectedTM(ev, date || todayIsoStr());
      entry.marker.setMap(show ? map : null);
      if (entry.overlay) entry.overlay.setMap(show ? map : null);
    });

    updateAreaRanks();
  }, []);

  useEffect(() => { filterPinsRef.current = filterPins; }, [filterPins]);

  // Events chip has no other trigger to notice "a live event just ended" or
  // "a TM show's ~3hr window just closed" — nothing re-runs updateAreaRanks
  // on its own just because the clock moved. A 5-minute poll is cheap (it's
  // the same re-filter a pan/zoom already triggers) and keeps live pins from
  // sitting there minutes/hours after the thing they're advertising is over.
  useEffect(() => {
    const id = setInterval(() => {
      if (activeCategoryRef.current === 'events' || activeCategoryRef.current === 'wadup') { filterPinsRef.current?.(); setFeedNow(Date.now()); }
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Ranks ONLY the venues currently visible in the map viewport by
  // areaRatingOf (weighted_rating, falling back to google_rating) — the top
  // 10 of what's on screen get the Olympic-styled pill, everything else
  // in view becomes a Tier 2 discovery dot, and anything outside the
  // viewport is hidden entirely. This is fully viewport-relative on purpose:
  // panning/zooming into a single neighborhood re-ranks against just that
  // neighborhood (so a genuinely great local spot isn't buried under
  // city-wide competition), and zooming back out re-ranks city-wide. A direct
  // consequence: a sparse viewport with fewer than 11 chip-matching venues
  // will show zero discovery dots — that's correct, not a bug, since there's
  // no "#11" to demote when only a handful of venues are on screen at all.
  const updateAreaRanks = useCallback(() => {
    const map = mapObj.current;
    if (!map) return;
    const bounds = map.getBounds();
    // Hide Must-See outside areas with an actual eligible attraction.
    const mustSeeVisible = !!bounds && venuesRef.current.some(v =>
      v.live && !v.is_hidden && venueMatchesChip('must-see', v) &&
      Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lng)) &&
      bounds.contains(new window.google.maps.LatLng(Number(v.lat), Number(v.lng)))
    );
    setHasMustSeeInView(prev => prev === mustSeeVisible ? prev : mustSeeVisible);
    const chip = activeCategoryRef.current;
    const selected = [chip];

    const dayIso = activeDateRef.current || todayIsoStr();

    // Events chip: category match alone isn't enough — a venue tagged
    // 'events' only actually shows once it has a real venue_events row for
    // whichever day is selected (see getVenueEventForDay). Every other chip
    // keeps the plain category match it always had.
    const eligible = venuesRef.current.filter(v =>
      v.live && !v.is_hidden && isVenueEligible(v) && matchesSelectedVenue(v, dayIso)
    );
    const inViewport = eligible.filter(v =>
      v.lat != null && v.lng != null && bounds && bounds.contains(new window.google.maps.LatLng(v.lat, v.lng))
    );
    const viewportIds = new Set(inViewport.map(venue => venue.id));
    const outsideViewport = eligible.filter(venue => !viewportIds.has(venue.id));

    // Events chip ranks live-right-now venues first, then the rest by the
    // admin's manual event_rank order (see pages/admin/venues.js's Event
    // Rankings tab) — a currently-empty rating isn't a meaningful signal for
    // "which event is worth seeing right now." Every other chip keeps the
    // existing rating-based sort.
    let ranked;
    if (selected.length === 1 && (selected[0] === 'events' || selected[0] === 'wadup')) {
      const withEvent = inViewport.map(v => {
        const todayEvent = getVenueEventForDay(v.id, dayIso);
        return { ...v, _todayEvent: todayEvent, _isLive: isEventLive(todayEvent) };
      });
      const live = withEvent.filter(v => v._isLive);
      const upcoming = withEvent.filter(v => !v._isLive)
        .sort((a, b) => selected[0] === 'wadup' ? String(a._todayEvent?.start_time || '').localeCompare(String(b._todayEvent?.start_time || '')) : (a.event_rank ?? 999) - (b.event_rank ?? 999));
      ranked = [...live, ...upcoming].map((v, i) => ({ ...v, _areaRank: i + 1 }));
    } else {
      ranked = inViewport
        .slice()
        .sort((a, b) => areaRatingOf(b) - areaRatingOf(a))
        .map((v, i) => ({ ...v, _areaRank: i + 1 }));
    }

    // Venues that scrolled out of the viewport since the last pass are hidden
    // outright (not redropped as discovery dots) — they'll get a fresh pin
    // with a fresh rank the moment they're back in view.
    outsideViewport.forEach(v => {
      const entry = mapMarkers.current[v.id];
      // Google InfoWindow auto-pans for edge pins. Never hide the selected
      // marker while that automatic movement changes viewport bounds.
      if (map.__wadupSelectedVenueId === v.id) return;
      if (entry) entry.marker.setMap(null);
      if (overlays.current[v.id]) overlays.current[v.id].setMap(null);
    });

    ranked.forEach(v => {
      // Recreating the anchor marker closes its Google InfoWindow, especially
      // after the InfoWindow itself pans the map. Keep that marker intact.
      if (map.__wadupSelectedVenueId === v.id && pinRegistry.current.has(v.id)) return;
      dropPinForVenue(v, chip === 'wadup' ? null : v._areaRank);
    });

    // Keep every eligible restaurant visible as a tiny discovery dot at wide zooms.
    // Never suppress venues based on screen-space spacing or a per-zoom cap.
    // The top-10 ranked pills and true venue coordinates are unchanged.

    // Ticketmaster events have no WadUp rating to sort against, so rather
    // than fabricate a score to interleave them with rated venues, they're
    // appended after (live-first, then soonest start — see isTMEventLiveNow)
    // and only ever considered for the Events/Sports chips — same cat===chip
    // gate filterPins uses for TM pins, plus the same day+3hr-showable window
    // (isTMEventVisibleForDay) filterPins applies to actual pin visibility.
    const visibleEvents = bounds && (chip === 'events' || chip === 'wadup') ? tmEventsRef.current.filter(event =>
      matchesSelectedTM(event, dayIso) && bounds.contains(new window.google.maps.LatLng(event.lat, event.lng))) : [];
    const visibleEventIds = new Set(visibleEvents.map(event => event.id));
    for (const [id, mounted] of Object.entries(tmMarkers.current)) {
      if (visibleEventIds.has(id) || (map.__wadupSelectedVenueId === id && matchesSelectedTM(mounted.event, dayIso))) continue;
      mounted.marker.setMap(null);
      mounted.overlay?.setMap(null);
      delete tmMarkers.current[id];
      pinRegistry.current.delete(id);
    }
    for (const event of visibleEvents) {
      if (!tmMarkers.current[event.id]) dropTMPinRef.current?.(event);
    }
    const tmInBounds = visibleEvents
          .map(event => {
            const shows = event.showings.filter(show => isTMEventVisibleForDay(show, dayIso));
            const showing = shows.find(isTMEventLiveNow) || shows[0];
            return { ...event, dateStr: showing.dateStr, timeStr: showing.timeStr };
          })
          .sort((a, b) => {
            const aLive = isTMEventLiveNow(a), bLive = isTMEventLiveNow(b);
            if (aLive !== bLive) return aLive ? -1 : 1;
            return (a.timeStr || '').localeCompare(b.timeStr || '');
          })
          .map(ev => ({ ...ev, _type: 'tm' }));

    let combined;
    if (selected.length === 1 && selected[0] === 'events') {
      // Tier order: everything live right now (venues + TM mixed), then
      // upcoming venues (event_rank order), then upcoming TM (by start time)
      // — matches the ranked/tmInBounds tiers built above.
      const liveVenues = ranked.filter(v => v._isLive).map(v => ({ ...v, _type: 'venue' }));
      const upcomingVenues = ranked.filter(v => !v._isLive).map(v => ({ ...v, _type: 'venue' }));
      const liveTM = tmInBounds.filter(isTMEventLiveNow);
      const upcomingTM = tmInBounds.filter(ev => !isTMEventLiveNow(ev));
      combined = [...liveVenues, ...liveTM, ...upcomingVenues, ...upcomingTM]
        .map((item, i) => ({ ...item, _areaRank: i + 1 }));
    } else {
      combined = [...ranked.map(v => ({ ...v, _type: 'venue' })), ...tmInBounds]
        .map((item, i) => ({ ...item, _areaRank: i + 1 }));
    }
    // The WADUP opening view has no ranking; legacy ranking state is only used by other features.
    if (chip !== 'wadup') {
      const seen = new Set();
      setTopRanked(combined.filter(item => { const key = item._type + ':' + item.id; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 10));
    }
  }, []);

  useEffect(() => { updateAreaRanksRef.current = updateAreaRanks; }, [updateAreaRanks]);

  // Stagger *labels* in screen pixels while keeping every marker and pin tail
  // anchored to the venue's actual saved latitude/longitude.
  // Each map owns its own label layout; nothing is written to the database.
  function layoutMapLabels(map) {
    const registry = map.__wadupLabelOverlays;
    if (!registry) return;
    // Ticketmaster events frequently share an exact venue coordinate. Spread
    // their WHOLE pins (name + pointer + emoji) in screen pixels, never just
    // the label, so each event remains individually visible and clickable.
    // Their invisible Google marker stays at the true venue for the popup.
    const tmPins = [...pinRegistry.current.values()]
      .filter(e => e.type === 'tm' && e.overlay?.getMap?.() === map && e.el?.isConnected)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    // At regional zoom, keep the true map positions. At neighborhood zoom,
    // avoid overlapping screen bounds, including different nearby venues.
    const zoom = map.getZoom() || 0;
    for (const entry of tmPins) entry.el.style.translate = 'none';
    if (zoom >= 17) {
      const day = activeDateRef.current || todayIsoStr();
      const firstTime = entry => (entry.event.showings || [entry.event])
        .filter(show => show.dateStr === day && show.timeStr)
        .map(show => show.timeStr).sort()[0] || '99:99';
      const offsets = [[0, 0]];
      for (let ring = 1; ring <= 7; ring++) {
        const count = Math.max(8, ring * 10);
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
          offsets.push([Math.round(Math.cos(angle) * ring * 86), Math.round(Math.sin(angle) * ring * 64)]);
        }
      }
      const ordered = tmPins.map(entry => ({entry, time:firstTime(entry)}))
        .sort((a,b) => b.time.localeCompare(a.time) || String(b.entry.id).localeCompare(String(a.entry.id)));
      const measurements = ordered.map(({entry}) => ({el:entry.el, rect:entry.el.getBoundingClientRect()}));
      const placed = [];
      for (const {el,rect} of measurements) {
        if (!rect.width || !rect.height) continue;
        let best = Infinity;
        let chosen;
        for (const [dx,dy] of offsets) {
          const bounds = {left:rect.left+dx-5,right:rect.right+dx+5,top:rect.top+dy-5,bottom:rect.bottom+dy+5};
          let overlap = 0;
          for (const previous of placed) {
            overlap += Math.max(0, Math.min(bounds.right,previous.right)-Math.max(bounds.left,previous.left))
              * Math.max(0, Math.min(bounds.bottom,previous.bottom)-Math.max(bounds.top,previous.top));
          }
          const score = overlap * 10000 + Math.hypot(dx,dy);
          if (score < best) {
            best = score;
            chosen = {dx,dy,...bounds};
          }
          if (overlap === 0) break;
        }
        placed.push(chosen);
        el.style.translate = `${chosen.dx}px ${chosen.dy}px`;
      }
    }
    // At very close zoom, spread overlapping ranked restaurant emoji+label pairs together.
    const rankedPairs = [...(pinRegistry.current?.values() || [])].filter(e => e.overlay?.__attachedEmojiShell && e.overlay?.getMap?.() === map);
    const closeZoom = (map.getZoom() || 0) >= 19;
    const placed = [];
    for (const entry of rankedPairs.sort((a,b)=>(a.rank||99)-(b.rank||99))) {
      const proj = entry.overlay.getProjection?.();
      const point = proj?.fromLatLngToDivPixel(new window.google.maps.LatLng(entry.lat,entry.lng));
      if (!point) continue;
      let dx=0,dy=0;
      if (closeZoom) {
        const offsets=[[0,0],[-32,0],[32,0],[0,-34],[0,34],[-32,-34],[32,-34],[-32,34],[32,34],[-64,0],[64,0]];
        const choice = offsets.find(([x,y])=>placed.every(p=>Math.hypot(point.x+x-p.x,point.y+y-p.y)>=38)) || offsets[offsets.length-1];
        [dx,dy]=choice;
      }
      placed.push({x:point.x+dx,y:point.y+dy});
      entry.el.style.translate = `${dx}px ${dy}px`;
    }
    // Ranked restaurant labels stay anchored above their exact emoji positions.
    // Never collision-shift the bubble without its pointer.
    for (const o of registry) if (o.__fixedEmojiLabel && o.__labelEl) o.__labelEl.style.translate = 'none';
    // Keep labels at their natural positions at city/regional zoom.
    // Only spread overlapping labels when zoomed into neighborhood/street level.
    if ((map.getZoom() || 0) < 17) {
      for (const o of registry) if (o.__labelEl) o.__labelEl.style.translate = 'none';
      return;
    }
    const items = [...registry].filter(o => !o.__fixedEmojiLabel && !o.__tmEventPin && o.getMap() === map && o.__labelEl?.getClientRects().length)
      .sort((a,b) => (b.__labelPriority || 0) - (a.__labelPriority || 0) || String(a.__labelId).localeCompare(String(b.__labelId)));
    const occupied = [];
    const candidates = [0,-24,24,-48,48,-72,72,-96,96];
    for (const overlay of items) overlay.__labelEl.style.translate = 'none';
    const labels = items.map(({__labelEl: label}) => ({label, r: label.getBoundingClientRect()}));
    for (const {label, r} of labels) {
      if (!r.width || !r.height) continue;
      let best = { x:0, y:0, score:Infinity };
      for (const y of candidates) {
        for (const x of [0,-32,32,-64,64]) {
          const rect = {left:r.left+x-4,right:r.right+x+4,top:r.top+y-3,bottom:r.bottom+y+3};
          let overlaps = 0;
          for (const q of occupied) {
            const w = Math.max(0,Math.min(rect.right,q.right)-Math.max(rect.left,q.left));
            const h = Math.max(0,Math.min(rect.bottom,q.bottom)-Math.max(rect.top,q.top));
            overlaps += w*h;
          }
          const score = overlaps*100 + Math.abs(y)*2 + Math.abs(x)*3;
          if (score < best.score) best={x,y,score};
          if (overlaps === 0 && x === 0 && y === 0) break;
        }
        if (best.score === 0) break;
      }
      label.style.translate = best.x+'px '+best.y+'px';
      occupied.push({left:r.left+best.x-4,right:r.right+best.x+4,top:r.top+best.y-3,bottom:r.bottom+best.y+3});
    }
  }
  function queueMapLabelLayout(map) {
    if (map.__wadupMoving || map.__wadupLabelFrame) return;
    map.__wadupLabelFrame = requestAnimationFrame(() => {
      map.__wadupLabelFrame = null;
      if (!map.__wadupMoving) layoutMapLabels(map);
    });
  }

  // Overlay position is always the real venue coordinate. Only the name/pill
  // moves when nearby labels would otherwise overlap.
  function makeOverlay(pos, el, map, anchor = 'bottom') {
    const base = anchor === 'center' ? 'translate(-50%, -50%)' : anchor === 'top' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
    const overlay = new window.google.maps.OverlayView();
    overlay.__labelEl = el.querySelector('.wu-pill') || el.querySelector('.wu-discovery-label');
    overlay.__labelPriority = el.querySelector('.wu-pill') ? Number(el.style.zIndex || 0) : 0;
    overlay.__labelId = el.textContent || '';
    overlay.onAdd = function() {
      this.getPanes().overlayMouseTarget.appendChild(el);
      if (!map.__wadupLabelOverlays) map.__wadupLabelOverlays = new Set();
      map.__wadupLabelOverlays.add(this);
      queueMapLabelLayout(map);
    };
    overlay.draw = function() {
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(pos);
      if (!pt) return;
      el.style.position = 'absolute';
      el.style.left = pt.x + 'px';
      el.style.top = pt.y + 'px';
      el.style.transform = base;
      queueMapLabelLayout(map);
    };
    overlay.onRemove = function() {
      map.__wadupLabelOverlays?.delete(this);
      if (el.parentNode) el.parentNode.removeChild(el);
      queueMapLabelLayout(map);
    };
    overlay.setMap(map);
    return overlay;
  }

  // The emoji is the exact-position marker, independent of collision-managed name labels.
  function makeFixedVenueEmoji(pos, icon, map, onClick) {
    const shell = document.createElement('div');
    shell.style.cssText = 'position:absolute;z-index:900;cursor:pointer;pointer-events:auto;display:flex;align-items:center;justify-content:center;width:32px;height:32px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35));';
    const glyph = foodIconElement(icon);
    glyph.style.fontSize = '24px';
    shell.appendChild(glyph);
    shell.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    const fixed = new window.google.maps.OverlayView();
    fixed.onAdd = function () { this.getPanes().overlayMouseTarget.appendChild(shell); };
    fixed.draw = function () {
      const pt = this.getProjection()?.fromLatLngToDivPixel(pos);
      if (!pt) return;
      shell.style.left = pt.x + 'px';
      shell.style.top = pt.y + 'px';
      shell.style.transform = 'translate(-50%, -50%)';
    };
    fixed.onRemove = function () { shell.remove(); };
    fixed.__emojiShell = shell;
    fixed.setMap(map);
    return fixed;
  }

  // ── Nudge a new pin's position apart from any already-dropped pin sitting
  // at (or within ~20m of) the same spot, so pins never render exactly
  // stacked on top of each other. Checks BOTH venue/bar pins (mapMarkers)
  // and TM event pins (tmMarkers) — called fresh on every drop, so within a
  // dense cluster the first pin dropped keeps the real coordinate and later
  // ones fan out around it in ring order. ──
  // Always anchor venue and event pins to their stored geographic coordinates.
  // Never nudge them to avoid collisions: rank redraws and zoom changes must
  // not move a business to another building or street.
  function getOffsetPosition(lat, lng) {
    return { lat, lng };
  }

  // ── Events-chip day-scoped helpers ── all keyed against whichever day is
  // selected in the day-strip (activeDateRef), not hardcoded to "today" — a
  // venue/TM event still needs to actually be happening on that day to show,
  // but the day itself can be any date the strip offers.
  const todayIsoStr = () => localIsoDate();

  // A venue_events row is "live" once its start_time has passed and (if it
  // has one at all — most scraped rows never get an end_time, see
  // review-scraped-event.js) its end_time hasn't.
  function isEventLive(ev) {
    if (!ev?.start_time) return false;
    const now = new Date();
    const start = new Date(ev.start_time);
    const end = ev.end_time ? new Date(ev.end_time) : null;
    return now >= start && (!end || now <= end);
  }

  // The one venue_events row (if any) that makes this venue eligible for the
  // Events chip on `dayIso`. Only for TODAY does an event actually get
  // dropped once it's over (end_time in the past) — a past/future day being
  // browsed via the day-strip isn't evaluated against "right now" at all.
  // Prefers whichever entry is live right now; otherwise the day's earliest.
  function getVenueEventForDay(venueId, dayIso) {
    const rows = venueEventsRef.current.filter(
      e => e.venue_id === venueId && (e.start_time || '').slice(0, 10) === dayIso && !isReplacedLegacyEvent(e)
    );
    if (!rows.length) return null;
    if (dayIso !== todayIsoStr()) {
      return rows.slice().sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
    }
    const stillOn = rows.filter(e => !isEventOverToday(e));
    if (!stillOn.length) return null;
    return stillOn.find(isEventLive) || stillOn.slice().sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  }
  function isReplacedLegacyEvent(event) {
    if (event.source !== 'scraped' || !event.start_time) return false;
    const storedVenue = venuesRef.current.find(venue => venue.id === event.venue_id);
    const venue = EVENT_VENUES.find(item => item.legacyVenueId === event.venue_id) ||
      (storedVenue && matchEventVenue({ ...storedVenue, venue_name: storedVenue.name }));
    if (!venue) return false;
    return tmEventsRef.current.some(group => group.venueId === venue.id && group.showings.some(show =>
      show.isOfficial && matchPerformance(show, { venueId: venue.id, name: event.title,
        dateStr: event.start_time.slice(0, 10), timeStr: event.start_time.slice(11, 16) })));
  }
  function isEventOverToday(ev) {
    if (!ev.end_time) return false;
    return new Date(ev.end_time) < new Date();
  }

  // Ticketmaster events have no venue_events row to check — dateStr/timeStr
  // (normalized from tm_events_cache's date_str/time_str in fetchTM below) is
  // all there is, so "still showable" assumes a ~3hr show once it starts.
  const TM_ASSUMED_SHOW_LENGTH_MS = 3 * 60 * 60 * 1000;
  // ev.timeStr comes straight from tm_events_cache.time_str, which holds
  // Ticketmaster's localTime — "HH:MM:SS", not "HH:MM". Interpolating it raw
  // produced `2026-10-08T19:30:00:00` (two seconds fields), an invalid date
  // string, so this returned Invalid Date for every real TM row and both
  // isTMEventLiveNow and isTMEventVisibleForDay then compared against NaN,
  // which is always false. normalizeTimeStr trims it to "HH:MM" first.
  function tmEventStart(ev) {
    return new Date(`${ev.dateStr}T${normalizeTimeStr(ev.timeStr) || '20:00'}:00`);
  }
  function isTMEventLiveNow(ev) {
    if (!ev.dateStr || ev.dateStr !== todayIsoStr()) return false;
    const start = tmEventStart(ev);
    const end = new Date(start.getTime() + TM_ASSUMED_SHOW_LENGTH_MS);
    const now = new Date();
    return now >= start && now <= end;
  }
  // Visible on the selected day: matches that day, and — only when that day
  // is today — hasn't been over (start + ~3hrs) for more than the grace
  // window built into TM_ASSUMED_SHOW_LENGTH_MS.
  function isTMEventVisibleForDay(ev, dayIso) {
    if (ev.dateStr !== dayIso) return false;
    if (dayIso !== todayIsoStr()) return true;
    const end = new Date(tmEventStart(ev).getTime() + TM_ASSUMED_SHOW_LENGTH_MS);
    return new Date() <= end;
  }

  // Shared entry point for click on any pin — always opens that pin's own
  // popup directly, regardless of whatever else is nearby on screen.
  function handlePinInteraction(id) {
    const entry = pinRegistry.current.get(id);
    if (!entry) return;
    const map = mapObj.current;
    if (map) {
      map.__wadupCloseEventHover?.();
      // Selection belongs to the venue ID, not the transient overlay DOM node.
      const previous = map.__wadupSelectedPin;
      if (previous && previous !== entry.el) {
        previous.classList.remove('wu-pin-selected', 'wu-pin-front');
        previous.dispatchEvent(new Event('wadup-restack'));
      }
      map.__wadupSelectedVenueId = id;
      map.__wadupSelectedPin = entry.el;
      entry.el?.classList.add('wu-pin-selected', 'wu-pin-front');
      if (entry.el) entry.el.style.zIndex = '2147483000';
    }
    entry.openPopup();
  }

  // Bars/nightlife get their own pin treatment (dropBarPin, below) — flame
  // status + a compact beer-icon pin outside the top ranks — everything else
  // keeps the standard rank pill/discovery dot (dropVenuePin).
  function dropPinForVenue(v, areaRank) {
    const map = mapObj.current;
    const day = activeDateRef.current || todayIsoStr();
    const event = getVenueEventForDay(v.id, day);
    const { _areaRank, _todayEvent, _isLive, ...venue } = v;
    const signature = JSON.stringify([venue, Math.min(areaRank ?? 0, 11), activeCategoryRef.current, day, event,
      isEventLive(event), adminRoleRef.current, sessionRef.current?.user?.id, trendingVenueIds.current.has(v.id),
      bestRatedVenueIds.current.has(v.id), eventVenueIdsTodayRef.current.has(v.id), map?.getZoom()]);
    const previous = pinRegistry.current.get(v.id);
    if (previous?.renderSignature === signature && previous.overlay?.getMap() === map) return;
    if (venueCategories(v).includes('nightlife') && !venueCategories(v).includes('restaurant')) {
      dropBarPinRef.current?.(v, areaRank);
    } else {
      dropVenuePinRef.current?.(v, areaRank);
    }
    const created = pinRegistry.current.get(v.id);
    if (created) created.renderSignature = signature;
  }

  // Smooth, zoom-aware discovery markers: small at regional scale, gradually
  // increasing in size without the abrupt 5px-to-14px jump at zoom 14.
  const discoveryDotSize = zoom => Math.max(4, Math.min(13, 5 + (zoom - 9) * 0.85));

  // ── Drop a venue pin ── `areaRank` (1-based, scoped to the current
  // viewport — see updateAreaRanks) decides which of the two tiers this pin
  // renders as: rank 1-10 gets an Olympic-styled Top 10 pill, anything else
  // (including "not currently ranked at all", e.g. undefined during a
  // relocate-preview drop) becomes a Tier 2 discovery dot.
  const dropVenuePin = useCallback((v, areaRank) => {
    const map = mapObj.current;
    if (!map || !v.lng || !v.lat) return;

    // Remove old
    if (mapMarkers.current[v.id]) {
      mapMarkers.current[v.id].marker.setMap(null);
      if (overlays.current[v.id]) overlays.current[v.id].setMap(null);
    }
    if (pinRegistry.current.has(v.id)) {
      pinRegistry.current.delete(v.id);
    }
    if (!v.live) return;

    const badges = getVenueBadges(
      v, trendingVenueIds.current.has(v.id), bestRatedVenueIds.current.has(v.id),
      eventVenueIdsTodayRef.current.has(v.id)
    );
    const topBadge = badges[0];

    // Events chip: the pin's top-left badge slot and popup swap to the
    // event-specific treatment (animated live note, or the event-type icon)
    // instead of the generic badge system above — see getEventIcon/
    // isEventLive and the .wu-live-music-note/.wu-event-badge CSS.
    const eventsChipActive = activeCategoryRef.current === 'events';
    const dayIsoForPin = activeDateRef.current || todayIsoStr();
    const todayEvent = eventsChipActive ? getVenueEventForDay(v.id, dayIsoForPin) : null;
    const isLiveEvent = isEventLive(todayEvent);

    const rating = effectiveRating(v);
    const ratingCount = effectiveRatingCount(v);
    const hasRating = rating != null && (ratingCount || 0) > 0;
    // The rank badge's own rating line uses the NEW weighted (1-10) system,
    // not the legacy average/google pair above — see areaRatingOf's comment.
    const areaRating = v.weighted_rating > 0 ? v.weighted_rating : null;

    // Parks and golf courses get a plain, larger emoji marker instead of a
    // pill or a discovery dot — regardless of tier — they read better on the
    // map as a persistent landmark icon than as a name-bearing bubble or a
    // dot that vanishes below zoom 17.
    const cats = venueCategories(v);
    const isParkPin = cats.includes('outdoors') && /park/i.test(v.name || '');
    const isGolfPin = cats.includes('activities') && (/golf/i.test(v.name || '') || /golf/i.test(v.subcategory || ''));
    const specialIcon = activeCategoryRef.current === 'wadup' ? (EVENT_TYPE_ICON[getVenueEventForDay(v.id, activeDateRef.current)?.event_type] || '🎉') : isParkPin ? '🌳' : isGolfPin ? '⛳' : null;
    const tier = specialIcon ? null : getVenueTier(areaRank);
    const rankStyle = tier === 'top10' ? getRankStyle(areaRank) : null;

    // contentEl is the visual bubble — it gets the hover-scale transform via
    // CSS. el (below) is a plain positioning shell makeOverlay moves around
    // with an inline transform of its own; putting both transforms on the
    // SAME element would mean the CSS :hover one just clobbers the JS
    // positioning one instead of composing with it.
    const contentEl = document.createElement('div');
    if (v.is_private) contentEl.style.opacity = '0.5';

    if (specialIcon) {
      contentEl.className = `wu-pin ${zoomClass} wu-pin-emoji`;
      const iconSpan = document.createElement('span');
      iconSpan.className = 'wu-emoji-icon';
      iconSpan.textContent = specialIcon;
      contentEl.appendChild(iconSpan);
    } else if (tier === 'discovery') {

      // Keep non-top-10 restaurants discoverable at every zoom level.
      // Their smaller dot remains clickable and opens the existing venue popup.
      contentEl.className = 'wu-pin-discovery visible';
      contentEl.style.setProperty('--wu-dot-size', `${discoveryDotSize(map.getZoom())}px`);

      const chosenEmoji = cats.includes('restaurant') ? restaurantFoodIcon(v) : (v.custom_emoji || null);
      const dot = document.createElement(chosenEmoji ? 'span' : 'div');
      dot.className = chosenEmoji ? 'wu-bar-discovery-emoji' : 'wu-discovery-dot';
      if (chosenEmoji) {
        if (chosenEmoji === 'winged-burger' || chosenEmoji === 'winged-pizza') dot.appendChild(foodIconElement(chosenEmoji));
        else dot.textContent = chosenEmoji;
        dot.style.cssText = 'font-size:calc(var(--wu-dot-size, 8px) * 1.5);line-height:1;';
      }

      contentEl.appendChild(dot);
    } else {
      contentEl.className = `wu-pin ${zoomClass}`;
      if (isLiveEvent) contentEl.classList.add('wu-pin-live');
      const pill = document.createElement('div');
      pill.className = 'wu-pill';
      pill.style.background = rankStyle.bg;
      pill.style.boxShadow = rankStyle.shadow;

      if (eventsChipActive && todayEvent) {
        const badgeEl = document.createElement('span');
        if (isLiveEvent) {
          badgeEl.className = 'wu-live-music-note';
          badgeEl.textContent = '🎵';
        } else {
          badgeEl.className = 'wu-badge wu-event-badge';
          badgeEl.textContent = getEventIcon(todayEvent.event_type);
        }
        pill.appendChild(badgeEl);
      } else if (topBadge && !cats.includes('restaurant')) {
        const badgeEl = document.createElement('span');
        badgeEl.className = topBadge.id === 'live' ? 'wu-badge wu-badge-live' : 'wu-badge';
        badgeEl.textContent = topBadge.icon;
        pill.appendChild(badgeEl);
      }

      // Food icon is a fixed geographic pin, never part of the name/rank pill.

      const textWrap = document.createElement('div');
      textWrap.className = 'wu-pill-text';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'wu-name';
      nameSpan.textContent = `${rankStyle.prefix} ${v.name}`;
      nameSpan.style.color = rankStyle.color;
      textWrap.appendChild(nameSpan);

      if (areaRating != null) {
        const ratingSpan = document.createElement('span');
        ratingSpan.className = 'wu-rating';
        ratingSpan.textContent = `⭐${areaRating.toFixed(1)}`;
        ratingSpan.style.color = rankStyle.color;
        textWrap.appendChild(ratingSpan);
      }

      pill.appendChild(textWrap);

      const tail = document.createElement('div');
      tail.className = 'wu-tail';
      tail.style.borderTopColor = rankStyle.bg;

      contentEl.appendChild(pill);
      contentEl.appendChild(tail);
    }

    // Ranked pill bubbles need to consistently paint in front of the small
    // beer-icon bar pins they otherwise visually compete with (see
    // dropBarPin) — #1 gets the highest baseline, #10 the lowest, and
    // anything not a ranked pill (discovery dots, park/golf emoji) keeps no
    // explicit baseline at all, same as before this fix.
    const baseZIndex = tier === 'top10' ? 1000 + (10 - Math.min(areaRank || 10, 10)) : null;

    const el = document.createElement('div');
    el.className = 'wu-pin-wrapper';
    if (tier === 'discovery' && cats.includes('restaurant')) el.title = v.name;
    if (baseZIndex != null) el.style.zIndex = String(baseZIndex);
    el.appendChild(contentEl);

    const ratingHtml = hasRating && hasWadupRating(v)
      ? `<div class="popup-rating">⭐ ${rating.toFixed(1)} (${ratingCount} WadUp review${ratingCount === 1 ? '' : 's'})</div>`
      : '';
    const badgesHtml = badges.length
      ? `<div class="popup-badges">${badges.map(b => `<span class="popup-badge">${b.icon} ${escapeHtml(b.label)}</span>`).join('')}</div>`
      : '';
    // Admin-only Edit button, built straight into the popup HTML string since
    // Google's InfoWindow content is raw HTML, not React — window.__wadupEditVenue
    // (defined once at map init) is the bridge back into React state. Same
    // markup serves both the click-triggered InfoWindow and the desktop
    // hover popup, since both go through this same iwHtml/openPopup path.

    // Performer/event-time block, shown above the usual type/rating/address
    // lines whenever this pin only exists because of a venue_events row for
    // the selected day (see getVenueEventForDay above) — venue_events has no
    // NOT NULL on performer (most scraped rows never get one), hence the guard.
    const eventPopupHtml = (eventsChipActive && todayEvent) ? `
        ${todayEvent.performer ? `<div class="popup-performer">${isLiveEvent ? '<span class="wu-live-music-note">🎵</span>' : getEventIcon(todayEvent.event_type)} ${escapeHtml(todayEvent.performer)}</div>` : ''}
        ${todayEvent.title ? `<div class="popup-event-name">${escapeHtml(todayEvent.title)}</div>` : ''}
        <div class="popup-event-time">${isLiveEvent ? '<span class="live-now-text">🔴 LIVE NOW</span>' : `🕐 ${escapeHtml(formatTime((todayEvent.start_time || '').slice(11, 16)))}`}</div>
        ${/^https:\/\//i.test(todayEvent.ticket_url || '') ? `<a class="popup-link" href="${escapeHtml(todayEvent.ticket_url)}" target="_blank" rel="noopener noreferrer">🎟️ Get Tickets →</a>` : ''}
      ` : '';

    const canEditPhoto = Boolean(adminRoleRef.current || (sessionRef.current?.user?.id && v.owner_id === sessionRef.current.user.id));
    const iwHtml = `
      ${canEditPhoto ? `<button class="wu-popup-photo-edit" type="button" title="Edit map & phone photo" aria-label="Edit map and phone photo" onclick="event.stopPropagation();window.__wadupEditMapPhoto('${escapeHtml(v.id)}')">📷</button>` : ''}
      <div class="gm-iw ${v.cover_photo_mobile_url || v.cover_photo_url ? 'gm-iw-with-cover' : ''}" ${v.cover_photo_mobile_url || v.cover_photo_url ? `style="--wu-popup-cover:url(&quot;${escapeHtml(v.cover_photo_mobile_url || v.cover_photo_url)}&quot;)"` : ''}>
        <div class="popup-name">${escapeHtml(v.name)}</div>
        ${eventPopupHtml}
        <div class="popup-category-rows">${cats.map(cat => {
          const subs = (Array.isArray(v.subcategories) && v.subcategories.length ? v.subcategories : [v.subcategory].filter(Boolean))
            .filter(sub => CATEGORY_CHIPS.some(ch => ch.id === (cat === 'nightlife' ? 'bars' : cat) && ch.subcategories.some(x => x.id === sub)));
          const emoji = cat === 'nightlife' ? (String(v.category) === 'nightlife' ? popupVenueEmoji(v) : (() => {
            const type = String(subs[0] || '').toLowerCase();
            if (/sports bar/.test(type)) { const m = new Date().getMonth() + 1; return m >= 9 || m === 1 ? '🏈' : m <= 3 ? '🏀' : '⚾'; }
            if (/social bar/.test(type)) return '🎯';
            if (/brewery/.test(type)) return '🍺';
            if (/pool hall/.test(type)) return '🎱';
            return '🍺';
          })()) : cat === 'restaurant' ? restaurantFoodIcon(v) : ({activities:'🎳',outdoors:'🌳',coffee:'☕',shopping:'🛍️',sports:'🏟️',events:'🎟️'}[cat] || popupVenueEmoji(v));
          const emojiMarkup = emoji === 'winged-burger' ? '<img src="/icons/winged-burger.svg" alt="Burger" width="25" height="23"/>' : escapeHtml(emoji);
          return `<div class="popup-category-row"><span class="popup-category-badge">${emojiMarkup} ${escapeHtml(popupCategoryText(cat))}</span><span class="popup-category-subs">${escapeHtml(subs.join(' · '))}</span></div>`;
        }).join('')}</div>
        ${ratingHtml}
        ${badgesHtml}
        <div class="popup-address"><a class="wu-directions-link" href="${/iPhone|iPad|iPod/i.test(typeof navigator!=='undefined'?navigator.userAgent:'')?'https://maps.apple.com/?daddr=':'https://www.google.com/maps/dir/?api=1&destination='}${encodeURIComponent(Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lng)) ? `${v.lat},${v.lng}` : [v.address,v.city,v.state].filter(Boolean).join(', '))}" target="_blank" rel="noopener noreferrer" title="Get directions">📍 ${escapeHtml(v.address || [v.city,v.state].filter(Boolean).join(', '))} ↗</a></div>
        <a class="popup-view-reviews" href="/venue/${encodeURIComponent(v.id)}">👀 CHECK IT OUT</a>
      </div>`;

    const offsetPos = getOffsetPosition(v.lat, v.lng);
    const pos    = new window.google.maps.LatLng(offsetPos.lat, offsetPos.lng);
    const marker = new window.google.maps.Marker({
      position: pos, map,
      icon: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', scaledSize: new window.google.maps.Size(1,1) },
      clickable: false,
      zIndex: baseZIndex ?? (tier === 'discovery' ? 1 : (topBadge ? 15 : 10)),
    });
    const overlayAnchor = specialIcon ? 'center' : tier === 'discovery' ? 'top' : 'bottom';
    const overlay = makeOverlay(pos, el, map, overlayAnchor);
    if (tier === 'top10' && cats.includes('restaurant') && !eventsChipActive) {
      overlay.__fixedEmojiLabel = true;
      el.classList.add('wu-ranked-emoji-label');
    }

    const openPopup = () => {
      infoWindow.current.setContent(iwHtml);
      infoWindow.current.open(map, marker);
      // The close-button space is owned by Google Maps outside .gm-iw.
      // Paint the cover on Google's outer popup surface so that upper
      // whitespace is covered without changing the popup's dimensions.
      window.google.maps.event.addListenerOnce(infoWindow.current, 'domready', () => {
        const popup = document.querySelector('.gm-style-iw-c:has(.gm-iw-with-cover)');
        if (popup) {
          const photo = v.cover_photo_mobile_url || v.cover_photo_url;
          if (photo) popup.style.setProperty('--wu-outer-cover', 'url("' + String(photo).replace(/["\\\n\r]/g, '') + '")');
          // Google Maps sometimes leaves a tall photo popup above the visible
          // viewport, especially when a venue is selected near the top edge.
          // Measure the actual popup after layout and pan only enough to fit it.
          // Do not close/recreate the selected marker during the resulting idle.
          window.requestAnimationFrame(() => {
            if (!popup.isConnected || map.__wadupSelectedVenueId !== v.id) return;
            const mapBox = map.getDiv().getBoundingClientRect();
            const popupBox = popup.getBoundingClientRect();
            const margin = 14;
            let dx = 0, dy = 0;
            if (popupBox.top < mapBox.top + margin) dy = popupBox.top - mapBox.top - margin;
            else if (popupBox.bottom > mapBox.bottom - margin) dy = popupBox.bottom - mapBox.bottom + margin;
            if (popupBox.left < mapBox.left + margin) dx = popupBox.left - mapBox.left - margin;
            else if (popupBox.right > mapBox.right - margin) dx = popupBox.right - mapBox.right + margin;
            if (dx || dy) map.panBy(dx, dy);
          });
        }
      });
    };

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePinInteraction(v.id);
    });
    mapMarkers.current[v.id] = { marker };
    if (tier === 'top10' && cats.includes('restaurant') && !eventsChipActive) {
      // One DOM/Maps overlay for the entire ranked pin: bubble, pointer, and emoji.
      // The emoji is a child of the same wrapper, not a separate OverlayView.
      const emojiShell = document.createElement('div');
      emojiShell.className = 'wu-ranked-attached-emoji';
      emojiShell.style.cssText = 'position:relative;align-self:center;margin-top:3px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35));';
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'center';
      el.style.transformOrigin = 'center bottom';
      const glyph = foodIconElement(restaurantFoodIcon(v));
      glyph.style.fontSize = '24px';
      emojiShell.appendChild(glyph);
      el.appendChild(emojiShell);
      overlay.__attachedEmojiShell = emojiShell;
    }
    overlays.current[v.id] = overlay;

    // Scale a shared INNER visual group, never the Google Maps positioning
    // wrapper. This also includes the restaurant emoji appended above.
    const hoverVisual = document.createElement('div');
    hoverVisual.className = 'wu-hover-visual';
    hoverVisual.style.cssText = 'display:flex;flex-direction:column;align-items:center;transform:scale(1);transform-origin:center bottom;transition:transform 180ms ease-out;';
    while (el.firstChild) hoverVisual.appendChild(el.firstChild);
    el.appendChild(hoverVisual);
    const setHoverScale = (hovered) => {
      hoverVisual.style.transform = hovered ? 'scale(1.12)' : 'scale(1)';
    };
    el.addEventListener('pointerenter', () => setHoverScale(true));
    el.addEventListener('pointerleave', () => setHoverScale(false));

    // Every pin is one interactive overlay. Hovering its label OR emoji
    // raises the entire wrapper; clicking keeps it in front until another
    // pin is selected. Do not change its map position or split its children.
    {
      const restingZ = el.style.zIndex;
      const syncStack = () => {
        const active = el.classList.contains('wu-pin-selected');
        const hovered = el.matches(':hover') || el.matches(':focus-within');
        el.style.zIndex = active ? '2147483000' : hovered ? '2147482000' : restingZ;
        el.classList.toggle('wu-pin-front', active || hovered);
      };
      el.addEventListener('pointerenter', syncStack);
      el.addEventListener('pointerleave', syncStack);
      el.addEventListener('focusin', syncStack);
      el.addEventListener('focusout', () => requestAnimationFrame(syncStack));
      el.addEventListener('click', () => {
        map.__wadupSelectedPin?.classList.remove('wu-pin-selected');
        if (map.__wadupSelectedPin && map.__wadupSelectedPin !== el) {
          map.__wadupSelectedPin.dispatchEvent(new Event('wadup-restack'));
        }
        map.__wadupSelectedPin = el;
        map.__wadupSelectedVenueId = v.id;
        el.classList.add('wu-pin-selected');
        syncStack();
      });
      el.addEventListener('wadup-restack', syncStack);
      const previousRemove = overlay.onRemove;
      overlay.onRemove = function() {
        // A viewport re-rank rebuilds overlays. Keep the selected venue ID
        // so its replacement overlay can restore the selection.
        if (map.__wadupSelectedPin === el) map.__wadupSelectedPin = null;
        previousRemove.call(this);
      };
    }

    const entry = { id: v.id, type: 'venue', tier, rank: areaRank, marker, overlay, fixedEmoji: overlay.__fixedEmoji || null, el, lat: offsetPos.lat, lng: offsetPos.lng, openPopup };
    pinRegistry.current.set(v.id, entry);
    if (map.__wadupSelectedVenueId === v.id) {
      map.__wadupSelectedPin = el;
      el.classList.add('wu-pin-selected', 'wu-pin-front');
      el.style.zIndex = '2147483000';
      // Normally the selected marker is retained across viewport updates.
      // If another operation genuinely replaces it, restore its popup anchor.
      if (infoWindow.current?.getMap()) infoWindow.current.open(map, marker);
    }
    queueMapLabelLayout(map);
  }, [zoomClass]);

  useEffect(() => { dropVenuePinRef.current = dropVenuePin; }, [dropVenuePin]);

  // dropVenuePin bakes the "✏️ Edit Venue" popup button into a cached HTML
  // string at drop time, read from adminRoleRef — so a venue pin dropped
  // before the async admin-role lookup resolves would be stuck without the
  // button until something else happened to redraw it. Re-dropping every
  // live pin whenever adminRole changes closes that race — routed through
  // filterPinsRef (→ updateAreaRanks) rather than a direct loop here, since
  // that's the only path that also knows each venue's current tier/rank.
  useEffect(() => {
    if (!mapReady) return;
    filterPinsRef.current?.();
  }, [adminRole, mapReady, dropVenuePin]);

  // Owner-selected map icons are constrained to an approved set.
  // Default bars use beer; restaurant discovery keeps its dot unless an
  // owner explicitly selects an icon. No new visible filters are added.
  const OWNER_MAP_EMOJIS = new Set(['🍔','🍕','🍗','🍖','🥩','🌮','🌯','🍣','🍜','🍝','🍤','🦞','🦀','🥪','🥞','🍳','🥐','🥗','🥘','🍛','🍱','🥟','🍲','🍟','🥙','🍚','🧀','🍽️','☕','🍺','🍻','🍸','🍹','🥃','🍷','🍾','🍶','🎤','🎱','🎯','🎶','💃','🪩','🎳','🎮','🕹️','🏓','🪓','🏌️','🎟️','🧩','🎨','🏈','🏀','⚾','⛳','🌃','winged-burger']);
  // Nightlife emoji defaults follow the primary nightlife subcategory.
  // A verified owner's approved custom_emoji always wins and remains fixed.
  const seasonalSportsEmoji = (date = new Date()) => {
    const month = date.getMonth() + 1;
    return month >= 9 || month === 1 ? '🏈' : month <= 3 ? '🏀' : '⚾';
  };
  const nightlifeEmoji = (v) => {
    const primary = String(v.category || '').toLowerCase();
    const subs = Array.isArray(v.subcategories) ? v.subcategories : [];
    const selected = primary === 'nightlife'
      ? (v.subcategory || subs.find(x => /sports bar|speakeasy|dance club|brewery|dive bar|karaoke|rooftop|pool hall/i.test(String(x))) || '')
      : '';
    const type = String(selected).toLowerCase().trim();
    if (/social bar/.test(type)) return '🎯';
    if (/sports bar/.test(type)) return seasonalSportsEmoji();
    if (/speakeasy/.test(type)) return '🥃';
    if (/dance club|nightclub/.test(type)) return '🪩';
    if (/brewery/.test(type)) return '🍺';
    if (/dive bar/.test(type)) return '🍻';
    if (/karaoke/.test(type)) return '🎤';
    if (/rooftop/.test(type)) return '🌃';
    if (/pool hall|billiard/.test(type)) return '🎱';
    return '🍺';
  };
  const venueMapEmoji = (v, fallback = null) =>
    OWNER_MAP_EMOJIS.has(v.custom_emoji) ? v.custom_emoji
      : (String(v.category || '').toLowerCase() === 'nightlife' ? nightlifeEmoji(v) : fallback);

  // Use the same venue-specific emoji in the map popup as on its pin.
  // Category labels are text only here: their generic emoji must never
  // override a venue's own icon (e.g. Social Bar 🎯, not nightlife 🍸).
  const popupCategoryText = (category) => String(CATEGORY_LABELS[category] || category).replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const popupVenueEmoji = (v) => {
    const cat = String(v.category || '').toLowerCase();
    const defaults = { restaurant: '🍔', nightlife: '🍺', activities: '🎳', outdoors: '🌳', sports: '🏟️', events: '🎵', 'must-see': '⭐' };
    return venueMapEmoji(v, defaults[cat] || '📍');
  };

  // ── Drop a bar/nightlife pin ── same viewport-scoped areaRank as
  // dropVenuePin (a venues.admin_rank_number override, when set, wins over
  // it — see calculateDisplayRank in lib/rankings.js for the same
  // precedence used server-side), but bars get a compact 🍺 icon pin outside
  // the top ranks instead of a small dot, and always carry a flame-vote
  // badge (🟡/🟠/🔴) reflecting how busy the crowd says it is right now.
  // `showName` (full ranked pill vs. icon-only) tightens as you zoom in —
  // top 10 city/area-wide, narrowing to top 5 once individual bars are
  // already easy enough to tap without a name-bearing pill.
  const dropBarPin = useCallback((v, areaRank) => {
    const map = mapObj.current;
    if (!map || !v.lng || !v.lat) return;

    if (mapMarkers.current[v.id]) {
      mapMarkers.current[v.id].marker.setMap(null);
      if (overlays.current[v.id]) overlays.current[v.id].setMap(null);
    }
    if (pinRegistry.current.has(v.id)) {
      pinRegistry.current.delete(v.id);
    }
    if (!v.live) return;

    // Use the exact same viewport-relative top-10 rank as restaurant pins.
    // Do not override it with a permanent admin rank or hide ranks 6-10 on zoom.
    const rank = areaRank;
    const showName = getVenueTier(areaRank) === 'top10';
    const rankStyle = showName ? getRankStyle(rank) : null;

    const flameLevel = v.current_flame || 0;
    const flameEmoji = flameLevel === 3 ? '🔴' : flameLevel === 2 ? '🟠' : flameLevel === 1 ? '🟡' : null;

    // Events chip: same event-badge/live-note override as dropVenuePin — a
    // bar with a live-music/trivia/etc. night tonight gets the animated note
    // or event-type icon instead of its usual flame badge.
    const eventsChipActive = activeCategoryRef.current === 'events';
    const dayIsoForPin = activeDateRef.current || todayIsoStr();
    const todayEvent = eventsChipActive ? getVenueEventForDay(v.id, dayIsoForPin) : null;
    const isLiveEvent = isEventLive(todayEvent);

    // contentEl gets the hover-scale CSS transform; el (below) is a plain
    // positioning shell makeOverlay moves with its own inline transform —
    // see dropVenuePin's identical split for why these can't be one element.
    const contentEl = document.createElement('div');
    if (v.is_private) contentEl.style.opacity = '0.5';

    if (showName) {
      contentEl.className = `wu-pin ${zoomClass}`;
      if (isLiveEvent) contentEl.classList.add('wu-pin-live');
      const pill = document.createElement('div');
      pill.className = 'wu-pill';
      pill.style.background = rankStyle.bg;
      pill.style.boxShadow = rankStyle.shadow;

      if (eventsChipActive && todayEvent) {
        const badgeEl = document.createElement('span');
        if (isLiveEvent) {
          badgeEl.className = 'wu-live-music-note';
          badgeEl.textContent = '🎵';
        } else {
          badgeEl.className = 'wu-badge wu-event-badge';
          badgeEl.textContent = getEventIcon(todayEvent.event_type);
        }
        pill.appendChild(badgeEl);
      } else if (flameEmoji) {
        const badgeEl = document.createElement('span');
        badgeEl.className = 'wu-badge';
        badgeEl.textContent = flameEmoji;
        pill.appendChild(badgeEl);
      }

      const textWrap = document.createElement('div');
      textWrap.className = 'wu-pill-text';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'wu-name';
      nameSpan.textContent = `${rankStyle.prefix} ${v.name}`;
      nameSpan.style.color = rankStyle.color;
      textWrap.appendChild(nameSpan);

      const areaRating = v.weighted_rating > 0 ? v.weighted_rating : null;
      if (areaRating != null) {
        const ratingSpan = document.createElement('span');
        ratingSpan.className = 'wu-rating';
        ratingSpan.textContent = `⭐${areaRating.toFixed(1)}`;
        ratingSpan.style.color = rankStyle.color;
        textWrap.appendChild(ratingSpan);
      }

      pill.appendChild(textWrap);

      const tail = document.createElement('div');
      tail.className = 'wu-tail';
      tail.style.borderTopColor = rankStyle.bg;

      contentEl.appendChild(pill);
      contentEl.appendChild(tail);
    } else {
      // Same discovery tier, zoom scaling and label rules as restaurants;
      // the only visual difference is an emoji instead of a blue dot.
      contentEl.className = 'wu-pin-discovery visible wu-bar-discovery';
      contentEl.style.setProperty('--wu-dot-size', `${discoveryDotSize(map.getZoom())}px`);
      const emoji = document.createElement('span');
      emoji.className = 'wu-bar-discovery-emoji';
      const selectedBarEmoji = venueMapEmoji(v, '🍺');
      if (selectedBarEmoji === 'winged-burger') emoji.appendChild(foodIconElement(selectedBarEmoji));
      else emoji.textContent = selectedBarEmoji;
      emoji.style.cssText = 'font-size:calc(var(--wu-dot-size, 8px) * 1.5);line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25));';
      contentEl.appendChild(emoji);
    }

    // Ranked pill bubbles need to consistently paint in front of the small
    // beer-icon pins — #1 gets the highest baseline, #10 the lowest, and
    // every icon-only bar sits at a fixed low baseline below all of them.
    const baseZIndex = showName ? 1000 + (10 - Math.min(rank || 10, 10)) : 1;

    const el = document.createElement('div');
    el.className = 'wu-pin-wrapper';
    if (!showName) el.title = v.name;
    el.style.zIndex = String(baseZIndex);
    el.appendChild(contentEl);

    const rating = effectiveRating(v);
    const ratingCount = effectiveRatingCount(v);
    const hasRating = rating != null && (ratingCount || 0) > 0;
    const ratingHtml = hasRating && hasWadupRating(v)
      ? `<div class="popup-rating">⭐ ${rating.toFixed(1)} (${ratingCount} WadUp review${ratingCount === 1 ? '' : 's'})</div>`
      : '';
    const flameHtml = flameEmoji
      ? `<div class="popup-flame">${flameEmoji} ${flameLevel === 3 ? 'Packed!' : flameLevel === 2 ? 'Getting Busy' : 'Getting There'}</div>`
      : '';

    // Same performer/event-time block as dropVenuePin — see its comment.
    const eventPopupHtml = (eventsChipActive && todayEvent) ? `
        ${todayEvent.performer ? `<div class="popup-performer">${isLiveEvent ? '<span class="wu-live-music-note">🎵</span>' : getEventIcon(todayEvent.event_type)} ${escapeHtml(todayEvent.performer)}</div>` : ''}
        ${todayEvent.title ? `<div class="popup-event-name">${escapeHtml(todayEvent.title)}</div>` : ''}
        <div class="popup-event-time">${isLiveEvent ? '<span class="live-now-text">🔴 LIVE NOW</span>' : `🕐 ${escapeHtml(formatTime((todayEvent.start_time || '').slice(11, 16)))}`}</div>
        ${/^https:\/\//i.test(todayEvent.ticket_url || '') ? `<a class="popup-link" href="${escapeHtml(todayEvent.ticket_url)}" target="_blank" rel="noopener noreferrer">🎟️ Get Tickets →</a>` : ''}
      ` : '';

    const iwHtml = `
      <div class="gm-iw">
        <div class="popup-name">${escapeHtml(v.name)}</div>
        ${eventPopupHtml}
        <div class="popup-type">${escapeHtml(popupVenueEmoji(v))} ${escapeHtml(popupCategoryText('nightlife'))}${v.subcategory ? ' · ' + escapeHtml(v.subcategory) : ''}</div>
        ${ratingHtml}
        ${flameHtml}
        <div class="popup-address"><a class="wu-directions-link" href="${/iPhone|iPad|iPod/i.test(typeof navigator!=='undefined'?navigator.userAgent:'')?'https://maps.apple.com/?daddr=':'https://www.google.com/maps/dir/?api=1&destination='}${encodeURIComponent(Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lng)) ? `${v.lat},${v.lng}` : [v.address,v.city,v.state].filter(Boolean).join(', '))}" target="_blank" rel="noopener noreferrer" title="Get directions">📍 ${escapeHtml(v.address || [v.city,v.state].filter(Boolean).join(', '))} ↗</a></div>
        <a class="popup-view-reviews" href="/venue/${encodeURIComponent(v.id)}">👀 CHECK IT OUT</a>
      </div>`;

    const offsetPos = getOffsetPosition(v.lat, v.lng);
    const pos    = new window.google.maps.LatLng(offsetPos.lat, offsetPos.lng);
    const marker = new window.google.maps.Marker({
      position: pos, map,
      icon: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', scaledSize: new window.google.maps.Size(1,1) },
      zIndex: baseZIndex,
      clickable: false, // The invisible anchor must never steal pointer hits from visible pins.
    });
    const overlay = makeOverlay(pos, el, map, showName ? 'bottom' : 'top');

    const openPopup = () => {
      infoWindow.current.setContent(iwHtml);
      infoWindow.current.open(map, marker);
    };

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePinInteraction(v.id);
    });
    // Ranked nightlife pins use ONE overlay for name, arrow, and emoji.
    // No independent emoji overlay: it can drift and paint above the label.
    if (showName && !eventsChipActive) {
      el.classList.add('wu-ranked-emoji-label');
      overlay.__fixedEmojiLabel = true;
      const emojiShell = document.createElement('div');
      emojiShell.className = 'wu-ranked-attached-emoji';
      emojiShell.style.cssText = 'position:relative;align-self:center;margin-top:3px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;pointer-events:auto;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35));';
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'center';
      const glyph = foodIconElement(venueMapEmoji(v, '🍺'));
      glyph.style.fontSize = '24px';
      emojiShell.appendChild(glyph);
      el.appendChild(emojiShell);
    }
    const hoverVisual = document.createElement('div');
    hoverVisual.className = 'wu-hover-visual';
    hoverVisual.style.cssText = 'display:flex;flex-direction:column;align-items:center;transform:scale(1);transform-origin:center bottom;transition:transform 180ms ease-out;';
    while (el.firstChild) hoverVisual.appendChild(el.firstChild);
    el.appendChild(hoverVisual);
    const restingZ = el.style.zIndex;
    const syncStack = () => {
      const active = el.classList.contains('wu-pin-selected');
      const hovered = el.matches(':hover') || el.matches(':focus-within');
      el.style.zIndex = active ? '2147483000' : hovered ? '2147482000' : restingZ;
      el.classList.toggle('wu-pin-front', active || hovered);
      hoverVisual.style.transform = hovered ? 'scale(1.12)' : 'scale(1)';
    };
    el.addEventListener('pointerenter', syncStack);
    el.addEventListener('pointerleave', syncStack);
    el.addEventListener('focusin', syncStack);
    el.addEventListener('focusout', () => requestAnimationFrame(syncStack));
    el.addEventListener('click', () => {
      map.__wadupSelectedPin?.classList.remove('wu-pin-selected');
      if (map.__wadupSelectedPin && map.__wadupSelectedPin !== el)
        map.__wadupSelectedPin.dispatchEvent(new Event('wadup-restack'));
      map.__wadupSelectedPin = el;
      map.__wadupSelectedVenueId = v.id;
      el.classList.add('wu-pin-selected');
      syncStack();
    });
    el.addEventListener('wadup-restack', syncStack);
    const previousRemove = overlay.onRemove;
    overlay.onRemove = function () {
      if (map.__wadupSelectedPin === el) map.__wadupSelectedPin = null;
      previousRemove.call(this);
    };
    mapMarkers.current[v.id] = { marker };
    overlays.current[v.id] = overlay;
    const entry = { id: v.id, type: 'venue', tier: showName ? 'top10' : 'discovery', rank: areaRank, marker, overlay, el, lat: offsetPos.lat, lng: offsetPos.lng, openPopup };
    pinRegistry.current.set(v.id, entry);
    if (map.__wadupSelectedVenueId === v.id) {
      map.__wadupSelectedPin = el;
      el.classList.add('wu-pin-selected', 'wu-pin-front');
      el.style.zIndex = '2147483000';
    }
    queueMapLabelLayout(map);
  }, [zoomClass]);

  useEffect(() => { dropBarPinRef.current = dropBarPin; }, [dropBarPin]);

  useEffect(() => {
    if (!mapReady) return;
    filterPinsRef.current?.();
  }, [adminRole, mapReady, dropBarPin]);

  // ── Drop a TM pin ──
  const dropTMPin = useCallback((ev) => {
    const map = mapObj.current;
    if (!map) return;

    if (tmMarkers.current[ev.id]) {
      tmMarkers.current[ev.id].marker.setMap(null);
      if (tmMarkers.current[ev.id].overlay) tmMarkers.current[ev.id].overlay.setMap(null);
    }
    if (pinRegistry.current.has(ev.id)) {
      pinRegistry.current.delete(ev.id);
    }

    const icon = specificEventEmoji(ev);

    // contentEl gets the hover-scale CSS transform; el (below) is a plain
    // positioning shell makeOverlay moves with its own inline transform —
    // see dropVenuePin's identical split for why these can't be one element.
    const contentEl = document.createElement('div');
    contentEl.className = `wu-pin ${zoomClass}`;
    contentEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;transform-origin:center bottom;';

    const pill = document.createElement('div');
    pill.className = 'wu-pill wu-pill-tm';

    const textWrap = document.createElement('div');
    textWrap.className = 'wu-pill-text';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'wu-name';
    nameSpan.textContent = ev.name;
    textWrap.appendChild(nameSpan);

    const metaSpan = document.createElement('span');
    metaSpan.className = 'wu-rating';
    metaSpan.textContent = ev.price || '';
    textWrap.appendChild(metaSpan);

    pill.appendChild(textWrap);

    const tail = document.createElement('div');
    tail.className = 'wu-tail wu-tail-tm';

    contentEl.appendChild(pill);
    contentEl.appendChild(tail);
    const emojiShell = document.createElement('div');
    emojiShell.className = 'wu-tm-attached-emoji';
    emojiShell.style.cssText = 'font-size:25px;line-height:30px;height:30px;min-width:30px;display:flex;align-items:center;justify-content:center;pointer-events:auto;filter:drop-shadow(0 1px 3px #0006);';
    emojiShell.textContent = icon;
    contentEl.appendChild(emojiShell);

    const el = document.createElement('div');
    el.className = 'wu-pin-wrapper';
    el.appendChild(contentEl);

    // A single map pin represents one production at one venue; each
    // Ticketmaster performance retains its own date, time and ticket URL.
    // The date picker decides whether a production's pin is visible.
    // Build popup at click time using the currently selected calendar day.
    const buildTMPopup = () => renderEventPopup(ev, activeDateRef.current || todayIsoStr(), icon, TM_AFFILIATE_ID);

    const offsetPos = { lat: ev.lat, lng: ev.lng };
    const pos    = new window.google.maps.LatLng(offsetPos.lat, offsetPos.lng);
    const marker = new window.google.maps.Marker({
      position: pos, map,
      icon: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', scaledSize: new window.google.maps.Size(1,1) },
      zIndex: 5,
    });

    const overlay = makeOverlay(pos, el, map);
    overlay.__tmEventPin = true;
    // Keep name, pointer and event emoji in one OverlayView, with one hit area.

    const openPopup = () => {
      infoWindow.current.setContent(buildTMPopup());
      infoWindow.current.open(map, marker);
    };

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePinInteraction(ev.id);
    });
    const syncEventStack = () => {
      const selected = map.__wadupSelectedVenueId === ev.id;
      el.style.zIndex = selected ? '2147483000' : el.matches(':hover') ? '2147482000' : '';
      contentEl.style.transform = el.matches(':hover') ? 'scale(1.12)' : 'scale(1)';
    };
    el.addEventListener('pointerenter', syncEventStack);
    el.addEventListener('pointerleave', syncEventStack);
    el.addEventListener('wadup-restack', syncEventStack);
    if (ev.venueId === 'chattanooga-songbirds') {
      let closeTimer;
      const cancelClose = () => clearTimeout(closeTimer);
      const scheduleClose = () => {
        cancelClose();
        closeTimer = setTimeout(() => {
          if (map.__wadupHoveredEvent === ev.id) map.__wadupCloseEventHover?.();
        }, 350);
      };
      el.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'mouse' || map.__wadupSelectedPin || map.__wadupMoving) return;
        if (map.__wadupHoveredEvent === ev.id) { cancelClose(); return; }
        map.__wadupCloseEventHover?.();
        const popup = new window.google.maps.InfoWindow({ maxWidth: 240, disableAutoPan: true });
        map.__wadupHoveredEvent = ev.id;
        map.__wadupCloseEventHover = () => {
          cancelClose();
          popup.close();
          map.__wadupHoveredEvent = null;
          map.__wadupCloseEventHover = null;
        };
        const content = document.createElement('div');
        content.innerHTML = buildTMPopup();
        content.addEventListener('pointerenter', cancelClose);
        content.addEventListener('pointerleave', scheduleClose);
        popup.setContent(content);
        popup.open(map, marker);
        popup.addListener('closeclick', () => {
          if (map.__wadupHoveredEvent === ev.id) map.__wadupCloseEventHover?.();
        });
      });
      el.addEventListener('pointerleave', scheduleClose);
    }

    tmMarkers.current[ev.id] = { marker, overlay, event: ev };

    const entry = { id: ev.id, type: 'tm', event: ev, marker, overlay, el, lat: offsetPos.lat, lng: offsetPos.lng, openPopup };
    pinRegistry.current.set(ev.id, entry);
  }, [zoomClass]);
  useEffect(() => { dropTMPinRef.current = dropTMPin; }, [dropTMPin]);

  // ── Load Ticketmaster events from the server-side cache ── populated by
  // pages/api/cron/sync-tm-events.js (a 2-hourly Vercel Cron job — see
  // vercel.json), not fetched live per pageview. cat/sportEmoji are already
  // computed at cache-write time, so no classification-parsing happens here.
  const fetchTM = useCallback(async () => {
    const today = localIsoDate();
    const day = activeDateRef.current || today;
    const request = ++tmRequestRef.current;
    let cache = tmCacheRef.current;
    if (!cache || cache.day !== today || Date.now() - cache.started > 300000) {
      const rows = (async () => {
        const events = [];
        // Keep the existing regional search coverage and paginate in a stable order.
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from('tm_events_cache').select('*')
            .gte('date_str', today)
            .gte('lat', 35.0456 - 7.25).lte('lat', 35.0456 + 7.25)
            .gte('lng', -85.3096 - 8.85).lte('lng', -85.3096 + 8.85)
            .order('date_str').order('tm_id').range(from, from + 999);
          if (error) throw error;
          events.push(...(data || []));
          if (!data || data.length < 1000) return events;
        }
      })();
      cache = { day: today, started: Date.now(), rows, officialByDate: new Map() };
      tmCacheRef.current = cache;
    }
    let official = cache.officialByDate.get(day);
    if (!official) {
      official = fetch('/api/venue-performances?date=' + encodeURIComponent(day))
        .then(async response => {
          if (!response.ok) throw Error('Official venue schedule unavailable');
          const body = await response.json();
          return Array.isArray(body.performances) ? body.performances : [];
        })
        .catch(() => { cache.officialByDate.delete(day); return []; });
      cache.officialByDate.set(day, official);
    }
    try {
      const [ticketRows, officialRows] = await Promise.all([cache.rows, official]);
      if (request !== tmRequestRef.current) return;
      const events = mergeOfficialEventRows(officialRows, ticketRows);
      const grouped = new Map();
      for (const row of suppressTicketDuplicates(events)) {
        const venue = matchEventVenue(row);
        const location = venue?.location;
        const show = {
          id: 'tm_' + row.tm_id, _isTM: true, name: row.name, cat: 'events',
          venueId: venue?.id, venueType: venue?.type, venueWebsite: venue?.website,
          officialUrl: row.official_url, isOfficial: row.is_official, venueName: venue?.name || row.venue_name,
          segment: row.segment, genre: row.genre, subGenre: row.sub_genre, sportEmoji: row.sport_emoji,
          address: location?.address || row.address || '', city: row.city || '', state: row.state || '',
          lng: location?.lng ?? row.lng, lat: location?.lat ?? row.lat,
          dateStr: row.date_str || '', timeStr: row.time_str || '', price: row.price || '',
          img: row.image_url || '', url: row.url || '', live: true, ticket_verification: row.ticket_verification,
        };
        const venueKey = show.venueId || [show.address.toLowerCase(), show.city.toLowerCase(),
          show.state.toLowerCase(), Number(show.lat).toFixed(4), Number(show.lng).toFixed(4)].join('|');
        const groupKey = show.name.trim().toLowerCase().replace(/\s+/g, ' ') + '|' + venueKey;
        if (!grouped.has(groupKey)) grouped.set(groupKey, []);
        const group = grouped.get(groupKey);
        const duplicate = group.findIndex(item => item.id === show.id || (show.dateStr === item.dateStr &&
          show.timeStr && show.timeStr === item.timeStr && show.url === item.url && show.officialUrl === item.officialUrl));
        if (duplicate === -1) group.push(show);
        else group[duplicate] = preferredTicketRecord(group[duplicate], show);
      }
      tmEventsRef.current = Array.from(grouped.values(), shows => {
        shows.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.timeStr.localeCompare(b.timeStr) || a.id.localeCompare(b.id));
        return { ...shows[0], showings: shows };
      });
      const nextById = new Map(tmEventsRef.current.map(event => [event.id, event]));
      for (const [id, mounted] of Object.entries(tmMarkers.current)) {
        const previous = mounted.event;
        const next = nextById.get(id);
        if (next && previous.lat === next.lat && previous.lng === next.lng && previous.name === next.name &&
            previous.price === next.price && specificEventEmoji(previous) === specificEventEmoji(next)) {
          Object.assign(previous, next);
          continue;
        }
        mounted.marker.setMap(null);
        mounted.overlay?.setMap(null);
        delete tmMarkers.current[id];
        pinRegistry.current.delete(id);
      }
      filterPins();
      setFeedRevision(revision => revision + 1);
    } catch (error) {
      if (request !== tmRequestRef.current) return;
      tmCacheRef.current = null;
      console.error('Ticketmaster cache read failed:', error.message || error);
    }
  }, [filterPins]);

  // Pin placement reuses the SAME map as discovery. No second map page,
  // separate Google Maps instance, or duplicated Maps script is necessary.
  const [pinEdit, setPinEdit] = useState(null);
  const [pinPosition, setPinPosition] = useState(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  const pinMarkerRef = useRef(null);
  useEffect(() => {
    if (!mapReady || !mapObj.current) return;
    const venueId = new URLSearchParams(window.location.search).get('placePin');
    if (!venueId) return;
    let cancelled = false;
    let clickListener;
    const map = mapObj.current;
    (async () => {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession) throw Error('Sign in to place this venue pin.');
        const permissionResponse = await fetch('/api/admin/venue-permissions?venueId=' + encodeURIComponent(venueId), { headers: { Authorization: 'Bearer ' + authSession.access_token } });
        const permissions = permissionResponse.ok ? await permissionResponse.json() : {};
        if (!permissions.canManage) throw Error('You do not have permission to move this venue pin.');
        const { data: venue, error: venueError } = await supabase.from('venues').select('id,name,lat,lng').eq('id', venueId).single();
        if (venueError || !venue) throw Error('Venue not found.');
        if (cancelled) return;
        const lat = Number(venue.lat), lng = Number(venue.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw Error('Venue has no valid coordinates.');
        const point = { lat, lng };
        setPinEdit(venue);
        setPinPosition(point);
        setPinError('');
        setShowSplash(false);
        map.panTo(point);
        map.setZoom(17);
        pinMarkerRef.current = new window.google.maps.Marker({ map, position: point, draggable: true, zIndex: 10000, title: 'Drag or click to place this venue' });
        clickListener = map.addListener('click', e => {
          if (!e.latLng) return;
          const next = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          setPinPosition(next);
          pinMarkerRef.current?.setPosition(next);
        });
        pinMarkerRef.current.addListener('dragend', e => {
          if (e.latLng) setPinPosition({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        map.setOptions({ draggableCursor: 'crosshair' });
      } catch (e) { if (!cancelled) { setPinError(e.message); setShowSplash(false); } }
    })();
    return () => {
      cancelled = true;
      clickListener?.remove();
      pinMarkerRef.current?.setMap(null);
      pinMarkerRef.current = null;
      map.setOptions({ draggableCursor: null });
    };
  }, [mapReady]);
  const saveMapPin = async () => {
    if (!pinEdit || !pinPosition || pinBusy) return;
    setPinBusy(true); setPinError('');
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) throw Error('Your session expired. Please sign in again.');
      const response = await fetch('/api/admin/venue-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authSession.access_token },
        body: JSON.stringify({ venueId: pinEdit.id, updates: { lat: pinPosition.lat, lng: pinPosition.lng } }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not save pin.');
      const saved = result.venue;
      if (Math.abs(Number(saved?.lat) - pinPosition.lat) > 0.0000001 || Math.abs(Number(saved?.lng) - pinPosition.lng) > 0.0000001) {
        throw Error('The saved coordinates did not match your selected pin.');
      }
      // The main map and venue profile now read the same persisted venue row.
      window.location.replace('/venue/' + encodeURIComponent(pinEdit.id) + '?pinSaved=1');
    } catch (e) { setPinError(e.message); setPinBusy(false); }
  };

  // Hide near-identical records at the same physical site on the public map.
  // This is display-only: never delete a venue, its reviews or its owner data.
  function dedupeNearbyVenues(rows) {
    const normalized = value => String(value || '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\\b(restaurant|restaurants|the|at|location)\\b/g, ' ')
      .replace(/\\s+/g, ' ').trim();
    const normalizedAddress = value => normalized(value)
      .replace(/\\b(place|pl|boulevard|blvd|street|st|road|rd|drive|dr|avenue|ave)\\b/g, ' ')
      .replace(/\\s+/g, ' ').trim();
    const distanceM = (a, b) => {
      const rad = Math.PI / 180;
      const dLat = (Number(a.lat) - Number(b.lat)) * rad;
      const dLng = (Number(a.lng) - Number(b.lng)) * rad;
      return 6371000 * Math.hypot(dLat, dLng * Math.cos((Number(a.lat) + Number(b.lat)) * rad / 2));
    };
    // Prefer a real Google Place identity over a manually imported alias.
    const preferred = [...rows].sort((a, b) =>
      Number(Boolean(b.google_place_id)) - Number(Boolean(a.google_place_id)) ||
      Number(Boolean(b.google_rating)) - Number(Boolean(a.google_rating)) ||
      Number(b.review_count || 0) - Number(a.review_count || 0));
    const retained = [];
    for (const venue of preferred) {
      if (!Number.isFinite(Number(venue.lat)) || !Number.isFinite(Number(venue.lng))) {
        retained.push(venue); continue;
      }
      const name = normalized(venue.name);
      const duplicate = retained.some(other => {
        if (!Number.isFinite(Number(other.lat)) || !Number.isFinite(Number(other.lng)) ||
            distanceM(venue, other) > 80) return false;
        if (venue.google_place_id && other.google_place_id &&
            venue.google_place_id === other.google_place_id) return true;
        const existing = normalized(other.name);
        if (!name || !existing) return false;
        const [shorter, longer] = name.length <= existing.length ? [name, existing] : [existing, name];
        const similarName = name === existing ||
          (shorter.length >= 9 && shorter.split(' ').length >= 2 &&
            longer.startsWith(shorter + ' '));
        if (!similarName) return false;
        const addr = normalizedAddress(venue.address);
        const otherAddr = normalizedAddress(other.address);
        // Same address or extremely close position + strong name match.
        return (addr && otherAddr && addr === otherAddr) ||
          distanceM(venue, other) <= 35;
      });
      if (!duplicate) retained.push(venue);
    }
    return retained;
  }

  // ── Load real Chattanooga venues from Supabase (Google Places-sourced) ──
  const loadVenuesFromSupabase = useCallback(async () => {
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .eq('is_hidden', false)
      .order('google_rating', { ascending: false });
    if (error || !data) {
      console.error('Wadup venue load failed:', error || 'No venue rows returned');
      return;
    }

    // The rest of this file was written against the earlier mock venue shape
    // (`cat` instead of `category`, and a `live` flag every mock row hardcoded
    // to true) — map real rows into that same shape rather than touching every
    // call site. National/regional chains are excluded from the public map
    // entirely — WadUp is meant to surface local spots (see isChain in
    // lib/data.js).
    venuesRef.current = dedupeNearbyVenues(data.map(v => ({ ...v, live: true })));
    setFeedRevision(v => v + 1);

    // Bulk-fetch venue_events for today through the end of the day-strip's
    // 7-day range once (rather than one query per pin) — venueEventsRef
    // backs the Events chip's per-day pin gating (getVenueEventForDay) and
    // the live-note/event-badge rendering in dropVenuePin/dropBarPin;
    // eventVenueIdsTodayRef stays a plain today-only Set for the existing
    // generic "🎫 Event Today" badge shown on every other chip.
    // venue_events.start_time is a naive LOCAL wall-clock timestamp (every
    // scraped show reads '… 20:00:00', i.e. a real 8pm door time — note that
    // pages/discover.js's parseUtcTimestamp assumes the opposite), so bound
    // this by local day edges and send naive strings rather than instants.
    // setUTCHours meant that from 8pm Eastern onward dayStart was already
    // tomorrow, dropping tonight's shows out of the window entirely.
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(now); rangeEnd.setHours(23, 59, 59, 999); rangeEnd.setDate(rangeEnd.getDate() + 6);
    const pad2 = (n) => String(n).padStart(2, '0');
    const asNaive = (d) => `${localIsoDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    const { data: eventRows, error: eventsError } = await supabase
      .from('venue_events')
      .select('venue_id, title, event_type, performer, start_time, end_time')
      .gte('start_time', asNaive(dayStart))
      .lte('start_time', asNaive(rangeEnd));
    if (eventsError) console.error('venue_events load failed:', eventsError.message);
    venueEventsRef.current = eventRows || [];
    setFeedRevision(v => v + 1);

    const todayIso = localIsoDate(now);
    eventVenueIdsTodayRef.current = new Set(
      venueEventsRef.current
        .filter(e => (e.start_time || '').slice(0, 10) === todayIso && (!e.end_time || new Date(e.end_time) >= now))
        .map(e => e.venue_id)
    );

    // Best Rated placeholder, area-wide — independent of whichever chip is
    // active. Freshly-synced venues have no WadUp reviews yet, so this needs
    // the same Google-rating fallback as the pins themselves; the `> 0`
    // floor keeps a venue with no rating at all (real or Google) from ever
    // getting the ⭐ Best Rated badge just because "top 10 of an empty/tied
    // set" is otherwise an arbitrary slice — the bug that used to put a 🔥
    // Trending badge (a completely separate signal, see getLiveTrendingVenueIds
    // below) on a 0.0-rated venue with zero real activity ever recorded.
    bestRatedVenueIds.current = new Set(
      venuesRef.current
        .filter(v => v.live && isVenueEligible(v) && (effectiveRating(v) || 0) > 0)
        .slice()
        .sort((a, b) => (effectiveRating(b) || 0) - (effectiveRating(a) || 0))
        .slice(0, 10)
        .map(v => v.id)
    );

    // Drop venue pins — filterPins → updateAreaRanks owns this now (it's the
    // only path that knows each venue's tier/rank), and already skips
    // ineligible venues (e.g. a restaurant with nothing on today).
    filterPinsRef.current?.();

    // Phase 2: layer the real ⭐ Best Rated ranking (lib/rankings.js, backed
    // by the live Supabase reviews) onto the naive same-session rating
    // placeholder above, and compute 🔥 Live Trending fresh — additive for
    // Best Rated, a full replace for Trending since getLiveTrendingVenueIds
    // is the sole source of truth for that badge (no rating/placeholder ever
    // feeds it — see the comment above bestRatedVenueIds). Pins already
    // dropped just get re-dropped (picking up the new badge) once this async
    // fetch resolves. Uses filterPinsRef (not the plain closure) since this
    // can resolve well after mount, by which point activeChip/activeDate may
    // have moved on.
    const citiesOnMap = [...new Set(venuesRef.current.map(v => v.city).filter(Boolean))];
    Promise.all(citiesOnMap.map(city => Promise.all([getLiveTrendingVenueIds(supabase, city), getBestRated(city, 10)])))
      .then(perCityResults => {
        let changed = false;
        perCityResults.forEach(([liveTrendingIds, ratedList]) => {
          liveTrendingIds.forEach(id => { if (!trendingVenueIds.current.has(id)) { trendingVenueIds.current.add(id); changed = true; } });
          ratedList.forEach(v => { if (!bestRatedVenueIds.current.has(v.id)) { bestRatedVenueIds.current.add(v.id); changed = true; } });
        });

        if (!changed) return;
        filterPinsRef.current?.();
      })
      .catch(() => { /* rankings are a nice-to-have — pins already show without them */ });
  }, []);

  // ── Admin map controls: Edit/Delete, both triggered from the "✏️ Edit
  // Venue" button inside a venue's popup ──
  const authedFetchIndex = useCallback(async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [session]);

  // A venue pin can be edited on another route. When the user returns via
  // browser Back (including the back-forward cache), refresh venue coordinates
  // from Supabase and redraw the existing map pins without reloading Google Maps.
  useEffect(() => {
    let lastRefresh = 0;
    const refreshOnReturn = () => {
      if (document.visibilityState === 'hidden' || !mapObj.current) return;
      const now = Date.now();
      if (now - lastRefresh < 1500) return;
      lastRefresh = now;
      loadVenuesFromSupabase();
    };
    window.addEventListener('pageshow', refreshOnReturn);
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('pageshow', refreshOnReturn);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [loadVenuesFromSupabase]);

  // loadVenuesFromSupabase's own query only ever returns is_hidden=false
  // venues, so a venue this admin just hid can't come back from a re-fetch —
  // it has to be pulled off the map directly instead.
  const removePinFromMap = useCallback((venueId) => {
    if (mapMarkers.current[venueId]) {
      mapMarkers.current[venueId].marker.setMap(null);
      if (overlays.current[venueId]) overlays.current[venueId].setMap(null);
      delete mapMarkers.current[venueId];
      delete overlays.current[venueId];
    }
    pinRegistry.current.delete(venueId);
    venuesRef.current = venuesRef.current.filter(v => v.id !== venueId);
    // Re-rank what's left in view immediately (e.g. promotes the next
    // discovery dot into the vacated Top 10 slot) instead of leaving a gap
    // until the next pan/zoom triggers updateAreaRanks on its own.
    updateAreaRanks();
  }, [updateAreaRanks]);

  const flashMapSuccess = useCallback((msg) => {
    setMapActionSuccess(msg);
    setTimeout(() => setMapActionSuccess(s => (s === msg ? '' : s)), 2500);
  }, []);

  // Used by AdminEditPanel's own Delete button, which already confirms
  // internally — no confirm dialog here.
  const deleteVenueViaApi = useCallback(async (venue) => {
    try {
      await authedFetchIndex('/api/admin/delete-venue', { venueId: venue.id });
    } catch (e) {
      // The row can go stale between the panel opening and Delete being
      // clicked — another admin deleting it first, or a nightlife sync
      // rebuild (see sync.js) replacing it with a freshly-inserted row under
      // a new id — and the API 404s with "Venue not found" for a venue that
      // was perfectly real when the panel opened. Either way the admin's
      // actual goal (this pin gone) is already true, so don't leave them
      // stuck on an error for a venue that's already gone; anything else
      // (auth/network/real server error) still surfaces normally.
      if (!/venue not found/i.test(e.message)) throw e;
    }
    removePinFromMap(venue.id);
    flashMapSuccess(`Deleted "${venue.name}"`);
  }, [authedFetchIndex, removePinFromMap, flashMapSuccess]);

  // Cancels an in-progress "click map to move" without discarding the panel
  // itself — called when relocate completes, the panel closes, or a
  // different venue's panel opens while one relocate was still pending.
  const relocateListenerRef = useRef(null);
  const cancelRelocate = useCallback(() => {
    if (relocateListenerRef.current) {
      relocateListenerRef.current.remove();
      relocateListenerRef.current = null;
    }
    mapObj.current?.setOptions({ draggableCursor: null });
    setRelocating(false);
  }, []);

  const openEditPanel = useCallback((venue) => {
    // Editing belongs on the real venue profile, not a map-covering modal.
    if (!venue?.id) return;
    window.location.assign('/venue/' + encodeURIComponent(venue.id) + '?edit=1');
  }, []);

  const closeEditPanel = useCallback(() => {
    cancelRelocate();
    setRelocateTarget(null);
    setEditPanelVenue(null);
  }, [cancelRelocate]);

  const startRelocate = useCallback(() => {
    const map = mapObj.current;
    if (!map || !editPanelVenue) return;
    cancelRelocate();
    setRelocating(true);
    map.setOptions({ draggableCursor: 'crosshair' });
    const targetVenue = editPanelVenue;
    const listener = map.addListener('click', (e) => {
      const newLat = e.latLng.lat();
      const newLng = e.latLng.lng();
      setRelocateTarget({ lat: newLat, lng: newLng });
      cancelRelocate();
      // Move the pin right away as a visual preview — the DB row isn't
      // touched until Save is clicked in the panel. Reuses whatever tier/rank
      // this venue's pin last had (rather than recomputing) so the preview
      // doesn't flash down to a plain discovery dot mid-drag.
      const lastRank = pinRegistry.current.get(targetVenue.id)?.rank;
      dropPinForVenue({ ...targetVenue, lat: newLat, lng: newLng, live: true }, lastRank);
      filterPinsRef.current?.();
    });
    relocateListenerRef.current = listener;
  }, [editPanelVenue, cancelRelocate]);

  const saveEditPanelVenue = useCallback(async (fields) => {
    if (!editPanelVenue) return;
    await authedFetchIndex('/api/admin/update-venue', { venueId: editPanelVenue.id, updates: fields });
    flashMapSuccess(`Saved "${fields.name || editPanelVenue.name}"`);

    // Reflect the change on the map immediately — no full page reload, and
    // no waiting on a fresh Supabase fetch either: merge the saved fields
    // into this venue's in-memory record and redraw just that one pin (or
    // remove it outright if it was just hidden).
    const updated = { ...editPanelVenue, ...fields, live: true };
    venuesRef.current = venuesRef.current.map(v => (v.id === editPanelVenue.id ? updated : v));
    if (fields.is_hidden) {
      removePinFromMap(editPanelVenue.id);
    } else if (isVenueEligible(updated)) {
      // filterPins → updateAreaRanks redraws every eligible venue (this one
      // included, already reflected in venuesRef.current above) with its
      // freshly-computed tier/rank — no need to drop this one pin directly.
      filterPinsRef.current?.();
    }
    setEditPanelVenue(updated);
  }, [authedFetchIndex, editPanelVenue, flashMapSuccess, removePinFromMap]);

  const deleteEditPanelVenue = useCallback(async () => {
    if (!editPanelVenue) return;
    await deleteVenueViaApi(editPanelVenue); // throws on failure — AdminEditPanel shows it inline
    closeEditPanel();
  }, [editPanelVenue, deleteVenueViaApi, closeEditPanel]);

  // ── Init Google Maps ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // React Strict Mode double-invokes mount effects in dev; this work (script
    // injection, TM fetches, geolocation) isn't idempotent, so only run it once
    // per real component lifetime.
    if (mapInitStarted.current) return;
    mapInitStarted.current = true;

    const initMap = () => {
      if (!mapRef.current || !window.google?.maps) return;
      setMapLoadError('');

      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: userPos.lat, lng: userPos.lng },
        zoom: 13,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.park', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.attraction', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.government', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.place_of_worship', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.sports_complex', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit.station', stylers: [{ visibility: 'off' }] },
        ],
      });

      mapObj.current     = map;
      infoWindow.current = new window.google.maps.InfoWindow({ maxWidth: 240 });

      // Restore the map position/chip/date a visit to a venue page left
      // behind (see the beforeunload handler below) — one-shot, so a later
      // fresh visit doesn't keep snapping back to wherever this was.
      try {
        const savedState = sessionStorage.getItem('wadup_map_state');
        if (savedState) {
          const state = JSON.parse(savedState);
          map.setCenter({ lat: state.lat, lng: state.lng });
          map.setZoom(state.zoom);
          if (state.chip) {
            const restored = Array.isArray(state.chip) ? (state.chip[0] || 'events') : state.chip;
            activeCategoryRef.current = restored;
            setActiveChip(restored);
          }
          if (state.date) {
            activeDateRef.current = state.date;
            setActiveDate(state.date);
          }
          if (state.subcategories && typeof state.subcategories === 'object') setSubcategoryByChip(state.subcategories);
          if (state.dropdown) setOpenDropdown(state.dropdown);
          setShowSplash(false);
          sessionStorage.removeItem('wadup_map_state');
        }
      } catch (e) { /* a corrupt/unreadable saved state just means no restore */ }

      // "View Reviews" links inside a popup's raw iwHtml are plain <a> tags
      // (Google's InfoWindow content isn't part of the React tree), so
      // clicking one is a hard browser navigation, not a Next.js client
      // transition — beforeunload is what actually fires for that. Saves on
      // every unload (tab close, refresh, any navigation away), which is
      // harmless when there's nothing to restore into next time.
      const saveMapState = () => {
        const m = mapObj.current;
        if (!m) return;
        const center = m.getCenter();
        if (!center) return;
        const state = {
          lat: center.lat(),
          lng: center.lng(),
          zoom: m.getZoom(),
          chip: activeCategoryRef.current,
          date: activeDateRef.current,
          subcategories: subcategoryByChipRef.current,
          dropdown: openDropdownRef.current,
        };
        sessionStorage.setItem('wadup_map_state', JSON.stringify(state));
      };
      window.addEventListener('beforeunload', saveMapState);
      // Save BEFORE navigating to a profile. Mobile browsers and Next.js
      // client-side navigation do not consistently dispatch beforeunload.
      const saveBeforeVenueNavigation = (event) => {
        const link = event.target?.closest?.('a[href*="/venue/"]');
        if (link) saveMapState();
      };
      document.addEventListener('click', saveBeforeVenueNavigation, true);

      // Bridge for the "✏️ Edit Venue" button embedded in a venue popup's raw
      // HTML string (see dropVenuePin's iwHtml) — an inline onclick="" handler
      // has no way to reach React state directly, so it calls this instead.
      window.__wadupEditMapPhoto = (venueId) => {
        const venue = venuesRef.current.find(v=>v.id===venueId);
        if(venue) setMapPhotoVenue(venue);
      };
      window.__wadupEditVenue = (venueId) => {
        const venue = venuesRef.current.find(v => v.id === venueId);
        if (!venue) return;
        infoWindow.current.close();
        openEditPanel(venue);
      };

      // Location dot is created only after the browser returns real coordinates.
      // Never draw it at the fallback Chattanooga map center.
      if (userLocationRef.current) updateUserLocationMarker(userLocationRef.current, map);

      // Zoom listener
      map.addListener('zoom_changed', () => {
        if (map.__wadupZoomFrame) return;
        map.__wadupZoomFrame = requestAnimationFrame(() => {
          map.__wadupZoomFrame = null;
          if (mapObj.current !== map || !mapRef.current) return;
          const z = map.getZoom();
          const zc = z < 7 ? 'zoom-far' : z < 11 ? 'zoom-mid' : 'zoom-near';
          setZoomClass(zc);
          mapRef.current.querySelectorAll('.wu-pin').forEach(el => {
            el.classList.remove('zoom-far','zoom-mid','zoom-near');
            el.classList.add(zc);
          });
          mapRef.current.querySelectorAll('.wu-pin-discovery').forEach(el => {
            el.style.setProperty('--wu-dot-size', `${discoveryDotSize(z)}px`);
            el.classList.toggle('wu-discovery-named', z >= 16);
          });
        });
      });

      // Clicking the bare map (not a pin — every pin's own click handler
      // calls e.stopPropagation(), so this never fires for those) closes
      // whatever popup is currently open.
      map.addListener('click', () => {
        map.__wadupCloseEventHover?.();
        map.__wadupSelectedPin?.classList.remove('wu-pin-selected');
        map.__wadupSelectedPin?.dispatchEvent(new Event('wadup-restack'));
        map.__wadupSelectedPin = null;
        map.__wadupSelectedVenueId = null;
        infoWindow.current?.close();
      });

      // Re-rank only when the map settles. bounds_changed fires repeatedly
      // during pan/zoom and rebuilding every pin while tiles load can make
      // Google Maps feel slow or unresponsive.
      map.addListener('bounds_changed', () => {
        map.__wadupMoving = true;
        map.__wadupCloseEventHover?.();
      });
      map.addListener('idle', () => {
        map.__wadupMoving = false;
        updateAreaRanks();
        queueMapLabelLayout(map);
        setFeedRevision(v => v + 1);
      });

      setMapReady(true);

      // Real Chattanooga venues (Google Places-sourced, see pages/api/places/sync.js)
      // load asynchronously — pins get dropped once the fetch resolves, same
      // fire-and-forget pattern as fetchTM() below.
      loadVenuesFromSupabase();

      // Fetch TM events
      setTimeout(() => fetchTM(), 300);
    };

    // Load Google Maps once; navigating back from a venue can leave an
    // in-flight script in the document, so reuse it instead of injecting a
    // second copy (which can invalidate the callback and break the map).
    if (window.google?.maps?.Map) {
      initMap();
    } else {
      if (!GMAPS_KEY) {
        setMapLoadError('Google Maps is not configured for this deployment.');
        return;
      }
      window.__wadupMapInit = initMap;
      window.gm_authFailure = () => {
        setMapLoadError('Google Maps rejected this website or API key. Check the Maps JavaScript API referrer restrictions for ' + window.location.hostname + '.');
        setShowSplash(false);
      };
      const existing = document.querySelector('script[data-wadup-maps="true"]');
      if (!existing) {
        const script = document.createElement('script');
        script.dataset.wadupMaps = 'true';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&callback=__wadupMapInit&v=weekly&loading=async`;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
          setMapLoadError('Google Maps could not download. Check the network connection and reload.');
          setShowSplash(false);
        };
        document.head.appendChild(script);
      }
    }

    // Geolocation can resolve after the map has initialized. Update the
    // existing marker directly; React state alone does not move a Google marker.
    if (navigator.geolocation) {
      const onPosition = pos => {
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        userLocationRef.current = location;
        setUserPos({ lat: location.lat, lng: location.lng });
        updateUserLocationMarker(location);
      };
      navigator.geolocation.getCurrentPosition(onPosition, () => {}, {
        enableHighAccuracy: true, timeout: 15000, maximumAge: 0,
      });
      const watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
        enableHighAccuracy: true, timeout: 20000, maximumAge: 10000,
      });
      locationWatchRef.current = watchId;
    }
  }, []);  // eslint-disable-line

  // ── Keep the map correctly sized when the sidebar / viewport changes ──
  const nudgeMap = useCallback(() => {
    const map = mapObj.current;
    if (!map || !window.google?.maps) return;
    const center = map.getCenter();
    window.google.maps.event.trigger(map, 'resize');
    if (center) map.setCenter(center);
  }, []);

  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    let timer;
    let lastWidth = 0, lastHeight = 0;
    const scheduleMapResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!element.isConnected || !element.clientWidth || !element.clientHeight) return;
        nudgeMap();
      }, 100);
    };
    // A sidebar, responsive layout, or browser zoom can change the map's
    // container size without firing window.resize.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const width = Math.round(rect.width), height = Math.round(rect.height);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width; lastHeight = height;
      scheduleMapResize();
    }) : null;
    observer?.observe(element);
    window.addEventListener('resize', scheduleMapResize);
    window.addEventListener('orientationchange', scheduleMapResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMapResize);
      window.removeEventListener('orientationchange', scheduleMapResize);
      clearTimeout(timer);
    };
  }, [nudgeMap]);

  // ── Chip change (mobile HUD's flat chip row) ── (also triggers the
  // loadSidebarLists effect above, via activeChip). No subcategory UI exists
  // on mobile, so any subcategory picked earlier on desktop is cleared here
  // — otherwise it'd keep silently narrowing the mobile chip's results.
  // Exactly one main category at a time; subcategory selections may be multiple.
  // First click selects a main category; subsequent clicks on that
  // category expand/collapse its subcategories. Only one menu stays open.
  const selectCategory = (catId) => {
    if (activeCategoryRef.current === catId) {
      setOpenDropdown(prev => prev === catId ? null : catId);
      return;
    }
    activeCategoryRef.current = catId;
    setActiveChip(catId);
    setOpenDropdown(null);
    filterPins();
  };
  const onChipClick = selectCategory;
  const onCategoryClick = selectCategory;
  const onSubcategoryClick = (catId, subcatId, e) => {
    e.stopPropagation();
    const previous = activeSubcategoryRef.current[catId] || [];
    const next = previous.includes(subcatId) ? previous.filter(id => id !== subcatId) : [...previous, subcatId];
    activeSubcategoryRef.current = { ...activeSubcategoryRef.current, [catId]: next };
    setSubcategoryByChip(activeSubcategoryRef.current);
    setActiveSubcategory(next);
    if (activeCategoryRef.current !== catId) {
      activeCategoryRef.current = catId;
      setActiveChip(catId);
    }
    filterPins();
  };

  // ── Day change ──
  const onDayClick = (iso) => {
    mapObj.current?.__wadupCloseEventHover?.();
    activeDateRef.current = iso;
    setActiveDate(iso);
    // Close the old event popup so it cannot display the previous day's shows.
    const selected = pinRegistry.current.get(mapObj.current?.__wadupSelectedVenueId);
    if (selected?.type === 'tm') infoWindow.current?.close();
    filterPins();
    if (mapObj.current) void fetchTM();
  };

  // ── Fly to venue ──
  const flyTo = (lng, lat) => {
    if (!mapObj.current) return;
    mapObj.current.panTo({ lat, lng });
    mapObj.current.setZoom(15);
  };

  // ── Search overlay — debounced 300ms across venue names/categories/cities/event names ──
  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchResults({ places: [], events: [], categories: [] }); return; }
    searchDebounceRef.current = setTimeout(() => {
      const places = venuesRef.current.filter(v =>
        v.live && (
          v.name.toLowerCase().includes(q) ||
          (v.city || '').toLowerCase().includes(q) ||
          (v.subcategory || '').toLowerCase().includes(q) ||
          venueCategories(v).some(c => (CATEGORY_LABELS[c] || '').toLowerCase().includes(q))
        )
      ).slice(0, 8);
      const events = tmEventsRef.current.filter(ev =>
        ev.name.toLowerCase().includes(q) || (ev.city || '').toLowerCase().includes(q)
      ).slice(0, 8);
      const categories = CATEGORY_CHIPS.filter(c => c.label.toLowerCase().includes(q));
      setSearchResults({ places, events, categories });
      setActiveResultIndex(0);
    }, 300);
    return () => clearTimeout(searchDebounceRef.current);
  }, [searchQuery]);

  // Flattened in Places → Events → Categories order so arrow-key navigation
  // and the visual grouping below always agree on index.
  const flatSearchResults = useMemo(() => [
    ...searchResults.places.map(item => ({ type: 'place', item })),
    ...searchResults.events.map(item => ({ type: 'event', item })),
    ...searchResults.categories.map(item => ({ type: 'category', item })),
  ], [searchResults]);

  const openSearch = () => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults({ places: [], events: [], categories: [] });
    setActiveResultIndex(0);
  };

  const selectSearchResult = (result) => {
    if (!result) return;
    if (result.type === 'place') {
      flyTo(result.item.lng, result.item.lat);
      const entry = pinRegistry.current.get(result.item.id);
      setTimeout(() => entry?.openPopup(), 450);
    } else if (result.type === 'event') {
      flyTo(result.item.lng, result.item.lat);
    } else if (result.type === 'category') {
      onChipClick(result.item.id);
    }
    closeSearch();
  };

  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveResultIndex(i => Math.min(i + 1, flatSearchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveResultIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectSearchResult(flatSearchResults[activeResultIndex]);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  };

  // ── Shared render helpers (used by both desktop sidebar & mobile HUD) ──
  const renderSearchTrigger = (containerClass) => (
    <button className={containerClass} onClick={openSearch}>
      🔍 Search places, events…
    </button>
  );

  const renderChips = (containerClass) => (
    <div className={containerClass}>
      {CATEGORY_CHIPS.filter(c => c.id !== 'must-see' || hasMustSeeInView || activeChip === 'must-see').map(c => (
        <button
          key={c.id}
          className={`chip${activeChip === c.id ? ' active' : ''}`}
          onClick={() => onChipClick(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  // Desktop-only replacement for renderChips' flat row — mobile's HUD still
  // uses renderChips('chips') untouched. A category only shows a ▼ arrow
  // once it actually has subcategories (see CATEGORY_CHIPS' comment).
  const renderDesktopCategoryList = () => (
    <div className="sidebar-categories">
      <div className="cat-list">
        {CATEGORY_CHIPS.filter(c => c.id !== 'must-see' || hasMustSeeInView || activeChip === 'must-see').map(c => {
          const hasSubcats = c.subcategories?.length > 0;
          const isActive = activeChip === c.id;
          const isOpen = openDropdown === c.id;
          return (
            <div key={c.id}>
              <button
                type="button"
                className={`cat-item${isActive ? ' active' : ''}`}
                aria-pressed={isActive}
                aria-expanded={hasSubcats ? isOpen : undefined}
                aria-label={`${c.label}: ${isActive ? (isOpen ? 'collapse subcategories' : 'expand subcategories') : 'select category'}`}
                onClick={() => onCategoryClick(c.id)}
                style={{ width: '100%', border: 0, textAlign: 'left', background: isActive ? '#FFFC00' : 'transparent', color: isActive ? '#000' : '#aaa', appearance: 'none', WebkitAppearance: 'none' }}
              >
                <span>{c.label}</span>
                {hasSubcats && <span className={`cat-arrow${isOpen ? ' open' : ''}`}>▼</span>}
              </button>
              {hasSubcats && (
                <div className={`subcat-list${isOpen ? ' open' : ''}`}>
                  {c.subcategories.map(sub => (
                    <button
                      type="button"
                      key={sub.id}
                      className={`subcat-item${isActive && (subcategoryByChip[c.id] || []).includes(sub.id) ? ' active' : ''}`}
                      aria-pressed={isActive && (subcategoryByChip[c.id] || []).includes(sub.id)}
                      onClick={(e) => onSubcategoryClick(c.id, sub.id, e)}
                      style={{ width: '100%', textAlign: 'left', border: 0 }}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderDayStrip = (containerClass) => (
    <div className={containerClass} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, width: '100%', padding: '10px 8px', boxSizing: 'border-box', overflow: 'visible' }}>
      {days.map(d => (
        <button
          key={d.iso}
          className={`day-btn${activeDate === d.iso ? ' active' : ''}`}
          style={{ minWidth: 0, width: '100%', paddingLeft: 0, paddingRight: 0, boxSizing: 'border-box' }}
          onClick={() => onDayClick(d.iso)}
        >
          <span className="day-name">{d.label}</span>
          <span className="day-num">{d.num}</span>
          {d.isToday && <div className="day-dot" />}
        </button>
      ))}
    </div>
  );

  // WADUP is a chronological happenings feed, not a popularity ranking.
  // A venue's ordinary listing never qualifies without a scheduled venue_events row.
  const wadupItems = useMemo(() => {
    const now = feedNow;
    const today = localIsoDate(new Date(now));
    const map = mapObj.current;
    const bounds = map?.getBounds?.();
    const inside = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
      (!bounds || bounds.contains(new window.google.maps.LatLng(Number(lat), Number(lng))));
    const items = [];
    for (const ev of tmEventsRef.current) {
      if (ev.dateStr !== activeDate || !inside(ev.lat, ev.lng)) continue;
      const normalized = normalizeTimeStr(ev.timeStr);
      const start = normalized ? new Date(activeDate + 'T' + normalized + ':00').getTime() : null;
      const end = start == null ? null : start + 3 * 60 * 60 * 1000;
      if (activeDate === today && end != null && end < now) continue;
      items.push({ id: ev.id, name: ev.name, venue: ev.city || ev.address || 'Ticketmaster', lat: ev.lat, lng: ev.lng,
        start, end, icon: ev.cat === 'sports' ? (ev.sportEmoji || '🏟️') : '🎟️', url: ev.url, live: start != null && end != null && start <= now && now <= end && activeDate === today });
    }
    for (const ev of venueEventsRef.current) {
      if ((ev.start_time || '').slice(0, 10) !== activeDate) continue;
      if (['happy_hour', 'specials'].includes(ev.event_type)) continue;
      const venue = venuesRef.current.find(v => v.id === ev.venue_id);
      if (!venue || venue.is_hidden || !venue.live || !inside(venue.lat, venue.lng)) continue;
      const start = ev.start_time ? new Date(ev.start_time.replace(' ', 'T')).getTime() : null;
      const end = ev.end_time ? new Date(ev.end_time.replace(' ', 'T')).getTime() : null;
      if (activeDate === today && end != null && end < now) continue;
      items.push({ id: 'venue_' + ev.venue_id + '_' + ev.start_time + '_' + ev.title,
        name: ev.title || EVENT_TYPE_LABEL[ev.event_type] || 'Special Event', venue: venue.name,
        lat: venue.lat, lng: venue.lng, start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null,
        icon: EVENT_TYPE_ICON[ev.event_type] || '🎉', live: activeDate === today && Number.isFinite(start) && start <= now && Number.isFinite(end) && now <= end });
    }
    return items.sort((a, b) => Number(b.live) - Number(a.live) ||
      (a.live && b.live ? (a.end ?? Infinity) - (b.end ?? Infinity) : (a.start ?? Infinity) - (b.start ?? Infinity)) ||
      a.name.localeCompare(b.name));
  }, [activeDate, feedRevision, feedNow, userPos, mapReady]);

  const renderWadupFeed = () => (
    <div className="wadup-feed" style={{ padding: '10px 16px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ color: '#fff', fontSize: 15 }}>{activeDate === localIsoDate() ? 'HAPPENING TODAY' : 'HAPPENING ' + activeDate}</strong>
        <span style={{ color: '#999', fontSize: 12 }}>{wadupItems.length} EVENTS</span>
      </div>
      {wadupItems.length === 0 && <div className="t-empty">No scheduled happenings in this area for this day.</div>}
      {wadupItems.map(item => (
        <button type="button" key={item.id} onClick={() => { flyTo(Number(item.lng), Number(item.lat)); }}
          style={{ display: 'flex', width: '100%', gap: 12, alignItems: 'center', textAlign: 'left', padding: '12px 10px', marginBottom: 8, background: '#151b27', border: '1px solid #2b3444', borderRadius: 12, color: '#fff', cursor: 'pointer' }}>
          <span style={{ fontSize: 25 }}>{item.icon}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 14 }}>{item.name}</strong>
            <span style={{ display: 'block', fontSize: 12, color: '#aeb6c3', marginTop: 4 }}>
              {item.venue}{item.start != null ? ' · ' + new Date(item.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ' · Time TBD'}
            </span>
            {item.live && <span style={{ display: 'inline-block', color: '#75e7a2', fontSize: 11, fontWeight: 700, marginTop: 4 }}>● LIVE NOW</span>}
          </span>
          <span style={{ color: '#b8c0cc' }}>›</span>
        </button>
      ))}
    </div>
  );

  const renderTrendingNowItems = () => (
    trendingNow.length === 0 ? (
      <div className="t-empty">{sidebarLoading ? 'Loading…' : 'Nothing trending right now'}</div>
    ) : trendingNow.map(v => (
      <div key={v.id} className="t-item" onClick={() => flyTo(v.lng, v.lat)}>
        <div className="t-icon">{venueEmoji(v)}</div>
        <div className="t-info">
          <div className="t-name">{v.name}</div>
          <div className="t-sub">{CATEGORY_LABELS[venueCategories(v)[0]] || v.category}</div>
          {trendingReasonBadge(v) && <div className="t-trend-badge">{trendingReasonBadge(v)}</div>}
        </div>
      </div>
    ))
  );

  const renderTopRankedItems = () => (
    topRanked.length === 0 ? (
      <div className="t-empty">{sidebarLoading ? 'Loading…' : 'No ranked venues in view'}</div>
    ) : topRanked.map((item) => {
      const rank = item._areaRank;
      const medal = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
      const rowClass = `t-item rank-${rank <= 3 ? rank : 'other'}`;

      if (item._type === 'tm') {
        const icon = item.cat === 'sports' ? (item.sportEmoji || '🏟️') : '🎟️';
        const dateDisplay = item.dateStr
          ? new Date(item.dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'Date TBD';
        return (
          <div key={item.id} className={rowClass} onClick={() => flyTo(item.lng, item.lat)}>
            <div className="t-rank">{medal} #{rank}</div>
            <div className="t-icon">{icon}</div>
            <div className="t-info">
              <div className="t-name">{item.name}</div>
              <div className="t-sub">📅 {dateDisplay}{item.price ? ` · ${item.price}` : ''}</div>
            </div>
          </div>
        );
      }

      return (
        <div key={item.id} className={rowClass} onClick={() => flyTo(item.lng, item.lat)}>
          <div className="t-rank">{medal} #{rank}</div>
          <div className="t-icon">{venueEmoji(item)}</div>
          <div className="t-info">
            <div className="t-name">{item.name}</div>
          </div>
          {(item.weighted_rating_count || 0) > 0 && <div className="t-rating">⭐ {(item.weighted_rating || 0).toFixed(1)}/10</div>}
        </div>
      );
    })
  );

  const renderSidebarLists = () => (
    <>
      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-title-dot" />
          🔥 Trending Now
        </div>
        <div className="panel-radius">{trendingNow.length}</div>
      </div>
      <div className="trending-list sidebar-scroll-list">
        {renderTrendingNowItems()}
      </div>

      <div className="sidebar-divider" />

      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-title-dot" />
          🏆 Top 10
        </div>
        <div className="panel-radius">
          {activeSubcategory
            ? CATEGORY_CHIPS.find(c => c.id === activeChip)?.subcategories.find(s => s.id === activeSubcategory)?.label
            : CATEGORY_CHIPS.find(c => c.id === activeChip)?.label || 'All'}
        </div>
      </div>
      <div className="trending-list sidebar-scroll-list">
        {renderTopRankedItems()}
      </div>
    </>
  );

  return (
    <>
      <Head>
        <title>WadUp — What&apos;s up near you</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="description" content="Discover live events, nightlife, and sports near you in real time." />
        {/* The icon <link> lives in _app.js so every route gets it. There is
            no /favicon.ico in public/, which is what the 404 was. */}
      </Head>

      {/* ── Splash screen ── */}
      <div className={`splash${showSplash ? '' : ' splash-hidden'}`}>
        <div className="splash-rays" />
        <div className="splash-orb" />
        <div className="splash-content">
          <h1 className="splash-logo">WadUp</h1>
          <p className="splash-subtitle">Events · Nightlife · Sports</p>
          <button className="splash-btn" onClick={() => setShowSplash(false)}>
            Explore the Map
          </button>
        </div>
      </div>

      {/* ── Add to home screen banner (mobile) ── */}
      {showAddBanner && (
        <div
          className="add-banner"
          role="button"
          tabIndex={0}
          onClick={onAddBannerTap}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onAddBannerTap(); }}
        >
          <span className="add-banner-text">Add WadUp to your home screen 📲 — Tap for instructions</span>
          <button
            className="add-banner-close"
            onClick={(e) => { e.stopPropagation(); dismissAddBanner(); }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Add to home screen instructions modal ── */}
      {showInstallModal && (
        <div className="install-modal-backdrop" onClick={() => setShowInstallModal(false)}>
          <div className="install-modal" onClick={(e) => e.stopPropagation()}>
            <div className="install-modal-header">
              <span>Add WadUp to Your Home Screen</span>
              <button
                className="install-modal-close"
                onClick={() => setShowInstallModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="install-modal-body">
              {installPlatform === 'ios' ? (
                <>
                  <div className="install-step">
                    <span className="install-step-icon">📤</span>
                    <span>Tap the <strong>Share</strong> button (⎋↑) at the bottom of your browser</span>
                  </div>
                  <div className="install-arrow">⬇️</div>
                  <div className="install-step">
                    <span className="install-step-icon">➕</span>
                    <span>Then tap <strong>Add to Home Screen</strong></span>
                  </div>
                </>
              ) : installPlatform === 'android' ? (
                <>
                  <div className="install-step">
                    <span className="install-step-icon">⋮</span>
                    <span>Tap the <strong>three dots menu</strong> in the top right</span>
                  </div>
                  <div className="install-step">
                    <span className="install-step-icon">➕</span>
                    <span>Then tap <strong>Add to Home Screen</strong></span>
                  </div>
                </>
              ) : (
                <div className="install-step">
                  <span className="install-step-icon">📲</span>
                  <span>Open your browser menu and look for <strong>Add to Home Screen</strong></span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Search overlay ── */}
      {searchOpen && (
        <div className="search-overlay" onClick={closeSearch}>
          <div className="search-panel" onClick={(e) => e.stopPropagation()}>
            <div className="search-input-row">
              <span className="search-input-icon">🔍</span>
              <input
                ref={searchInputRef}
                className="search-input"
                type="text"
                placeholder="Search places, events, categories…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
              />
              <button className="search-close" onClick={closeSearch} aria-label="Close search">✕</button>
            </div>

            <div className="search-results">
              {!searchQuery.trim() ? (
                <div className="search-hint">Start typing to search…</div>
              ) : flatSearchResults.length === 0 ? (
                <div className="search-hint">No matches for &ldquo;{searchQuery}&rdquo;</div>
              ) : (
                <>
                  {searchResults.places.length > 0 && (
                    <div className="search-group">
                      <div className="search-group-title">Places</div>
                      {searchResults.places.map((p, i) => (
                        <div
                          key={p.id}
                          className={`search-result${i === activeResultIndex ? ' active' : ''}`}
                          onMouseEnter={() => setActiveResultIndex(i)}
                          onClick={() => selectSearchResult({ type: 'place', item: p })}
                        >
                          <span className="search-result-icon">📍</span>
                          <div className="search-result-text">
                            <div className="search-result-name">{p.name}</div>
                            <div className="search-result-sub">{CATEGORY_LABELS[venueCategories(p)[0]] || p.category} · {p.city}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {searchResults.events.length > 0 && (
                    <div className="search-group">
                      <div className="search-group-title">Events</div>
                      {searchResults.events.map((ev, i) => {
                        const idx = searchResults.places.length + i;
                        return (
                          <div
                            key={ev.id}
                            className={`search-result${idx === activeResultIndex ? ' active' : ''}`}
                            onMouseEnter={() => setActiveResultIndex(idx)}
                            onClick={() => selectSearchResult({ type: 'event', item: ev })}
                          >
                            <span className="search-result-icon">{ev.cat === 'sports' ? (ev.sportEmoji || '🏟️') : '🎟️'}</span>
                            <div className="search-result-text">
                              <div className="search-result-name">{ev.name}</div>
                              <div className="search-result-sub">{ev.city}{ev.state ? `, ${ev.state}` : ''}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {searchResults.categories.length > 0 && (
                    <div className="search-group">
                      <div className="search-group-title">Categories</div>
                      {searchResults.categories.map((c, i) => {
                        const idx = searchResults.places.length + searchResults.events.length + i;
                        return (
                          <div
                            key={c.id}
                            className={`search-result${idx === activeResultIndex ? ' active' : ''}`}
                            onMouseEnter={() => setActiveResultIndex(idx)}
                            onClick={() => selectSearchResult({ type: 'category', item: c })}
                          >
                            <span className="search-result-icon">🏷️</span>
                            <div className="search-result-text">
                              <div className="search-result-name">{c.label}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── App shell ── */}
      <div className={`app-root${showAddBanner ? ' banner-open' : ''}`}>

        {/* Desktop sidebar */}
        <aside
          className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}
          onTransitionEnd={(e) => { if (e.propertyName === 'width') nudgeMap(); }}
        >
          <div className="sidebar-header">
            <div aria-hidden="true" />
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed(v => !v)}
              aria-label="Toggle sidebar"
            >
              {sidebarCollapsed ? '›' : '‹'}
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {renderDayStrip('sidebar-days')}
            <button type="button" onClick={() => { if (activeChip === 'wadup') { setWadupFeedExpanded(v => !v); } else { activeCategoryRef.current = 'wadup'; setActiveChip('wadup'); setWadupFeedExpanded(true); setOpenDropdown(null); filterPins(); } }}
              aria-label="WADUP happenings" aria-pressed={activeChip === 'wadup'}
              style={{ display: 'block', width: '100%', textAlign: 'center', border: 0, background: 'radial-gradient(ellipse at 50% 100%, #055b70 0%, #00313e 42%, #00101b 80%)', padding: '15px 12px 18px', cursor: 'pointer', color: '#e9ffff', fontSize: 46, letterSpacing: 3, fontWeight: 1000, lineHeight: 1.2, textShadow: '0 0 6px #3ef5ff, 0 0 18px #00d9f5, 0 0 32px #00b7dc', fontFamily: 'Impact, Arial Narrow, sans-serif' }}>WADUP</button>
            {activeChip === 'wadup' && wadupFeedExpanded && renderWadupFeed()}
            {renderDesktopCategoryList()}
          </div>
        </aside>

        {/* Map stage — full screen on desktop, phone mockup on mobile */}
        <div className="map-frame">
          <div ref={mapRef} id="map" />
          {(pinEdit || pinError && new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').has('placePin')) && (
            <div style={{position:'absolute',top:12,left:12,right:12,zIndex:100,padding:14,borderRadius:12,background:'#061420',color:'#fff',display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:12,boxShadow:'0 4px 20px #0008'}}>
              <div><strong>📍 Place pin · {pinEdit?.name || 'WADUP'}</strong><div style={{fontSize:12,marginTop:5}}>Click anywhere on this map or drag the red pin. Save when it's in the right place.</div>{pinPosition && <div style={{fontSize:11,marginTop:4}}>{pinPosition.lat.toFixed(6)}, {pinPosition.lng.toFixed(6)}</div>}{pinError && <div role="alert" style={{color:'#ff9aa8',marginTop:5}}>{pinError}</div>}</div>
              <div style={{display:'flex',gap:8}}><button type="button" onClick={()=>window.location.assign('/venue/' + encodeURIComponent(pinEdit?.id || new URLSearchParams(window.location.search).get('placePin')) + '?edit=1')} style={{padding:'10px 14px',borderRadius:8}}>Cancel</button><button type="button" disabled={!pinEdit || !pinPosition || pinBusy} onClick={saveMapPin} style={{padding:'10px 14px',borderRadius:8,background:'#fff500',color:'#111',fontWeight:800}}>{pinBusy ? 'Saving…' : 'Save pin location'}</button></div>
            </div>
          )}

          {mapLoadError && <div role="alert" style={{position:'absolute',top:20,left:20,right:20,zIndex:20,padding:18,borderRadius:12,background:'#071522',color:'#fff',border:'1px solid #00c7e8',maxWidth:600,margin:'auto'}}>
            <strong>Map unavailable</strong><p>{mapLoadError}</p><button type="button" onClick={()=>window.location.reload()} style={{padding:'9px 16px',background:'#00c7e8',border:0,borderRadius:8}}>Retry map</button>
          </div>}
          {!mapReady && !mapLoadError && !showSplash && (
            <div className="map-loading">
              <div className="cover-spin" />
            </div>
          )}

          <button
            className="right-sidebar-toggle"
            onClick={() => setRightSidebarOpen(v => !v)}
            aria-label="Account"
          >
            {profile ? (profile.username || '?').slice(0, 1).toUpperCase() : '👤'}
          </button>

          {/* Mobile HUD */}
          <div className="hud">

            {renderDayStrip('day-strip')}
            <button type="button" onClick={() => { activeCategoryRef.current = 'wadup'; setActiveChip('wadup'); filterPins(); }} aria-label="WADUP happenings" style={{ display: 'block', width: '100%', background: 'radial-gradient(ellipse at 50% 100%, #055b70, #00101b 80%)', color: '#e9ffff', textShadow: '0 0 7px #3ef5ff, 0 0 22px #00c7f2', fontSize: 30, fontWeight: 1000, fontFamily: 'Impact, Arial Narrow, sans-serif', border: 0, padding: 8 }}>WADUP</button>
            {renderChips('chips')}

            <div className={`trending-panel${sheetExpanded ? ' expanded' : ''}`}>
              <div
                className="panel-drag-zone"
                onTouchStart={onSheetTouchStart}
                onTouchMove={onSheetTouchMove}
                onTouchEnd={onSheetTouchEnd}
              >
                <div className="panel-handle" onClick={() => setSheetExpanded(v => !v)} />
              </div>
              <div className="trending-panel-scroll">
                {activeChip === 'wadup' ? renderWadupFeed() : null}
              </div>
            </div>


          </div>

          {mapPhotoVenue && session && <MapCoverEditor venue={mapPhotoVenue} session={session} onClose={()=>setMapPhotoVenue(null)} onSaved={(updated)=>{
            venuesRef.current=venuesRef.current.map(v=>v.id===updated.id?{...v,...updated}:v);
            setMapPhotoVenue(null);
            infoWindow.current?.close();
            setFeedRevision(n=>n+1);
            filterPinsRef.current?.();
          }}/>} 
          {editPanelVenue && (
            <AdminEditPanel
              venue={editPanelVenue}
              relocateTarget={relocateTarget}
              relocating={relocating}
              onStartRelocate={startRelocate}
              onCancelRelocate={cancelRelocate}
              onClose={closeEditPanel}
              onSave={saveEditPanelVenue}
              onScheduleRequest={(payload) => authedFetchIndex('/api/admin/venue-schedule', payload)}
              onDelete={deleteEditPanelVenue}
            />
          )}

          {mapActionError && (
            <div className="map-action-toast map-action-toast-error" onClick={() => setMapActionError('')}>⚠️ {mapActionError}</div>
          )}
          {mapActionSuccess && (
            <div className="map-action-toast map-action-toast-success" onClick={() => setMapActionSuccess('')}>✅ {mapActionSuccess}</div>
          )}
        </div>{/* /map-frame */}
      </div>{/* /app-root */}

      <AuthSidebar
        open={rightSidebarOpen}
        onClose={() => setRightSidebarOpen(false)}
        session={session}
        profile={profile}
      />
    </>
  );
}

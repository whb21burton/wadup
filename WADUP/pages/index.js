import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  CATEGORY_CHIPS, CATEGORY_LABELS, EMOJI_OPTIONS,
  isVenueEligible, getVenueBadges, effectiveRating, effectiveRatingCount, hasWadupRating,
  venueMatchesChip, venueCategories,
  tmSegmentToCat, tmSportEmoji, TM_REGIONS
} from '../lib/data';
import { getTrendingVenues, getBestRated, getScheduleTrendingVenues, rankVenuesInBounds } from '../lib/rankings';
import { supabase } from '../lib/supabase';
import { getAdminRole } from '../lib/admin';
import AuthSidebar from '../components/AuthSidebar';
import AdminEditPanel from '../components/AdminEditPanel';



const GMAPS_KEY = process.env.NEXT_PUBLIC_GMAPS_KEY || 'AIzaSyBoXf6UAa_SckH9gxfbiOK9OPpaySNH76w';
const TM_AFFILIATE_ID = process.env.NEXT_PUBLIC_TM_AFFILIATE_ID || 'YOUR_AFFILIATE_ID';

// ── Append Ticketmaster affiliate tracking to an outbound ticket URL ──
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

const CATEGORY_ICONS = { events: '🎵', nightlife: '🍸', restaurant: '🍔', sports: '🏟️', outdoors: '🌳', activities: '🎳' };

// Popups are built as raw HTML strings for Google's InfoWindow — escape any
// text that ultimately comes from an API response or (eventually) user input.
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Day strip helpers ──
function buildDays() {
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const today = new Date();
  return Array.from({length:10}, (_,i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    return {
      label: days[d.getDay()],
      num: d.getDate(),
      iso: d.toISOString().slice(0,10),
      isToday: i === 0,
    };
  });
}

// ── "🔥 Trending Now" / "🏆 Top 10" sidebar helpers ──
// A venue's pin/card icon always reflects its *primary* (first) category —
// see venueCategories() in lib/data.js for the categories[]-with-category
// fallback this reads from.
function venueEmoji(v) {
  return v.custom_emoji || CATEGORY_ICONS[venueCategories(v)[0]] || '📍';
}

const EVENT_TYPE_ICON  = { live_music: '🎵', trivia: '🧠', happy_hour: '⏰', specials: '🏷️', activities: '🎳', sports_game: '🏟️', event: '🎫' };
const EVENT_TYPE_LABEL = { live_music: 'Live Music', trivia: 'Trivia', happy_hour: 'Happy Hour', specials: 'Specials', activities: 'Activities', sports_game: 'Game', event: 'Event' };

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
  const infoWindow   = useRef(null);
  const mapMarkers   = useRef({});
  const tmMarkers    = useRef({});
  const overlays     = useRef({});
  const tmEventsRef  = useRef([]);
  const venuesRef    = useRef([]);
  const trendingVenueIds = useRef(new Set());
  const bestRatedVenueIds = useRef(new Set());
  const eventVenueIdsTodayRef = useRef(new Set());
  const mapInitStarted = useRef(false);
  const filterPinsRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const searchInputRef = useRef(null);

  // Spider fan-out (overlapping pins)
  const pinRegistry   = useRef(new Map());  // id -> { id, type, marker, overlay, el, lat, lng, chipVisible, openPopup }
  const spiderStateRef = useRef(null);      // { ids: Set, entries, legsOverlay, onCollapse } | null
  const popupCloseTimer = useRef(null);     // desktop hover: pending delayed-close timeout for the InfoWindow

  const [userPos,        setUserPos]        = useState({lat:35.0456, lng:-85.3096});
  const [activeChip,     setActiveChip]     = useState('all');
  const [activeDate,     setActiveDate]     = useState(new Date().toISOString().slice(0,10));
  // filterPins reads these refs, not the state above, so it always sees the
  // current value regardless of when its own closure was created — the
  // state setters below update the ref SYNCHRONOUSLY, in the same click
  // handler, rather than waiting a render cycle for a useEffect to catch up.
  const activeCategoryRef = useRef('all');
  const activeDateRef = useRef(new Date().toISOString().slice(0,10));
  const [trendingNow,    setTrendingNow]    = useState([]);
  const [topRanked,      setTopRanked]      = useState([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [mapReady,       setMapReady]       = useState(false);
  const [showSplash,     setShowSplash]     = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
      .select('*')
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
  const loadSidebarLists = useCallback(async (chip) => {
    setSidebarLoading(true);
    try {
      const nowList = await getScheduleTrendingVenues(supabase, chip, 'Chattanooga');
      setTrendingNow(nowList);
    } catch (e) {
      /* sidebar lists are a nice-to-have — leave whatever was showing */
    }
    setSidebarLoading(false);
  }, []);

  useEffect(() => { loadSidebarLists(activeChip); }, [activeChip, loadSidebarLists]);

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

    console.log('[FILTER] chip:', chip, 'date:', date);
    console.log('[FILTER] venue count:', Object.keys(mapMarkers.current).length);
    console.log('[FILTER] tm count:', Object.keys(tmMarkers.current).length);

    // A chip/date change supersedes whatever fan-out was showing — collapse
    // it first so a pin doesn't end up stuck at its spiderfied offset while
    // also being hidden/shown by the filter below.
    collapseSpiderfy();

    Object.entries(mapMarkers.current).forEach(([id, entry]) => {
      const venue = venuesRef.current.find(v => v.id === id);
      if (!venue) {
        console.log('[FILTER] venue not found for id:', id);
        return;
      }
      const show = venueMatchesChip(chip, venue);
      // pinRegistry's own chipVisible flag is kept in sync too — findNearbyPins
      // (the spiderfy fan-out) checks a pin's live map state to decide what's
      // "hidden by the active filter", so this has to stay accurate even
      // though this function no longer routes through it to apply visibility.
      const registryEntry = pinRegistry.current.get(id);
      if (registryEntry) registryEntry.chipVisible = show;
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
      const ev = tmEventsRef.current.find(e => e.id === id);
      if (!ev) return;
      const catMatch  = chip === 'all' || ev.cat === chip;
      const dateMatch = !date || ev.dateStr === date;
      const show = catMatch && dateMatch;
      const registryEntry = pinRegistry.current.get(id);
      if (registryEntry) registryEntry.chipVisible = show;
      entry.marker.setMap(show ? map : null);
      if (entry.overlay) entry.overlay.setMap(show ? map : null);
    });

    updateAreaRanks();
  }, []);

  useEffect(() => { filterPinsRef.current = filterPins; }, [filterPins]);

  // Ranks whatever venues are currently inside the map viewport by
  // weighted_rating — drives both the #N label baked into a pin's name and
  // the sidebar's "🏆 Top 10" list, which both need this same
  // viewport-relative ranking (not a city-wide one). Called from filterPins
  // (covers chip changes and any point pins get (re)dropped) and separately
  // from the map's own 'bounds_changed' listener (panning/zooming changes
  // what's "in bounds" without touching the chip filter at all).
  const updateAreaRanks = useCallback(() => {
    const map = mapObj.current;
    if (!map) return;
    const bounds = map.getBounds();
    const chip = activeCategoryRef.current;

    const inBounds = venuesRef.current.filter(v => {
      if (!v.live) return false;
      if (!bounds) return true;
      return bounds.contains(new window.google.maps.LatLng(v.lat, v.lng));
    });

    const ranked = rankVenuesInBounds(inBounds, chip);
    const rankedIds = new Set(ranked.filter(v => v._areaRank <= 10).map(v => v.id));

    pinRegistry.current.forEach((entry, id) => {
      if (entry.type !== 'venue') return;
      const nameEl = entry.el?.querySelector('.wu-name');
      if (!nameEl) return;
      const venue = venuesRef.current.find(v => v.id === id);
      if (!venue) return;
      const rankedMatch = ranked.find(v => v.id === id);
      nameEl.textContent = rankedMatch && rankedIds.has(id) ? `#${rankedMatch._areaRank} ${venue.name}` : venue.name;
    });

    setTopRanked(ranked.slice(0, 10));
  }, []);

  // ── WuOverlay class factory ── anchor 'bottom' = pin (tail points at the
  // coordinate); anchor 'center' = bubble centered directly on the coordinate.
  function makeOverlay(pos, el, map, anchor = 'bottom') {
    const base = anchor === 'center' ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)';
    const overlay = new window.google.maps.OverlayView();
    overlay.onAdd = function() {
      this.getPanes().overlayMouseTarget.appendChild(el);
    };
    overlay.draw = function() {
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(pos);
      if (!pt) return;
      // A spiderfied pin carries a temporary fan-out offset in its dataset —
      // reapplied here so it survives any map-triggered redraw.
      const dx = el.dataset.spiderDx || 0;
      const dy = el.dataset.spiderDy || 0;
      el.style.position  = 'absolute';
      el.style.left      = pt.x + 'px';
      el.style.top       = pt.y + 'px';
      el.style.transform = `${base} translate(${dx}px, ${dy}px)`;
    };
    overlay.onRemove = function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    overlay.setMap(map);
    return overlay;
  }

  // ── Spiderfy: fan overlapping pins out in a circle so each is tappable ──
  function findNearbyPins(clickedEntry) {
    const map = mapObj.current;
    const proj = clickedEntry.overlay.getProjection();
    if (!map || !proj) return [clickedEntry];
    const clickedPt = proj.fromLatLngToDivPixel(new window.google.maps.LatLng(clickedEntry.lat, clickedEntry.lng));
    const nearby = [];
    pinRegistry.current.forEach((entry) => {
      if (entry.marker.getMap() !== map) return; // hidden by the active chip/date filter
      const pt = proj.fromLatLngToDivPixel(new window.google.maps.LatLng(entry.lat, entry.lng));
      const dx = pt.x - clickedPt.x, dy = pt.y - clickedPt.y;
      if (Math.sqrt(dx * dx + dy * dy) <= 40) nearby.push(entry);
    });
    return nearby;
  }

  function createSpiderLegsOverlay(anchorEntry, legs) {
    const map = mapObj.current;
    const container = document.createElement('div');
    container.className = 'wu-spider-legs';
    legs.forEach(({ dx, dy }) => {
      const len   = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const leg = document.createElement('div');
      leg.className = 'wu-spider-leg';
      leg.style.width = len + 'px';
      leg.style.transform = `rotate(${angle}deg)`;
      container.appendChild(leg);
    });

    const pos = new window.google.maps.LatLng(anchorEntry.lat, anchorEntry.lng);
    const overlay = new window.google.maps.OverlayView();
    overlay.onAdd = function() { this.getPanes().overlayLayer.appendChild(container); };
    overlay.draw = function() {
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(pos);
      if (!pt) return;
      container.style.position = 'absolute';
      container.style.left = pt.x + 'px';
      container.style.top  = pt.y + 'px';
    };
    overlay.onRemove = function() { if (container.parentNode) container.parentNode.removeChild(container); };
    overlay.setMap(map);
    return overlay;
  }

  function collapseSpiderfy() {
    const state = spiderStateRef.current;
    if (!state) return;
    state.entries.forEach(entry => {
      entry.el.dataset.spiderDx = '0';
      entry.el.dataset.spiderDy = '0';
      entry.overlay.draw();
      const el = entry.el;
      setTimeout(() => el.classList.remove('wu-pin-spiderfied'), 300);
    });
    state.legsOverlay.setMap(null);
    spiderStateRef.current = null;
  }

  function spiderfy(entries) {
    const map = mapObj.current;
    if (!map || entries.length < 2) return;
    collapseSpiderfy();

    const n = entries.length;
    const radius = 80; // every fan-out leg is exactly the same length
    const legs = [];

    entries.forEach((entry, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const dx = radius * Math.cos(angle);
      const dy = radius * Math.sin(angle);
      entry.el.dataset.spiderDx = String(dx);
      entry.el.dataset.spiderDy = String(dy);
      entry.el.classList.add('wu-pin-spiderfied');
      entry.overlay.setMap(map);
      entry.overlay.draw();
      legs.push({ dx, dy });
    });

    const legsOverlay = createSpiderLegsOverlay(entries[0], legs);
    spiderStateRef.current = {
      ids: new Set(entries.map(e => e.id)),
      entries,
      legsOverlay,
    };
  }

  // ── Desktop hover popup: delayed close so the mouse can travel from the
  // pin into the popup itself without it flickering shut. ──
  function cancelPopupClose() {
    if (popupCloseTimer.current) {
      clearTimeout(popupCloseTimer.current);
      popupCloseTimer.current = null;
    }
  }
  function schedulePopupClose() {
    cancelPopupClose();
    popupCloseTimer.current = setTimeout(() => {
      infoWindow.current?.close();
      popupCloseTimer.current = null;
    }, 150);
  }

  // Shared entry point for both click and (desktop) hover on any pin.
  function handlePinInteraction(id) {
    const entry = pinRegistry.current.get(id);
    if (!entry) return;

    if (spiderStateRef.current && spiderStateRef.current.ids.has(id)) {
      entry.openPopup();
      return;
    }

    const nearby = findNearbyPins(entry);
    if (nearby.length > 1) {
      spiderfy(nearby);
      return;
    }
    entry.openPopup();
  }

  // ── Drop a venue pin ──
  const dropVenuePin = useCallback((v) => {
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
    const rating = effectiveRating(v);
    const ratingCount = effectiveRatingCount(v);
    const hasRating = rating != null && (ratingCount || 0) > 0;

    // Parks and golf courses get a plain, larger emoji marker instead of the
    // usual white pill — they read better on the map as a landmark icon than
    // as a name-bearing bubble, and there isn't a badge/rating worth cramming
    // onto them.
    const cats = venueCategories(v);
    const isParkPin = cats.includes('outdoors') && /park/i.test(v.name || '');
    const isGolfPin = cats.includes('activities') && (/golf/i.test(v.name || '') || /golf/i.test(v.subcategory || ''));
    const specialIcon = isParkPin ? '🌳' : isGolfPin ? '⛳' : null;

    const el = document.createElement('div');
    el.className = `wu-pin ${zoomClass}${specialIcon ? ' wu-pin-emoji' : ''}`;
    if (v.is_private) el.style.opacity = '0.5';

    if (specialIcon) {
      const iconSpan = document.createElement('span');
      iconSpan.className = 'wu-emoji-icon';
      iconSpan.textContent = specialIcon;
      el.appendChild(iconSpan);
    } else {
      const pill = document.createElement('div');
      pill.className = 'wu-pill';

      if (topBadge) {
        const badgeEl = document.createElement('span');
        badgeEl.className = topBadge.id === 'live' ? 'wu-badge wu-badge-live' : 'wu-badge';
        badgeEl.textContent = topBadge.icon;
        pill.appendChild(badgeEl);
      }

      const textWrap = document.createElement('div');
      textWrap.className = 'wu-pill-text';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'wu-name';
      nameSpan.textContent = v.name;
      textWrap.appendChild(nameSpan);

      if (hasRating) {
        const ratingSpan = document.createElement('span');
        ratingSpan.className = 'wu-rating';
        ratingSpan.textContent = `⭐ ${rating.toFixed(1)}`;
        textWrap.appendChild(ratingSpan);
      }

      pill.appendChild(textWrap);

      const tail = document.createElement('div');
      tail.className = 'wu-tail';

      el.appendChild(pill);
      el.appendChild(tail);
    }

    const ratingHtml = hasRating
      ? `<div class="popup-rating">⭐ ${rating.toFixed(1)} (${ratingCount} ${hasWadupRating(v) ? 'WadUp ' : 'Google '}review${ratingCount === 1 ? '' : 's'})</div>`
      : '';
    const badgesHtml = badges.length
      ? `<div class="popup-badges">${badges.map(b => `<span class="popup-badge">${b.icon} ${escapeHtml(b.label)}</span>`).join('')}</div>`
      : '';
    // Admin-only Edit button, built straight into the popup HTML string since
    // Google's InfoWindow content is raw HTML, not React — window.__wadupEditVenue
    // (defined once at map init) is the bridge back into React state. Same
    // markup serves both the click-triggered InfoWindow and the desktop
    // hover popup, since both go through this same iwHtml/openPopup path.
    const editBtnHtml = adminRoleRef.current
      ? `<button onclick="window.__wadupEditVenue('${v.id}')" class="popup-edit-venue-btn">✏️ Edit Venue</button>`
      : '';

    const iwHtml = `
      <div class="gm-iw">
        <div class="popup-name">${escapeHtml(v.name)}</div>
        <div class="popup-type">${escapeHtml(cats.map(c => CATEGORY_LABELS[c] || c).join(' · '))}${v.subcategory ? ' · ' + escapeHtml(v.subcategory) : ''}</div>
        ${ratingHtml}
        ${badgesHtml}
        <div class="popup-address">📍 ${escapeHtml(v.address)}</div>
        <a class="popup-view-reviews" href="/venue/${encodeURIComponent(v.id)}">View Reviews</a>
        ${editBtnHtml}
      </div>`;

    const pos    = new window.google.maps.LatLng(v.lat, v.lng);
    const marker = new window.google.maps.Marker({
      position: pos, map,
      icon: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', scaledSize: new window.google.maps.Size(1,1) },
      zIndex: topBadge ? 15 : 10,
    });
    const overlay = makeOverlay(pos, el, map, specialIcon ? 'center' : 'bottom');

    const openPopup = () => {
      infoWindow.current.setContent(iwHtml);
      infoWindow.current.open(map, marker);
    };

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePinInteraction(v.id);
    });
    // Park/golf emoji pins open on click only — no hover-triggered popup.
    if (!specialIcon) {
      el.addEventListener('mouseenter', () => {
        if (!window.matchMedia('(hover: hover)').matches) return;
        cancelPopupClose();
        handlePinInteraction(v.id);
      });
      el.addEventListener('mouseleave', () => {
        if (!window.matchMedia('(hover: hover)').matches) return;
        schedulePopupClose();
      });
    }

    mapMarkers.current[v.id] = { marker };
    overlays.current[v.id]   = overlay;

    const entry = { id: v.id, type: 'venue', marker, overlay, el, lat: v.lat, lng: v.lng, chipVisible: true, openPopup };
    pinRegistry.current.set(v.id, entry);
  }, [zoomClass]);

  // dropVenuePin bakes the "✏️ Edit Venue" popup button into a cached HTML
  // string at drop time, read from adminRoleRef — so a venue pin dropped
  // before the async admin-role lookup resolves would be stuck without the
  // button until something else happened to redraw it. Re-dropping every
  // live pin whenever adminRole changes closes that race.
  useEffect(() => {
    if (!mapReady) return;
    venuesRef.current.forEach(v => { if (v.live && isVenueEligible(v)) dropVenuePin(v); });
    filterPinsRef.current?.();
  }, [adminRole, mapReady, dropVenuePin]);

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

    const isSports = ev.cat === 'sports';
    const icon = isSports ? (ev.sportEmoji || '🏟️') : '🎟️';

    const el = document.createElement('div');
    el.className = `wu-pin ${zoomClass}`;

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
    metaSpan.textContent = `${icon}${ev.price ? ' ' + ev.price : ''}`;
    textWrap.appendChild(metaSpan);

    pill.appendChild(textWrap);

    const tail = document.createElement('div');
    tail.className = 'wu-tail wu-tail-tm';

    el.appendChild(pill);
    el.appendChild(tail);

    const dateDisplay = ev.dateStr
      ? new Date(ev.dateStr + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
      : 'Date TBD';

    const iwHtml = `
      <div class="gm-iw">
        <div class="popup-name">${icon} ${escapeHtml(ev.name)}</div>
        <div class="popup-type">${escapeHtml(CATEGORY_LABELS[ev.cat] || ev.cat)}${ev.city ? ' · ' + escapeHtml(ev.city) + ', ' + escapeHtml(ev.state) : ''}</div>
        <div class="popup-row">
          <span class="popup-stat">📅 ${dateDisplay}${ev.timeStr ? ' · '+ev.timeStr.slice(0,5) : ''}</span>
          ${ev.price ? `<span class="popup-stat popup-price">${escapeHtml(ev.price)}</span>` : ''}
        </div>
        ${ev.url ? `<a class="popup-link" href="${withTMAffiliateTracking(ev.url)}" target="_blank">🎟️ Get Tickets →</a>` : ''}
        <div class="popup-source">via Ticketmaster</div>
      </div>`;

    const pos    = new window.google.maps.LatLng(ev.lat, ev.lng);
    const marker = new window.google.maps.Marker({
      position: pos, map,
      icon: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', scaledSize: new window.google.maps.Size(1,1) },
      zIndex: 5,
    });

    const overlay = makeOverlay(pos, el, map);

    const openPopup = () => {
      infoWindow.current.setContent(iwHtml);
      infoWindow.current.open(map, marker);
    };

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePinInteraction(ev.id);
    });
    el.addEventListener('mouseenter', () => {
      if (!window.matchMedia('(hover: hover)').matches) return;
      cancelPopupClose();
      handlePinInteraction(ev.id);
    });
    el.addEventListener('mouseleave', () => {
      if (!window.matchMedia('(hover: hover)').matches) return;
      schedulePopupClose();
    });

    tmMarkers.current[ev.id] = { marker, overlay };

    const entry = { id: ev.id, type: 'tm', marker, overlay, el, lat: ev.lat, lng: ev.lng, chipVisible: true, openPopup };
    pinRegistry.current.set(ev.id, entry);
  }, [zoomClass]);

  // ── Fetch Ticketmaster (server-side proxy) ──
  const fetchTM = useCallback(async () => {
    const now    = new Date();
    const future = new Date(now.getTime() + 60*24*60*60*1000);
    const startDT = now.toISOString().replace(/\.\d{3}Z$/,'Z');
    const endDT   = future.toISOString().replace(/\.\d{3}Z$/,'Z');

    const seen = {};
    let completed = 0;
    const total = TM_REGIONS.length;

    const parseAndDrop = (data) => {
      const events = data._embedded?.events || [];
      events.forEach((ev) => {
        if (seen[ev.id]) return;
        seen[ev.id] = true;

        const ven     = ev._embedded?.venues?.[0] || {};
        const loc     = ven.location || {};
        const elng    = parseFloat(loc.longitude);
        const elat    = parseFloat(loc.latitude);
        if (isNaN(elng) || isNaN(elat)) return;

        const dateStr    = ev.dates?.start?.localDate || '';
        const timeStr    = ev.dates?.start?.localTime || '';
        const classification = ev.classifications?.[0] || {};
        const segment    = classification.segment?.name || '';
        const genre      = classification.genre?.name || '';
        const subGenre   = classification.subGenre?.name || '';
        const cat        = tmSegmentToCat(ev.classifications, ev.name);
        const img        = (ev.images?.find(i => i.ratio==='16_9' && i.width>500) || ev.images?.[0])?.url || '';
        let price = '';
        if (ev.priceRanges?.[0]) {
          const pr = ev.priceRanges[0];
          price = `$${Math.round(pr.min)}${pr.max && pr.max !== pr.min ? ` – $${Math.round(pr.max)}` : ''}`;
        }

        const norm = {
          id: 'tm_'+ev.id, _isTM: true,
          name: ev.name, cat, segment, genre, subGenre,
          address: ven.address?.line1 || '',
          city: ven.city?.name || '', state: ven.state?.stateCode || '',
          lng: elng, lat: elat,
          dateStr, timeStr, price, img, url: ev.url || '',
          live: true,
        };
        if (cat === 'sports') norm.sportEmoji = tmSportEmoji(norm);

        tmEventsRef.current.push(norm);
        dropTMPin(norm);
      });
    };

    const fetchRegion = async (region, i) => {
      await new Promise(r => setTimeout(r, i * 150));
      const qs = new URLSearchParams({
        size: 200, sort: 'date,asc', radius: 250, unit: 'miles',
        latlong: `${region.lat},${region.lng}`,
        startDateTime: startDT, endDateTime: endDT,
      });
      try {
        const res  = await fetch(`/api/tm?${qs}`);
        const data = await res.json();
        parseAndDrop(data);
      } catch (e) {
        /* region fetch failed — skip */
      } finally {
        completed++;
        if (completed === total || completed === 1) {
          filterPins();
        }
      }
    };

    // Stagger all regions
    tmEventsRef.current = [];
    TM_REGIONS.forEach((r, i) => fetchRegion(r, i));
  }, [dropTMPin, filterPins]);

  // ── Load real Chattanooga venues from Supabase (Google Places-sourced) ──
  const loadVenuesFromSupabase = useCallback(async () => {
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .eq('city', 'Chattanooga')
      .eq('is_hidden', false)
      .order('google_rating', { ascending: false });
    if (error || !data) return;

    // The rest of this file was written against the earlier mock venue shape
    // (`cat` instead of `category`, and a `live` flag every mock row hardcoded
    // to true) — map real rows into that same shape rather than touching every
    // call site.
    venuesRef.current = data.map(v => ({ ...v, live: true }));

    // Bulk-fetch today's venue_events once (rather than one query per pin) so
    // dropVenuePin can flag "🎫 Event Today" per venue via a plain Set lookup.
    const now = new Date();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd   = new Date(now); dayEnd.setUTCHours(23, 59, 59, 999);
    const { data: eventsToday } = await supabase
      .from('venue_events')
      .select('venue_id')
      .lte('start_time', dayEnd.toISOString())
      .gte('end_time', dayStart.toISOString());
    eventVenueIdsTodayRef.current = new Set((eventsToday || []).map(e => e.venue_id));

    // Top 10 by rating, area-wide — independent of whichever chip is active.
    // Freshly-synced venues have no WadUp reviews yet, so this needs the same
    // Google-rating fallback as the pins themselves, or every synced venue
    // would tie at 0 and "top 10" would be an arbitrary slice.
    trendingVenueIds.current = new Set(
      venuesRef.current
        .filter(v => v.live && isVenueEligible(v))
        .slice()
        .sort((a, b) => (effectiveRating(b) || 0) - (effectiveRating(a) || 0))
        .slice(0, 10)
        .map(v => v.id)
    );

    // Drop venue pins — ineligible venues (e.g. a restaurant with nothing on today) never get one
    venuesRef.current.forEach(v => { if (v.live && isVenueEligible(v)) dropVenuePin(v); });
    filterPinsRef.current?.();

    // Phase 2: layer real, city-scoped activity-based rankings (lib/rankings.js,
    // backed by the live Supabase checkins/reviews/saved_venues tables) onto
    // the naive same-session "top 10 by rating" badge above — additive, so
    // pins already dropped just get re-dropped (picking up the new badge)
    // once this async fetch resolves. Uses filterPinsRef (not the plain
    // closure) since this can resolve well after mount, by which point
    // activeChip/activeDate may have moved on.
    const citiesOnMap = [...new Set(venuesRef.current.map(v => v.city).filter(Boolean))];
    Promise.all(citiesOnMap.map(city => Promise.all([getTrendingVenues(city, 10), getBestRated(city, 10)])))
      .then(perCityResults => {
        let changed = false;
        perCityResults.forEach(([trendList, ratedList]) => {
          trendList.forEach(v => { if (!trendingVenueIds.current.has(v.id)) { trendingVenueIds.current.add(v.id); changed = true; } });
          ratedList.forEach(v => { if (!bestRatedVenueIds.current.has(v.id)) { bestRatedVenueIds.current.add(v.id); changed = true; } });
        });
        if (!changed) return;
        venuesRef.current.forEach(v => { if (v.live && isVenueEligible(v)) dropVenuePin(v); });
        filterPinsRef.current?.();
      })
      .catch(() => { /* rankings are a nice-to-have — pins already show without them */ });
  }, [dropVenuePin]);

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
  }, []);

  const flashMapSuccess = useCallback((msg) => {
    setMapActionSuccess(msg);
    setTimeout(() => setMapActionSuccess(s => (s === msg ? '' : s)), 2500);
  }, []);

  // Used by AdminEditPanel's own Delete button, which already confirms
  // internally — no confirm dialog here.
  const deleteVenueViaApi = useCallback(async (venue) => {
    await authedFetchIndex('/api/admin/delete-venue', { venueId: venue.id });
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
    cancelRelocate();
    setRelocateTarget(null);
    setEditPanelVenue(venue);
  }, [cancelRelocate]);

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
      // touched until Save is clicked in the panel.
      dropVenuePin({ ...targetVenue, lat: newLat, lng: newLng, live: true });
      filterPinsRef.current?.();
    });
    relocateListenerRef.current = listener;
  }, [editPanelVenue, cancelRelocate, dropVenuePin]);

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
      dropVenuePin(updated);
      filterPinsRef.current?.();
    }
    closeEditPanel();
  }, [authedFetchIndex, editPanelVenue, flashMapSuccess, removePinFromMap, dropVenuePin, closeEditPanel]);

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
      if (!mapRef.current) return;

      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: userPos.lat, lng: userPos.lng },
        zoom: 13,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        styles: [
          { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.attraction', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.government', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.place_of_worship', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi.sports_complex', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        ],
      });

      mapObj.current     = map;
      infoWindow.current = new window.google.maps.InfoWindow({ maxWidth: 240 });

      // Bridge for the "✏️ Edit Venue" button embedded in a venue popup's raw
      // HTML string (see dropVenuePin's iwHtml) — an inline onclick="" handler
      // has no way to reach React state directly, so it calls this instead.
      window.__wadupEditVenue = (venueId) => {
        const venue = venuesRef.current.find(v => v.id === venueId);
        if (!venue) return;
        infoWindow.current.close();
        openEditPanel(venue);
      };

      // Desktop hover: keep the popup open while the mouse is over the popup
      // itself (not just the pin), and close it on a delay when it leaves both.
      window.google.maps.event.addListener(infoWindow.current, 'domready', () => {
        if (!window.matchMedia('(hover: hover)').matches) return;
        const bubble = document.querySelector('.gm-style-iw-a');
        if (!bubble) return;
        bubble.addEventListener('mouseenter', cancelPopupClose);
        bubble.addEventListener('mouseleave', schedulePopupClose);
      });

      // User dot
      new window.google.maps.Marker({
        position: { lat: userPos.lat, lng: userPos.lng },
        map,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 9, fillColor:'#4285F4', fillOpacity:1,
          strokeColor:'#fff', strokeWeight:2,
        },
        zIndex: 999,
      });

      // Zoom listener
      map.addListener('zoom_changed', () => {
        collapseSpiderfy();
        const z = map.getZoom();
        const zc = z < 7 ? 'zoom-far' : z < 11 ? 'zoom-mid' : 'zoom-near';
        setZoomClass(zc);
        document.querySelectorAll('.wu-pin').forEach(el => {
          el.classList.remove('zoom-far','zoom-mid','zoom-near');
          el.classList.add(zc);
        });
      });

      // Clicking/dragging the map background collapses any open spiderfy fan-out
      map.addListener('click', () => collapseSpiderfy());
      map.addListener('dragstart', () => collapseSpiderfy());

      // Panning/zooming changes which venues are "in bounds" for area
      // ranking without touching the chip filter at all, so this needs its
      // own listener rather than piggybacking on filterPins — debounced
      // since bounds_changed fires continuously during a drag/zoom gesture.
      let boundsChangeTimer = null;
      map.addListener('bounds_changed', () => {
        clearTimeout(boundsChangeTimer);
        boundsChangeTimer = setTimeout(() => updateAreaRanks(), 300);
      });

      setMapReady(true);

      // Real Chattanooga venues (Google Places-sourced, see pages/api/places/sync.js)
      // load asynchronously — pins get dropped once the fetch resolves, same
      // fire-and-forget pattern as fetchTM() below.
      loadVenuesFromSupabase();

      // Fetch TM events
      setTimeout(() => fetchTM(), 300);
    };

    // Load Google Maps script
    if (window.google?.maps) {
      initMap();
    } else {
      window.__wadupMapInit = initMap;
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&callback=__wadupMapInit&v=weekly`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    // Geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 }
      );
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
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(nudgeMap, 200);
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, [nudgeMap]);

  // ── Chip change ── (also triggers the loadSidebarLists effect above, via activeChip)
  const onChipClick = (chip) => {
    console.log('[CHIP] clicked:', chip);
    activeCategoryRef.current = chip;
    setActiveChip(chip);

    // Debug: log first 5 venues and their categories
    venuesRef.current.slice(0, 5).forEach(v => {
      console.log('[CHIP] venue:', v.name, 'categories:', v.categories, 'category:', v.category);
    });

    filterPins();
  };

  // ── Day change ──
  const onDayClick = (iso) => {
    activeDateRef.current = iso;
    setActiveDate(iso);
    filterPins();
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
      const categories = CATEGORY_CHIPS.filter(c => c.id !== 'all' && c.label.toLowerCase().includes(q));
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
      {CATEGORY_CHIPS.map(c => (
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

  const renderDayStrip = (containerClass) => (
    <div className={containerClass}>
      {days.map(d => (
        <button
          key={d.iso}
          className={`day-btn${activeDate === d.iso ? ' active' : ''}`}
          onClick={() => onDayClick(d.iso)}
        >
          <span className="day-name">{d.label}</span>
          <span className="day-num">{d.num}</span>
          {d.isToday && <div className="day-dot" />}
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
    ) : topRanked.map((v) => (
      <div key={v.id} className="t-item" onClick={() => flyTo(v.lng, v.lat)}>
        <div className={`t-rank${v._areaRank === 1 ? ' rank-gold' : v._areaRank === 2 ? ' rank-silver' : v._areaRank === 3 ? ' rank-bronze' : ''}`}>
          #{v._areaRank}
        </div>
        <div className="t-icon">{venueEmoji(v)}</div>
        <div className="t-info">
          <div className="t-name">{v.name}</div>
        </div>
        {(v.weighted_rating_count || 0) > 0 && <div className="t-rating">⭐ {(v.weighted_rating || 0).toFixed(1)}/10</div>}
      </div>
    ))
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
        <div className="panel-radius">{CATEGORY_LABELS[activeChip] || 'All'}</div>
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
        <link rel="icon" href="/favicon.ico" />
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
            <div className="sidebar-logo">WadUp</div>
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed(v => !v)}
              aria-label="Toggle sidebar"
            >
              {sidebarCollapsed ? '›' : '‹'}
            </button>
          </div>

          <div className="sidebar-topbar">
            {renderSearchTrigger('sidebar-search-trigger')}
            <Link href="/discover" className="sidebar-discover-btn">🔥 Discover</Link>
          </div>

          {renderChips('sidebar-chips')}
          {renderDayStrip('sidebar-days')}

          <div className="sidebar-trending">
            {renderSidebarLists()}
          </div>
        </aside>

        {/* Map stage — full screen on desktop, phone mockup on mobile */}
        <div className="map-frame">
          <div ref={mapRef} id="map" />

          {!mapReady && !showSplash && (
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

            {renderSearchTrigger('search-trigger')}
            {renderChips('chips')}
            {renderDayStrip('day-strip')}

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
                {renderSidebarLists()}
              </div>
            </div>

            <nav className="bottom-nav">
              <div className="bottom-nav-item active" aria-current="page">
                <span className="bottom-nav-icon">🗺️</span>
                <span className="bottom-nav-label">Map</span>
              </div>
              <Link href="/discover" className="bottom-nav-item">
                <span className="bottom-nav-icon">🔥</span>
                <span className="bottom-nav-label">Discover</span>
              </Link>
            </nav>
          </div>

          {editPanelVenue && (
            <AdminEditPanel
              venue={editPanelVenue}
              relocateTarget={relocateTarget}
              relocating={relocating}
              onStartRelocate={startRelocate}
              onClose={closeEditPanel}
              onSave={saveEditPanelVenue}
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

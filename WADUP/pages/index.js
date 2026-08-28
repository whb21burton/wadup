import { useEffect, useRef, useState, useCallback } from 'react';
import Head from 'next/head';
import {
  DEFAULT_VENUES, CATEGORY_CHIPS,
  isVenueEligible, getVenueBadges,
  tmSegmentToCat, tmSportEmoji, TM_REGIONS
} from '../lib/data';
import { supabase } from '../lib/supabase';
import AuthSidebar from '../components/AuthSidebar';

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

// Database venues never populate the Ticketmaster-only Events/Sports chips.
function venueMatchesChip(v, chip) {
  if (v.cat === 'events' || v.cat === 'sports') return false;
  return chip === 'all' || v.cat === chip;
}

// No bounds yet (map hasn't fired its first bounds_changed) — don't hide everything.
function isInBounds(bounds, lat, lng) {
  if (!bounds) return true;
  if (lat == null || lng == null) return false;
  return bounds.contains(new window.google.maps.LatLng(lat, lng));
}

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_CHIPS.map(c => [c.id, c.label]));
const CATEGORY_ICONS = { events: '🎵', nightlife: '🍸', sports: '🏟️', outdoors: '🌳', activities: '🎳' };

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

export default function WadUp() {
  const mapRef       = useRef(null);
  const mapObj       = useRef(null);
  const infoWindow   = useRef(null);
  const mapMarkers   = useRef({});
  const tmMarkers    = useRef({});
  const overlays     = useRef({});
  const tmEventsRef  = useRef([]);
  const venuesRef    = useRef([...DEFAULT_VENUES]);
  const trendingVenueIds = useRef(new Set());
  const mapInitStarted = useRef(false);
  const mapBoundsRef = useRef(null);
  const boundsDebounceRef = useRef(null);
  const renderTrendingRef = useRef(null);

  const [userPos,        setUserPos]        = useState({lat:35.0456, lng:-85.3096});
  const [activeChip,     setActiveChip]     = useState('all');
  const [activeDate,     setActiveDate]     = useState(new Date().toISOString().slice(0,10));
  const [trending,       setTrending]       = useState([]);
  const [tmLoading,      setTmLoading]      = useState(true);
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

  // ── Build trending list — scoped to what's currently in view on the map ──
  const renderTrending = useCallback((chipOverride, dateOverride, boundsOverride) => {
    const chip   = chipOverride ?? activeChip;
    const date   = dateOverride ?? activeDate;
    const bounds = boundsOverride ?? mapBoundsRef.current;
    const venues = venuesRef.current;
    const tmEvs  = tmEventsRef.current;

    const liveVenues = venues
      .filter(v => v.live && isVenueEligible(v) && venueMatchesChip(v, chip) && isInBounds(bounds, v.lat, v.lng))
      .map(v => ({ ...v, _isTM: false }))
      .sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0));

    const filteredTM = tmEvs
      .filter(ev =>
        (chip === 'all' || ev.cat === chip) &&
        (!date || ev.dateStr === date) &&
        isInBounds(bounds, ev.lat, ev.lng)
      )
      .sort((a, b) => (a.dateStr || '').localeCompare(b.dateStr || ''));

    const all = [...liveVenues, ...filteredTM].slice(0, 20);

    setTrending(all);
  }, [activeChip, activeDate]);

  // Keep a stable ref to the latest renderTrending so the one-time
  // bounds_changed listener (registered at map-mount) never calls a stale
  // closure holding an outdated activeChip/activeDate.
  useEffect(() => { renderTrendingRef.current = renderTrending; }, [renderTrending]);

  // ── Filter map pins ──
  const filterPins = useCallback((chipOverride, dateOverride) => {
    const chip = chipOverride ?? activeChip;
    const date = dateOverride ?? activeDate;
    const map  = mapObj.current;
    if (!map) return;

    venuesRef.current.forEach(v => {
      const m = mapMarkers.current[v.id];
      if (!m) return;
      const show = venueMatchesChip(v, chip);
      m.marker.setMap(show ? map : null);
      if (overlays.current[v.id]) overlays.current[v.id].setMap(show ? map : null);
    });

    tmEventsRef.current.forEach(ev => {
      const m = tmMarkers.current[ev.id];
      if (!m) return;
      const catOk  = chip === 'all' || ev.cat === chip;
      const dateOk = !date || ev.dateStr === date;
      const show   = catOk && dateOk;
      m.marker.setMap(show ? map : null);
      if (m.overlay) m.overlay.setMap(show ? map : null);
    });
  }, [activeChip, activeDate]);

  // ── WuOverlay class factory ──
  function makeOverlay(pos, el, map) {
    const overlay = new window.google.maps.OverlayView();
    overlay.onAdd = function() {
      this.getPanes().overlayMouseTarget.appendChild(el);
    };
    overlay.draw = function() {
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(pos);
      if (!pt) return;
      el.style.position  = 'absolute';
      el.style.left      = pt.x + 'px';
      el.style.top       = pt.y + 'px';
      el.style.transform = 'translate(-50%, -100%)';
    };
    overlay.onRemove = function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    overlay.setMap(map);
    return overlay;
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
    if (!v.live) return;

    const badges   = getVenueBadges(v, trendingVenueIds.current.has(v.id));
    const topBadge = badges[0];
    const hasRating = v.total_ratings > 0;

    const el = document.createElement('div');
    el.className = `wu-pin ${zoomClass}`;

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
      ratingSpan.textContent = `⭐ ${v.average_rating.toFixed(1)}`;
      textWrap.appendChild(ratingSpan);
    }

    pill.appendChild(textWrap);

    const tail = document.createElement('div');
    tail.className = 'wu-tail';

    el.appendChild(pill);
    el.appendChild(tail);

    const ratingHtml = hasRating
      ? `<div class="popup-rating">⭐ ${v.average_rating.toFixed(1)} (${v.total_ratings} review${v.total_ratings === 1 ? '' : 's'})</div>`
      : '';
    const badgesHtml = badges.length
      ? `<div class="popup-badges">${badges.map(b => `<span class="popup-badge">${b.icon} ${escapeHtml(b.label)}</span>`).join('')}</div>`
      : '';

    const iwHtml = `
      <div class="gm-iw">
        <div class="popup-name">${escapeHtml(v.name)}</div>
        <div class="popup-type">${escapeHtml(CATEGORY_LABELS[v.cat] || v.cat)}${v.subcategory ? ' · ' + escapeHtml(v.subcategory) : ''}</div>
        ${ratingHtml}
        ${badgesHtml}
        <div class="popup-address">📍 ${escapeHtml(v.address)}</div>
        <a class="popup-view-reviews" href="/venue/${encodeURIComponent(v.id)}">View Reviews</a>
      </div>`;

    const pos    = new window.google.maps.LatLng(v.lat, v.lng);
    const marker = new window.google.maps.Marker({
      position: pos, map,
      icon: { url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', scaledSize: new window.google.maps.Size(1,1) },
      zIndex: topBadge ? 15 : 10,
    });

    const overlay = makeOverlay(pos, el, map);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      infoWindow.current.setContent(iwHtml);
      infoWindow.current.open(map, marker);
    });

    mapMarkers.current[v.id] = { marker };
    overlays.current[v.id]   = overlay;
  }, [zoomClass]);

  // ── Drop a TM pin ──
  const dropTMPin = useCallback((ev) => {
    const map = mapObj.current;
    if (!map) return;

    if (tmMarkers.current[ev.id]) {
      tmMarkers.current[ev.id].marker.setMap(null);
      if (tmMarkers.current[ev.id].overlay) tmMarkers.current[ev.id].overlay.setMap(null);
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

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      infoWindow.current.setContent(iwHtml);
      infoWindow.current.open(map, marker);
    });

    tmMarkers.current[ev.id] = { marker, overlay };
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
          setTmLoading(false);
          renderTrending();
          filterPins();
        }
      }
    };

    // Stagger all regions
    tmEventsRef.current = [];
    TM_REGIONS.forEach((r, i) => fetchRegion(r, i));
  }, [dropTMPin, renderTrending, filterPins]);

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
          { featureType:'poi', elementType:'labels', stylers:[{visibility:'off'}] },
          { featureType:'transit', elementType:'labels', stylers:[{visibility:'off'}] },
        ],
      });

      mapObj.current     = map;
      infoWindow.current = new window.google.maps.InfoWindow({ maxWidth: 240 });

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
        const z = map.getZoom();
        const zc = z < 7 ? 'zoom-far' : z < 11 ? 'zoom-mid' : 'zoom-near';
        setZoomClass(zc);
        document.querySelectorAll('.wu-pin').forEach(el => {
          el.classList.remove('zoom-far','zoom-mid','zoom-near');
          el.classList.add(zc);
        });
      });

      // Trending list tracks the current viewport — debounced so a drag/zoom
      // gesture doesn't re-filter on every intermediate frame.
      map.addListener('bounds_changed', () => {
        mapBoundsRef.current = map.getBounds();
        clearTimeout(boundsDebounceRef.current);
        boundsDebounceRef.current = setTimeout(() => {
          renderTrendingRef.current?.();
        }, 300);
      });

      setMapReady(true);

      // Top 10 by rating, area-wide — independent of whichever chip is active
      trendingVenueIds.current = new Set(
        venuesRef.current
          .filter(v => v.live && isVenueEligible(v))
          .slice()
          .sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0))
          .slice(0, 10)
          .map(v => v.id)
      );

      // Drop venue pins — ineligible venues (e.g. a restaurant with nothing on today) never get one
      venuesRef.current.forEach(v => { if (v.live && isVenueEligible(v)) dropVenuePin(v); });
      renderTrending();

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

  // ── Chip change ──
  const onChipClick = (chip) => {
    setActiveChip(chip);
    renderTrending(chip, activeDate);
    filterPins(chip, activeDate);
  };

  // ── Day change ──
  const onDayClick = (iso) => {
    setActiveDate(iso);
    renderTrending(activeChip, iso);
    filterPins(activeChip, iso);
  };

  // ── Fly to venue ──
  const flyTo = (lng, lat) => {
    if (!mapObj.current) return;
    mapObj.current.panTo({ lat, lng });
    mapObj.current.setZoom(15);
  };

  // ── Shared render helpers (used by both desktop sidebar & mobile HUD) ──
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

  const renderTrendingItems = () => (
    trending.length === 0 ? (
      <div className="t-empty">
        {tmLoading ? '🎟️ Loading events…' : 'Nothing found — try another category or date'}
      </div>
    ) : trending.map((item, idx) => {
      const icon = item._isTM
        ? (item.cat === 'sports' ? (item.sportEmoji || '🏟️') : '🎟️')
        : (getVenueBadges(item, trendingVenueIds.current.has(item.id))[0]?.icon || CATEGORY_ICONS[item.cat] || '📍');
      return (
        <div key={item.id} className="t-item" onClick={() => flyTo(item.lng, item.lat)}>
          <div className="t-rank">#{idx+1}</div>
          <div className="t-icon">{icon}</div>
          <div className="t-info">
            <div className="t-name">{item.name}</div>
            <div className="t-sub">{item.subcategory || CATEGORY_LABELS[item.cat] || item.cat} · {item.city}, {item.state}</div>
            {item._isTM && item.dateStr && (
              <div className="t-date">
                📅 {new Date(item.dateStr+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                {item.timeStr ? ' · '+item.timeStr.slice(0,5) : ''}
              </div>
            )}
          </div>
          <div className="t-meta">
            <div className="t-city">{item.city}{item.state ? ', ' + item.state : ''}</div>
            {item._isTM
              ? (item.price && <div className="t-date">{item.price}</div>)
              : (item.total_ratings > 0 && <div className="t-rating">⭐ {item.average_rating.toFixed(1)}</div>)
            }
          </div>
        </div>
      );
    })
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

          {renderChips('sidebar-chips')}
          {renderDayStrip('sidebar-days')}

          <div className="sidebar-trending">
            <div className="panel-header">
              <div className="panel-title">
                <div className="panel-title-dot" />
                Trending In View
              </div>
              <div className="panel-radius">
                🗺️ {tmLoading ? 'Loading…' : `${trending.length} found`}
              </div>
            </div>
            <div className="trending-list">
              {renderTrendingItems()}
            </div>
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
                <div className="panel-header">
                  <div className="panel-title">
                    <div className="panel-title-dot" />
                    Trending In View
                  </div>
                  <div className="panel-radius">
                    🗺️ In View{tmLoading ? ' · Loading…' : ` · ${trending.length} found`}
                  </div>
                </div>
              </div>
              <div className="trending-list">
                {renderTrendingItems()}
              </div>
            </div>
          </div>

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

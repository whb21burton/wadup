import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { CATEGORY_LABELS, venueCategories, formatTime } from '../../lib/data';
import { getBestRated } from '../../lib/rankings';
import AuthSidebar from '../../components/AuthSidebar';
import WriteReviewModal from '../../components/WriteReviewModal';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const EVENT_TYPE_ICONS = {
  live_music: '🎵',
  trivia:     '🧠',
  specials:   '🏷️',
  happy_hour: '⏰',
  dj:         '🎧',
  comedy:     '🎤',
  karaoke:    '🎙️',
  other:      '🎉',
};
const EVENT_TYPE_LABELS = {
  live_music: 'Live Music',
  trivia:     'Trivia',
  specials:   'Specials',
  happy_hour: 'Happy Hour',
  dj:         'DJ',
  comedy:     'Comedy',
  karaoke:    'Karaoke',
  other:      'Event',
};

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
  const [activitySchedule,setActivitySchedule]=useState([]);
  const [editingProfile,setEditingProfile]=useState(false);
  const [profileDraft,setProfileDraft]=useState({});
  const [editingActivity,setEditingActivity]=useState(null);
  const [editError,setEditError]=useState('');
  const [editBusy,setEditBusy]=useState(false);
  const [canManage,setCanManage]=useState(false);
  const [editRequested,setEditRequested]=useState(false);
  const [editSection,setEditSection]=useState(null);
  const [scheduleLoading,setScheduleLoading]=useState(false);
  const scheduleDays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const activityTypes=[['trivia','Trivia night'],['game_night','Game / bingo night'],['karaoke','Karaoke'],['live_music','Live music'],['special_event','Special event'],['happy_hour','Happy hour'],['food_special','Food / drink special'],['other','Other']];
  const blankActivity=()=>({title:'',kind:'trivia',recurrence:'weekly',weekdays:[],event_date:'',start_time:'',end_time:'',description:'',source_url:'',verified:false,is_active:true});


  const [profileTab,setProfileTab]=useState('reviews');
  const [calendarMonth,setCalendarMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);});
  const [calendarDay,setCalendarDay]=useState(()=>new Date().getDate());
  const calendarCells=useMemo(()=>{
    const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth();
    const offset=new Date(year,month,1).getDay();
    const days=new Date(year,month+1,0).getDate();
    return [...Array(offset).fill(null),...Array.from({length:days},(_,i)=>i+1)];
  },[calendarMonth]);
  const calendarEntries=useMemo(()=>{
    const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth();
    const days=new Date(year,month+1,0).getDate();
    const entries=[];
    for(let day=1;day<=days;day++){
      const date=new Date(year,month,day);
      const key=[year,String(month+1).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
      for(const item of activitySchedule){
        if(item.is_active===false)continue;
        if(item.recurrence==='weekly'?(item.weekdays||[]).map(Number).includes(date.getDay()):item.event_date?.slice(0,10)===key){
          entries.push({day,key,title:item.title,kind:item.kind,start:item.start_time?.slice(0,5),end:item.end_time?.slice(0,5),description:item.description,id:'activity-'+item.id});
        }
      }
      for(const ev of events){
        if(ev.start_time?.slice(0,10)===key){
          entries.push({day,key,title:ev.title,kind:ev.event_type,start:ev.start_time?.slice(11,16),end:ev.end_time?.slice(0,10)===key?ev.end_time?.slice(11,16):'',description:ev.description,id:'event-'+ev.id});
        }
      }
    }
    return entries.sort((a,b)=>a.day-b.day||(a.start||'').localeCompare(b.start||''));
  },[calendarMonth,activitySchedule,events]);

  const [sortMode,  setSortMode]  = useState('recent');
  const [rankings,  setRankings]  = useState({ trending: null, bestRated: null, localFavorite: false });

  const [session,  setSession]  = useState(null);
  const [profile,  setProfile]  = useState(null);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const [myLikes,     setMyLikes]     = useState(new Set());
  const [saved,        setSaved]       = useState(false);
  const [checkedIn,    setCheckedIn]   = useState(false);
  const [checkinCount, setCheckinCount]= useState(0);
  const [checkinError, setCheckinError]= useState('');
  const [currentFlame,   setCurrentFlame]   = useState(0);
  const [flameVoteCount, setFlameVoteCount] = useState(0);
  const [flameVoting,    setFlameVoting]    = useState(false);
  const [reviewerAdminIds, setReviewerAdminIds] = useState(new Set());
  const [reportedIds,  setReportedIds] = useState(new Set());
  const [shareCopied,  setShareCopied] = useState(false);

  // Snapshot of the latest session for code (like the view-tracking insert in
  // loadVenue) that wants "whoever's logged in right now" without making
  // loadVenue itself re-run — and therefore re-fetch everything and log a
  // duplicate view — every time auth state changes.
  const sessionRef = useRef(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

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
  useEffect(()=>{if(router.isReady)setEditRequested(router.query.edit==='1');},[router.isReady,router.query.edit]);
  const startEditing=useCallback((section='details')=>{
    if(!venue)return;
    setProfileDraft({name:venue.name||'',description:venue.description||'',phone:venue.phone||'',website:venue.website||'',cover_photo_url:venue.cover_photo_url||'',address:venue.address||'',categories:venueCategories(venue),subcategories:Array.isArray(venue.subcategories)?venue.subcategories:(venue.subcategory?[venue.subcategory]:[])});
    setEditSection(section);setEditingProfile(true);setEditError('');
  },[venue]);
  // The edit URL grants access to the pencil control; it never opens a full form automatically.
  useEffect(()=>{
    if(!id||!session?.access_token){setCanManage(false);return;}
    fetch('/api/admin/venue-permissions?venueId='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+session.access_token}})
      .then(r=>r.ok?r.json():{canManage:false}).then(d=>setCanManage(!!d.canManage)).catch(()=>setCanManage(false));
  },[id,session?.access_token]);
  const reloadActivities=useCallback(async()=>{
    if(!id)return;
    setScheduleLoading(true);
    try{const r=await fetch('/api/admin/venue-schedule?venueId='+encodeURIComponent(id));if(r.ok){const d=await r.json();setActivitySchedule(d.items||[]);}}catch(e){}finally{setScheduleLoading(false);}
  },[id]);
  useEffect(()=>{reloadActivities();},[reloadActivities]);
  const sendEdit=async(url,body)=>{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok)throw Error(d.error||'Unable to save');
    return d;
  };
  const saveInlineProfile=async()=>{
    setEditBusy(true);setEditError('');
    try{
      const result=await sendEdit('/api/admin/venue-profile',{venueId:id,updates:profileDraft});
      setVenue(result.venue);setEditingProfile(false);setEditSection(null);setEditRequested(false);
    }catch(e){setEditError(e.message);}finally{setEditBusy(false);}
  };
  const saveActivity=async(action,item)=>{
    setEditBusy(true);setEditError('');
    try{
      await sendEdit('/api/admin/venue-schedule',{venueId:id,action,item});
      setEditingActivity(null);await reloadActivities();
    }catch(e){setEditError(e.message);}finally{setEditBusy(false);}
  };


  // ── Fetch the venue + everything hanging off it ──
  const loadVenue = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);

    const { data: venueData, error: venueErr } = await supabase
      .from('venues').select('*').eq('id', id).eq('is_hidden', false).single();

    if (venueErr || !venueData) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setVenue(venueData);
    setCurrentFlame(venueData.current_flame || 0);

    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ data: reviewData }, { data: eventData }, { data: scheduleData }, { data: flameData }] = await Promise.all([
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
      supabase.from('venue_flames').select('id').eq('venue_id', id).eq('vote_date', todayIso),
    ]);
    setReviews(reviewData || []);
    setEvents(eventData || []);
    setSchedule(scheduleData || []);
    setFlameVoteCount((flameData || []).length);

    // Rankings within the same city — gated on having enough peers for the
    // number to mean anything, rather than trivially always being "#1".
    if (venueData.city) {
      const [{ data: byRating }, { data: byPopularity }, bestInCategory] = await Promise.all([
        supabase.from('venues').select('id').eq('city', venueData.city).eq('is_hidden', false).order('average_rating', { ascending: false }),
        supabase.from('venues').select('id').eq('city', venueData.city).eq('is_hidden', false).order('total_ratings', { ascending: false }),
        // Local Favorite: top 10 best-rated within this exact city + primary
        // category (a tighter, more meaningful peer group than city-wide
        // bestRated above). Uses the venue's first category for a multi-
        // category venue, same "primary category" convention used for pins.
        getBestRated(venueData.city, 10, venueCategories(venueData)[0]),
      ]);
      const enough = (list) => Array.isArray(list) && list.length >= 3;
      const rank = (list) => {
        const idx = list.findIndex(v => v.id === venueData.id);
        return idx >= 0 && idx < 10 ? idx + 1 : null;
      };
      setRankings({
        bestRated: enough(byRating) ? rank(byRating) : null,
        trending:  enough(byPopularity) ? rank(byPopularity) : null,
        localFavorite: bestInCategory.length >= 3 && bestInCategory.some(v => v.id === venueData.id),
      });
    }

    // Fire-and-forget page view — feeds the "Views last 24h" trending signal
    // in lib/rankings.js. Anonymous visitors are allowed to insert (RLS
    // policy venue_views_insert_public); user_id is best-effort.
    supabase.from('venue_views').insert({ venue_id: venueData.id, user_id: sessionRef.current?.user?.id || null });

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

  // Admin badge on a review — admin_roles' RLS only lets a user read their
  // OWN row, so there's no way to embed "is this reviewer an admin" in the
  // reviews query itself; is_super_admin_user is a SECURITY DEFINER RPC that
  // safely answers that for any user id without exposing the admin_roles
  // table. Only flags super_admins, not ambassadors — there's no equivalent
  // public-safe RPC for the broader admin_roles check.
  useEffect(() => {
    const userIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))];
    if (!userIds.length) { setReviewerAdminIds(new Set()); return; }
    let cancelled = false;
    Promise.all(userIds.map(id =>
      supabase.rpc('is_super_admin_user', { check_user_id: id }).then(({ data }) => (data ? id : null))
    )).then(results => {
      if (!cancelled) setReviewerAdminIds(new Set(results.filter(Boolean)));
    });
    return () => { cancelled = true; };
  }, [reviews]);

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

  // Total check-ins at this venue, across everyone — checkins itself
  // restricts SELECT to the acting user's own rows, so this reads the
  // anonymized checkins_activity view (venue_id + when only) instead.
  useEffect(() => {
    if (!venue?.id) return;
    supabase
      .from('checkins_activity')
      .select('venue_id', { count: 'exact', head: true })
      .eq('venue_id', venue.id)
      .then(({ count }) => setCheckinCount(count || 0));
  }, [venue?.id]);

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
    setCheckinError('');

    let data;
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ venueId: venue.id }),
      });
      data = await res.json();
      if (!res.ok) {
        setCheckinError(data.error || 'Check-in failed');
        setTimeout(() => setCheckinError(''), 4000);
        return;
      }
    } catch (e) {
      setCheckinError('Check-in failed — try again');
      setTimeout(() => setCheckinError(''), 4000);
      return;
    }

    setCheckedIn(true);
    setCheckinCount(c => c + 1);
    setTimeout(() => setCheckedIn(false), 4000);
  };

  const voteFlame = async (level) => {
    if (flameVoting) return;
    setFlameVoting(true);
    try {
      const res = await fetch('/api/venues/flame', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ venue_id: venue.id, flame_level: level }),
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentFlame(data.current_flame);
        const counts = data.vote_counts || {};
        setFlameVoteCount((counts[1] || 0) + (counts[2] || 0) + (counts[3] || 0));
      }
    } catch (e) { /* vote failed — non-critical, leave state as-is */ }
    setFlameVoting(false);
  };

  // history.back() (rather than a plain Link to "/") is what lets the
  // browser use its back-forward cache when available, instantly restoring
  // the map exactly as the user left it — pages/index.js's sessionStorage
  // save/restore (see its beforeunload handler) is what covers the rest of
  // the cases (no bfcache available, or this tab has no real "back" target
  // at all — e.g. a shared link straight to this page, where history.back()
  // would otherwise leave the button doing nothing).
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      router.push('/');
    }
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
    if (sortMode === 'highest') return (b.overall_rating || 0) - (a.overall_rating || 0);
    if (sortMode === 'lowest')  return (a.overall_rating || 0) - (b.overall_rating || 0);
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

      <style jsx global>{`
      .inline-editor-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#083342;color:#e9ffff;border:1px solid #00b6d0;border-radius:10px;padding:12px;margin:14px 0}
      .inline-editor-toolbar span{font-size:12px;opacity:.8;flex:1}
      .inline-editor-toolbar button{background:#1b5260;color:white;border:1px solid #46a3b7;border-radius:7px;padding:8px}
      .inline-category-fieldset{border:1px solid #3e6678;border-radius:9px;padding:12px;display:flex;gap:12px;flex-wrap:wrap}
      .inline-category-fieldset label{display:flex!important;gap:6px;align-items:center}
      .inline-edit-trigger{background:#073c4d;color:#00d5ed;border:1px solid #00b7d1;border-radius:10px;padding:10px 14px;margin:10px 0;font-weight:700;cursor:pointer}
      .inline-edit-form{display:grid;gap:14px;background:#071724;color:#f0faff;border:1px solid #13708a;border-radius:16px;padding:18px;margin:16px 0}
      .inline-edit-form h3{margin:0}.inline-edit-form label{display:grid;gap:6px;font-size:13px;font-weight:700}
      .inline-edit-form input:not([type=checkbox]),.inline-edit-form select,.inline-edit-form textarea{width:100%;min-width:0;background:#142536;color:white;border:1px solid #427083;border-radius:8px;padding:12px;font:inherit}
      .inline-edit-form textarea{min-height:90px}
      .inline-edit-actions{display:flex;gap:10px;flex-wrap:wrap}.inline-edit-actions button{background:#00bfdc;color:#06121b;border:0;border-radius:9px;padding:12px 18px;font-weight:800}
      .inline-edit-actions button+button{background:#263a48;color:white}
      .inline-days{display:flex;gap:10px;flex-wrap:wrap}.inline-days label,.inline-check{display:flex!important;align-items:center;gap:5px}
      .inline-time-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .wu-profile-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:18px 0}
      .wu-profile-tabs button{border:1px solid #0a7084;background:white;color:#073242;padding:14px 8px;border-radius:12px;font-weight:800;cursor:pointer}
      .wu-profile-tabs button[aria-selected=true]{background:#00c8e5;color:#04151d}
      .wu-calendar-nav{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:12px 0}
      .wu-calendar-nav button{border:1px solid #a6c9d0;background:white;border-radius:8px;padding:9px 13px;cursor:pointer}
      .wu-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
      .wu-calendar-weekday{text-align:center;color:#65717b;font-size:12px;font-weight:700}
      .wu-calendar-day{min-height:58px;border:1px solid #e2e6e9;border-radius:9px;background:white;text-align:left;padding:7px 4px;cursor:pointer;min-width:0}
      .wu-calendar-day[aria-pressed=true]{background:#e0faff;border-color:#00b8d2}
      .wu-calendar-dot{display:block;background:#00b8d2;border-radius:5px;height:5px;width:65%;margin:5px auto}
      .wu-calendar-entry{padding:12px;border-bottom:1px solid #e5e5e5}
      .wu-calendar-entry strong{display:block}.wu-calendar-entry small{color:#64727d}
      .venue-activity-schedule{margin:16px 0}.venue-activity-schedule h3{font-size:19px;margin:0 0 12px}
      .venue-activity-item{display:flex;align-items:flex-start;gap:12px;padding:15px 0;border-bottom:1px solid #ddd}
      .venue-activity-symbol{font-size:25px}.venue-activity-info{flex:1;min-width:0}.venue-activity-info div{color:#68717a;font-size:14px;margin-top:5px}.venue-activity-info p{margin:7px 0 0;font-size:14px}
      .venue-activity-edit{display:flex;gap:6px;flex-wrap:wrap}.venue-activity-edit button{border:1px solid #007f9a;color:#007f9a;background:white;border-radius:8px;padding:7px}
      @media(max-width:600px){.inline-edit-form{padding:14px}.venue-activity-item{flex-wrap:wrap}.venue-activity-edit{width:100%;padding-left:40px}}
      `}</style>
      <div className="venue-page">
        <div className="venue-header">
          <div
            className="venue-cover"
            style={venue.cover_photo_url ? { backgroundImage: `url(${venue.cover_photo_url})` } : undefined}
          >
            {!venue.cover_photo_url && <div className="venue-cover-gradient" />}
            <button
              type="button"
              className="venue-back-btn"
              aria-label="Back to map"
              style={{ cursor: 'pointer' }}
              onClick={goBack}
            >
              ←
            </button>
            {canManage && <button
              type="button"
              className="right-sidebar-toggle venue-account-btn"
              onClick={() => { if (editingProfile) { setEditingProfile(false); setEditSection(null); } else startEditing(null); }}
              aria-label={editingProfile ? 'Finish editing' : 'Edit venue'}
              title={editingProfile ? 'Finish editing' : 'Edit venue'}
            >{editingProfile ? '✓' : '✏️'}</button>}
          </div>

          <div className="venue-header-content">
            <h1 className="venue-name">{venue.name}</h1>
            {canManage&&editingProfile&&<div className="inline-editor-toolbar"><strong>✏️ Choose what to edit</strong><span>The public profile stays visible until you select a section.</span><button onClick={()=>setEditSection(editSection==='details'?null:'details')}>{editSection==='details'?'Hide business details':'Business details'}</button><button onClick={()=>setEditSection(editSection==='categories'?null:'categories')}>{editSection==='categories'?'Hide categories':'Categories & location'}</button><button onClick={()=>{setEditingProfile(false);setEditSection(null);}}>Done</button></div>}
            {venue.is_verified && <div className="venue-verified">✓ Verified Business</div>}
            {venue.is_private && <div className="venue-private-badge">🔒 Private Venue</div>}
            {rankings.localFavorite && <div className="venue-local-favorite-badge">🏆 Local Favorite</div>}

            <div className="venue-rating-line">
              {venue.weighted_rating_count > 0 ? (
                <>
                  <span className="venue-rating-big">
                    {(venue.weighted_rating || 0).toFixed(1)}<span className="venue-rating-big-suffix">/10</span>
                  </span>
                  <span className="venue-rating-count-label">
                    {venue.weighted_rating_count} rating{venue.weighted_rating_count === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <span className="venue-new-badge">New on WadUp — be the first to rate!</span>
              )}
            </div>
            {venue.subcategory_weighted_ratings && Object.keys(venue.subcategory_weighted_ratings).length > 0 && (
              <div className="venue-subcat-ratings-row">
                {Object.entries(venue.subcategory_weighted_ratings).map(([subcat, rating]) => (
                  <span key={subcat} className="venue-subcat-rating-chip">
                    {subcat}: {Number(rating).toFixed(1)}
                  </span>
                ))}
              </div>
            )}

            {(rankings.trending || rankings.bestRated) && (
              <div className="venue-rankings">
                {rankings.trending && <span>🔥 #{rankings.trending} Trending</span>}
                {rankings.trending && rankings.bestRated && <span className="venue-rankings-sep">·</span>}
                {rankings.bestRated && <span>🏆 #{rankings.bestRated} Best Rated</span>}
              </div>
            )}

            <div className="venue-location">📍 {venue.city}{venue.state ? `, ${venue.state}` : ''}</div>
            <div className="venue-category-line">
              <div className="venue-category-badges">
                {venueCategories(venue).map(c => (
                  <span key={c} className="venue-category-badge">{CATEGORY_LABELS[c] || c}</span>
                ))}
              </div>
              {venue.subcategory && <span className="venue-subcategory-text"> · {venue.subcategory}</span>}
            </div>

            <div className="venue-actions">
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

          {venue.google_photo_refs?.length > 0 && (
            <div className="google-photos-gallery">
              {venue.google_photo_refs.slice(0, 3).map((ref, i) => (
                <img key={i} src={`/api/places/photo?ref=${encodeURIComponent(ref)}&maxWidth=400`} alt={venue.name} />
              ))}
            </div>
          )}

          {venueCategories(venue).includes('nightlife') && (
            <section className="venue-section flame-section">
              <h3>How busy is it right now?</h3>
              <div className="flame-buttons">
                <button onClick={() => voteFlame(1)} className={`flame-btn${currentFlame === 1 ? ' active' : ''}`} disabled={flameVoting}>
                  🟡 Getting There
                </button>
                <button onClick={() => voteFlame(2)} className={`flame-btn${currentFlame === 2 ? ' active' : ''}`} disabled={flameVoting}>
                  🟠 Getting Busy
                </button>
                <button onClick={() => voteFlame(3)} className={`flame-btn${currentFlame === 3 ? ' active' : ''}`} disabled={flameVoting}>
                  🔴 Packed!
                </button>
              </div>
              <p className="flame-count">{flameVoteCount} people voted today</p>
            </section>
          )}

          <section className="venue-section">
            <h2>About</h2>
            {canManage&&editingProfile&&editSection&&<div className="inline-edit-form">
              <h3>{editSection==='details'?'Business details':'Categories & location'}</h3>
              {(editSection==='details'?['name','description','phone','website','cover_photo_url']:['address']).map(field=><label key={field}>{field.replaceAll('_',' ')}
                {field==='description'?<textarea value={profileDraft[field]||''} onChange={e=>setProfileDraft(d=>({...d,[field]:e.target.value}))}/>:<input value={profileDraft[field]||''} onChange={e=>setProfileDraft(d=>({...d,[field]:e.target.value}))}/>}
              </label>)}
              {editSection==='categories'&&<><label>Primary category<select value={profileDraft.categories?.[0]||'restaurant'} onChange={e=>setProfileDraft(d=>({...d,categories:['restaurant','nightlife','activities'].includes(e.target.value)?[e.target.value,...(d.categories||[]).filter(x=>x!==e.target.value&&['restaurant','nightlife','activities'].includes(x))]:[e.target.value]}))}>
                {[['restaurant','Restaurants'],['nightlife','Bars & Nightlife'],['events','Events'],['sports','Sports'],['outdoors','Outdoors'],['activities','Activities']].map(([id,label])=><option key={id} value={id}>{label}</option>)}
              </select></label>
              <fieldset className="inline-category-fieldset"><legend>Additional categories</legend>{[['restaurant','Restaurants'],['nightlife','Bars & Nightlife'],['activities','Activities']].filter(([id])=>id!==profileDraft.categories?.[0] && ['restaurant','nightlife','activities'].includes(profileDraft.categories?.[0])).map(([id,label])=><label key={id}><input type="checkbox" checked={(profileDraft.categories||[]).includes(id)} onChange={e=>setProfileDraft(d=>({...d,categories:e.target.checked?[...d.categories,id]:d.categories.filter(x=>x!==id)}))}/>{label}</label>)}</fieldset>
              <label>Subcategories (comma separated)<input value={(profileDraft.subcategories||[]).join(', ')} onChange={e=>setProfileDraft(d=>({...d,subcategories:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)}))}/></label></>}
              {editError&&<p role="alert">{editError}</p>}
              <div className="inline-edit-actions"><button disabled={editBusy} onClick={saveInlineProfile}>Save profile</button><button onClick={()=>setEditSection(null)}>Cancel</button></div>
            </div>}
            {venue.description && <p className="venue-description">{venue.description}</p>}

            {schedule.length > 0 && (
              <div className="venue-hours">
                {DAY_NAMES.map((name, i) => {
                  const row = schedule.find(s => s.day_of_week === i);
                  return (
                    <div key={i} className="venue-hours-row">
                      <span>{name}</span>
                      <span>{row ? `${formatTime(row.open_time)} – ${formatTime(row.close_time)}` : 'Closed'}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="venue-contact-row">
              {venue.phone && <a href={`tel:${venue.phone}`}>📞 {venue.phone}</a>}
              {venue.website ? (
                <a href={ensureUrl(venue.website)} target="_blank" rel="noreferrer">🌐 Visit website</a>
              ) : (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.name, venue.address, venue.city, venue.state].filter(Boolean).join(', '))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  📍 Find business details on Google Maps
                </a>
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

          <nav className="wu-profile-tabs" aria-label="Venue profile sections">
            <button type="button" aria-selected={profileTab==='reviews'} onClick={()=>setProfileTab('reviews')}>⭐ Reviews &amp; Rankings</button>
            <button type="button" aria-selected={profileTab==='schedule'} onClick={()=>setProfileTab('schedule')}>📅 Schedule</button>
          </nav>
          {profileTab==='schedule'&&<section className="venue-section">
            <div className="wu-calendar-nav">
              <button type="button" aria-label="Previous month" onClick={()=>{setCalendarMonth(d=>new Date(d.getFullYear(),d.getMonth()-1,1));setCalendarDay(1);}}>‹</button>
              <h2>{calendarMonth.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2>
              <button type="button" aria-label="Next month" onClick={()=>{setCalendarMonth(d=>new Date(d.getFullYear(),d.getMonth()+1,1));setCalendarDay(1);}}>›</button>
            </div>
            <div className="wu-calendar-grid">
              {scheduleDays.map((d,i)=><div className="wu-calendar-weekday" key={i}>{d}</div>)}
              {calendarCells.map((day,i)=>day?<button type="button" key={i} className="wu-calendar-day" aria-pressed={calendarDay===day} onClick={()=>setCalendarDay(day)}><strong>{day}</strong>{calendarEntries.some(e=>e.day===day)&&<span className="wu-calendar-dot"/>}</button>:<div key={i}/>)}
            </div>
            <h3>{new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),calendarDay).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})}</h3>
            {calendarEntries.filter(e=>e.day===calendarDay).length===0?<p className="venue-empty-note">Nothing scheduled for this day.</p>:calendarEntries.filter(e=>e.day===calendarDay).map(e=><div className="wu-calendar-entry" key={e.id}><strong>{e.title}</strong><small>{e.kind?.replaceAll('_',' ')}{e.start?' · '+e.start:''}{e.end?' – '+e.end:''}</small>{e.description&&<p>{e.description}</p>}</div>)}
          </section>}
          {profileTab==='schedule'&&<>
          <section className="venue-section">
            <h2>What&apos;s Happening</h2>
            {canManage&&<button className="inline-edit-trigger" onClick={()=>{setEditingActivity(blankActivity());setEditError('');}}>+ Add activity or special</button>}
            {editingActivity&&canManage&&<div className="inline-edit-form">
              <h3>{editingActivity.id?'Edit':'Add'} schedule item</h3>
              <label>Activity name<input value={editingActivity.title} onChange={e=>setEditingActivity(d=>({...d,title:e.target.value}))}/></label>
              <label>Type<select value={editingActivity.kind} onChange={e=>setEditingActivity(d=>({...d,kind:e.target.value}))}>{activityTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              <label>Frequency<select value={editingActivity.recurrence} onChange={e=>setEditingActivity(d=>({...d,recurrence:e.target.value}))}><option value="weekly">Every week</option><option value="one_time">One-time event</option></select></label>
              {editingActivity.recurrence==='weekly'?<div className="inline-days">{scheduleDays.map((day,i)=><label key={day}><input type="checkbox" checked={editingActivity.weekdays.includes(i)} onChange={e=>setEditingActivity(d=>({...d,weekdays:e.target.checked?[...d.weekdays,i]:d.weekdays.filter(x=>x!==i)}))}/>{day}</label>)}</div>:<label>Event date<input type="date" value={editingActivity.event_date||''} onChange={e=>setEditingActivity(d=>({...d,event_date:e.target.value}))}/></label>}
              <div className="inline-time-row"><label>Starts<input type="time" value={editingActivity.start_time||''} onChange={e=>setEditingActivity(d=>({...d,start_time:e.target.value}))}/></label><label>Ends<input type="time" value={editingActivity.end_time||''} onChange={e=>setEditingActivity(d=>({...d,end_time:e.target.value}))}/></label></div>
              <label>Details<textarea value={editingActivity.description||''} onChange={e=>setEditingActivity(d=>({...d,description:e.target.value}))}/></label>
              <label>Source URL<input value={editingActivity.source_url||''} onChange={e=>setEditingActivity(d=>({...d,source_url:e.target.value}))}/></label>
              <label className="inline-check"><input type="checkbox" checked={!!editingActivity.verified} onChange={e=>setEditingActivity(d=>({...d,verified:e.target.checked}))}/>Verified against official source</label>
              {editError&&<p role="alert">{editError}</p>}
              <div className="inline-edit-actions"><button disabled={editBusy||!editingActivity.title.trim()} onClick={()=>saveActivity('save',editingActivity)}>Save schedule</button><button onClick={()=>setEditingActivity(null)}>Cancel</button></div>
            </div>}
            {activitySchedule.length>0&&<div className="venue-activity-schedule">
              <h3>Weekly schedule & specials</h3>
              {activitySchedule.map(item=><div className="venue-activity-item" key={item.id}>
                <div className="venue-activity-symbol">{({trivia:'🧠',game_night:'🎲',karaoke:'🎤',live_music:'🎵',happy_hour:'🍹',food_special:'🍽️',special_event:'🎉'})[item.kind]||'📅'}</div>
                <div className="venue-activity-info"><strong>{item.title}</strong>
                  <div>{item.recurrence==='weekly'?(item.weekdays||[]).map(d=>scheduleDays[d]).join(' · '):item.event_date}{item.start_time?' · '+item.start_time.slice(0,5):''}{item.end_time?'–'+item.end_time.slice(0,5):''}</div>
                  {item.description&&<p>{item.description}</p>}
                </div>
                {canManage&&<div className="venue-activity-edit"><button onClick={()=>{setEditingActivity({...item,verified:!!item.verified_at,start_time:item.start_time?.slice(0,5)||'',end_time:item.end_time?.slice(0,5)||''});setEditError('');}}>Edit</button><button onClick={()=>{if(window.confirm('Remove this schedule entry?'))saveActivity('delete',{id:item.id});}}>Remove</button></div>}
              </div>)}
            </div>}
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

          </>}
          {profileTab==='reviews'&&<>
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
                      {reviewerAdminIds.has(r.user_id) && (
                        <span className="admin-badge">⚙️ Admin</span>
                      )}
                      <span className="review-date">{formatReviewDate(r.created_at)}</span>
                    </div>
                    <div className="review-rating-line">
                      <span className="review-overall-rating">{(r.overall_rating || 0).toFixed(1)}/10</span>
                      {r.subcategory_ratings && Object.keys(r.subcategory_ratings).length > 0 && (
                        <span className="review-subcat-ratings">
                          {Object.entries(r.subcategory_ratings).map(([subcat, rating]) => (
                            <span key={subcat} className="review-subcat-rating-chip">
                              {subcat}: {Number(rating).toFixed(1)}
                            </span>
                          ))}
                        </span>
                      )}
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

            {venue.google_reviews?.length > 0 && (
              <div className="google-reviews-section">
                <div className="google-reviews-header">— Reviews from Google —</div>
                {venue.google_reviews.map((review, i) => (
                  <div key={i} className="google-review-item">
                    <div className="review-author">{review.authorAttribution?.displayName || 'Google user'}</div>
                    <div className="review-rating">{'⭐'.repeat(review.rating || 0)}</div>
                    <div className="review-text">{review.text?.text}</div>
                    <div className="review-time">{review.relativePublishTimeDescription}</div>
                  </div>
                ))}
                <div className="google-attribution">Reviews provided by Google</div>
              </div>
            )}
          </section>

          </>}

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
        venue={venue}
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

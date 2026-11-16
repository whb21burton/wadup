// components/AdminEditPanel.js — full-field venue editor that slides in from
// the right side of the map when an admin clicks a pin in Edit Mode (see
// pages/index.js). Distinct from pages/admin/venues.js's EditVenueModal: that
// one is a centered dialog for the full venue-list admin page, this one is a
// map-anchored side panel meant for "I'm looking at the pin, fix it right
// here" — including moving the venue by clicking a new spot on the map,
// which only makes sense in this map-embedded context.
import { useEffect, useRef, useState } from 'react';
import { EMOJI_OPTIONS, venueCategories, venueSubcategories } from '../lib/data';

// Deliberately not sourced from lib/data's CATEGORY_CHIPS — that list's
// Bars & Nightlife chip uses id 'bars' for the map's chip-filter UI, but a
// venue's real stored category value is 'nightlife'. These checkboxes write
// straight into venues.categories, so they need the real value.
const PANEL_CATEGORIES = [
  { id: 'events',     label: '🎵 Events' },
  { id: 'nightlife',  label: '🍸 Bars & Nightlife' },
  { id: 'restaurant', label: '🍔 Restaurants' },
  { id: 'sports',     label: '🏟️ Sports' },
  { id: 'outdoors',   label: '🌳 Outdoors' },
  { id: 'activities', label: '🎳 Activities' },
];

function toggleInArray(arr, id) {
  return arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];
}

// Keyed by the real category values written into venues.categories (see
// PANEL_CATEGORIES above) — 'nightlife', not the map chip's 'bars' id.
// Falls back to a free-text input (below) for any category not listed here.
const SUBCATEGORY_OPTIONS = {
  nightlife: [
    'Sports Bar', 'Speakeasy', 'Dance Club', 'Karaoke Bar', 'Jazz Club',
    'Dive Bar', 'Rooftop Bar', 'Brewery', 'Wine Bar', 'Cocktail Bar',
    'College Bar', 'Irish Pub', 'Gay Bar', 'Country Bar', 'Hip Hop Club',
    'Hookah Lounge', 'Pool Bar', 'Arcade Bar', 'Comedy Bar', 'Live Music Bar',
  ],
  restaurant: [
    'American', 'Italian', 'Mexican', 'Asian', 'Japanese', 'Chinese',
    'Thai', 'Indian', 'Mediterranean', 'Greek', 'French', 'BBQ',
    'Seafood', 'Steakhouse', 'Burgers', 'Pizza', 'Sushi', 'Ramen',
    'Vegan', 'Farm to Table', 'Brunch', 'Breakfast', 'Food Truck',
    'Fine Dining', 'Casual Dining', 'Fast Casual', 'Diner', 'Buffet',
    'Wings', 'Tacos', 'Soul Food', 'Southern', 'Sandwich Shop',
  ],
  events: [
    'Concert Hall', 'Theater', 'Comedy Club', 'Event Venue', 'Music Venue',
    'Amphitheater', 'Stadium', 'Arena', 'Festival Grounds', 'Art Gallery',
    'Museum', 'Cinema', 'Dinner Theater', 'Jazz Club', 'Opera House',
  ],
  sports: [
    'Football', 'Baseball', 'Basketball', 'Soccer', 'Hockey',
    'Tennis', 'Golf', 'Racing', 'MMA/Boxing', 'Rugby',
    'Volleyball', 'Swimming', 'Track & Field', 'Multi-Sport',
  ],
  outdoors: [
    'Park', 'Hiking Trail', 'Nature Preserve', 'Waterfront', 'Beach',
    'Campground', 'Rock Climbing', 'Kayaking', 'Rafting', 'Disc Golf',
    'Bike Trail', 'Dog Park', 'Botanical Garden', 'Arboretum', 'Greenway',
  ],
  activities: [
    'Bowling', 'Top Golf', 'Mini Golf', 'Escape Room', 'Axe Throwing',
    'Go Karts', 'Laser Tag', 'Trampoline Park', 'Arcade', 'Billiards',
    'Batting Cage', 'Rock Climbing Gym', 'Painting Class', 'Cooking Class',
    'Virtual Reality', 'Board Game Cafe', 'Bingo Hall', 'Casino',
  ],
};

export default function AdminEditPanel({
  venue,             // live venues row being edited
  relocateTarget,    // { lat, lng } | null — set by the parent once "Click map to move" captures a new spot
  relocating,        // true while the parent is waiting for that next map click
  onStartRelocate,
  onCancelRelocate,
  onClose,
  onSave,            // async (fields) => void — throws on failure
  onDelete,          // async () => void — throws on failure
  onScheduleRequest,
}) {
  const [name, setName] = useState(venue.name || '');
  const [tab,setTab] = useState('profile');
  const [pos,setPos] = useState(null);
  const drag = useRef(null);
  const [address,setAddress] = useState(venue.address||'');
  const [phone,setPhone] = useState(venue.phone||'');
  const [website,setWebsite] = useState(venue.website||'');
  const [description,setDescription] = useState(venue.description||'');
  const [cover,setCover] = useState(venue.cover_photo_url||'');
  const [items,setItems] = useState([]);
  const [scheduleError,setScheduleError] = useState('');
  const [busy,setBusy] = useState(false);
  const blank = () => ({title:'',kind:'trivia',recurrence:'weekly',weekdays:[],event_date:'',start_time:'',end_time:'',description:'',source_url:'',verified:false,is_active:true});
  const [draft,setDraft] = useState(null);
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const kinds=[['trivia','Trivia'],['game_night','Game / Bingo night'],['karaoke','Karaoke'],['live_music','Live music'],['special_event','Special event'],['happy_hour','Happy hour'],['food_special','Food / drink special'],['other','Other']];
  const scheduleRequest=async(action,item)=>{
    setBusy(true);setScheduleError('');
    try {
      const response=await onScheduleRequest({venueId:venue.id,action,item});
      if(action==='list')setItems(response.items||[]);
      else {const list=await onScheduleRequest({venueId:venue.id,action:'list'});setItems(list.items||[]);setDraft(null);}
    }catch(e){setScheduleError(e.message||'Schedule request failed');}
    finally{setBusy(false);}
  };
  useEffect(()=>{
    const move=e=>{if(!drag.current)return;const d=drag.current;setPos({left:Math.max(0,Math.min(window.innerWidth-200,d.left+e.clientX-d.x)),top:Math.max(0,Math.min(window.innerHeight-70,d.top+e.clientY-d.y))});};
    const stop=()=>{drag.current=null;};
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',stop);
    return()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',stop);};
  },[]);
  useEffect(()=>{if(tab==='schedule'&&onScheduleRequest)scheduleRequest('list');},[tab,venue.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [categories, setCategories] = useState(venueCategories(venue));
  const [subcategories, setSubcategories] = useState(venueSubcategories(venue));
  // Free-text entry for a subcategory none of the chips offer — added to the
  // array on Enter / "+ Add", same as clicking a chip.
  const [customSubcat, setCustomSubcat] = useState('');
  const [adminRating, setAdminRating] = useState(venue.admin_rating || '');
  const [emoji, setEmoji] = useState(venue.custom_emoji || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hideNewBadge, setHideNewBadge] = useState(!!venue.hide_new_badge);
  const [isPrivate, setIsPrivate] = useState(!!venue.is_private);
  const [isHidden, setIsHidden] = useState(!!venue.is_hidden);
  const [isVerified, setIsVerified] = useState(!!venue.is_verified);
  const [lat, setLat] = useState(venue.lat ?? '');
  const [lng, setLng] = useState(venue.lng ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // The panel is a single reused instance — clicking a different pin while
  // it's already open just swaps `venue` in place, so every field needs to
  // reset to match rather than keeping the previous venue's edits.
  useEffect(() => {
    setName(venue.name || '');
    setTab('profile');setPos(null);setItems([]);setDraft(null);
    setAddress(venue.address||'');setPhone(venue.phone||'');setWebsite(venue.website||'');
    setDescription(venue.description||'');setCover(venue.cover_photo_url||'');
    setCategories(venueCategories(venue));
    setSubcategories(venueSubcategories(venue));
    setCustomSubcat('');
    setAdminRating(venue.admin_rating || '');
    setEmoji(venue.custom_emoji || '');
    setHideNewBadge(!!venue.hide_new_badge);
    setIsPrivate(!!venue.is_private);
    setIsHidden(!!venue.is_hidden);
    setIsVerified(!!venue.is_verified);
    setLat(venue.lat ?? '');
    setLng(venue.lng ?? '');
    setError('');
  }, [venue.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A relocate-mode map click landed — reflect it in the (still-unsaved) form.
  useEffect(() => {
    if (!relocateTarget) return;
    setLat(relocateTarget.lat);
    setLng(relocateTarget.lng);
  }, [relocateTarget]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        name, categories, address, phone, website, description, cover_photo_url: cover || null,
        subcategories,
        // venues.subcategory stays populated with the FIRST selection so every
        // existing single-value reader (map pins, discover/browse cards,
        // search, lib/rankings' VENUE_CARD_FIELDS) keeps working unchanged.
        subcategory: subcategories[0] || null,
        admin_rating: parseFloat(adminRating) || null,
        custom_emoji: emoji || null,
        hide_new_badge: hideNewBadge,
        is_private: isPrivate,
        is_hidden: isHidden,
        is_verified: isVerified,
        lat: lat === '' ? null : parseFloat(lat),
        lng: lng === '' ? null : parseFloat(lng),
      });
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  const del = async () => {
    if (!window.confirm('Are you sure? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await onDelete();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  // Offer the subcategories of EVERY category this venue is tagged with, not
  // just the primary one — a venue that is both Restaurant and Bars &
  // Nightlife should be able to pick from both sets. Deduped, since a few
  // names ('Jazz Club') appear under more than one category.
  const selectedCats = categories.length ? categories : (venue.category ? [venue.category] : []);
  const subcatOptions = [...new Set(selectedCats.flatMap(c => SUBCATEGORY_OPTIONS[c] || []))];

  // Anything already saved on the venue that isn't in the offered list (a
  // free-text entry, or a lowercase Google primaryType like 'night club' from
  // a Places sync) still needs a chip, or saving would silently drop it.
  const extraSelected = subcategories.filter(
    s => !subcatOptions.some(o => o.toLowerCase() === String(s).toLowerCase())
  );

  const isSubcatSelected = (opt) =>
    subcategories.some(s => String(s).toLowerCase() === String(opt).toLowerCase());

  const toggleSubcat = (opt) => setSubcategories(prev =>
    prev.some(s => String(s).toLowerCase() === String(opt).toLowerCase())
      ? prev.filter(s => String(s).toLowerCase() !== String(opt).toLowerCase())
      : [...prev, opt]
  );

  const addCustomSubcat = () => {
    const value = customSubcat.trim();
    if (!value) return;
    if (!isSubcatSelected(value)) setSubcategories(prev => [...prev, value]);
    setCustomSubcat('');
  };

  return (
    <>
      <style jsx global>{`
.wadup-venue-studio{box-sizing:border-box;background:#07111f!important;color:#e6f3f8!important}
.wadup-venue-studio *{box-sizing:border-box}
.wadup-venue-studio .edit-panel-body{display:block!important;max-width:none!important;width:100%!important;min-width:0!important}
.wadup-venue-studio .edit-panel-cover{height:140px!important;margin:0 0 22px!important;border-radius:12px!important;display:flex;align-items:center;justify-content:center}
.wadup-venue-studio .studio-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 22px;max-width:850px}
.wadup-venue-studio .studio-field{display:flex;flex-direction:column;gap:7px;min-width:0}
.wadup-venue-studio .studio-full{grid-column:1/-1}
.wadup-venue-studio .studio-field>label{display:block!important;margin:0!important;font-size:12px!important;font-weight:700!important;color:#a8c1d1!important;text-transform:uppercase}
.wadup-venue-studio .studio-field>input,.wadup-venue-studio .studio-field>textarea{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;height:auto!important;min-height:44px!important;margin:0!important;padding:12px 14px!important;border:1px solid #315368!important;border-radius:9px!important;background:#111e2d!important;color:#eff9ff!important;font-size:14px!important}
.wadup-venue-studio .studio-field>textarea{min-height:105px!important;resize:vertical!important;font-family:inherit!important}
.wadup-venue-studio .studio-help{color:#93adbd;font-size:12px}
.wadup-venue-studio .studio-footer{position:sticky;bottom:-24px;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;background:#07111f;border-top:1px solid #214154;margin-top:24px}
.wadup-venue-studio .studio-footer .edit-panel-save-btn{width:auto!important;min-width:180px!important;margin:0!important;padding:13px 20px!important;background:#00c6e8!important;color:#03111a!important;border-radius:9px!important}
.wadup-venue-studio .admin-emoji-row{margin:0!important}
.wadup-venue-studio .edit-panel-header{min-height:70px!important}
.wadup-venue-studio select,.wadup-venue-studio input[type=date],.wadup-venue-studio input[type=time]{background:#132535;color:#f1faff;border:1px solid #315368;border-radius:8px;padding:10px}
@media(max-width:700px){.wadup-venue-studio .studio-form-grid{grid-template-columns:1fr}.wadup-venue-studio .studio-footer{flex-direction:column;align-items:stretch}}
`}</style>
      {/* Skipped entirely while relocating — this is a transparent,
          full-viewport, very-high-z-index click-catcher (click outside the
          panel to close it), which otherwise sits directly on top of the
          map and swallows the exact click "Click map to move" is waiting
          for before it ever reaches Google Maps' own click listener. */}
      {!relocating && <div className="edit-panel-overlay" aria-hidden="true" />}
      <div className="edit-panel wadup-venue-studio" onClick={(e) => e.stopPropagation()} style={{position:'fixed',left:pos?.left??'5vw',top:pos?.top??'5vh',right:'auto',bottom:'auto',width:'min(1050px,90vw)',height:'min(800px,88vh)',maxWidth:'95vw',maxHeight:'92vh',resize:'both',overflow:'hidden',display:'flex',flexDirection:'column',zIndex:10020,borderRadius:16}}>
        <div className="edit-panel-header" style={{cursor:'move',userSelect:'none',flexShrink:0}} onMouseDown={e=>{if(e.button!==0||e.target.closest('button'))return;const rect=e.currentTarget.parentElement.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};e.preventDefault();}}>
          <span>✏️ Venue Studio · {name}</span>
          <button className="edit-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{display:'flex',gap:8,padding:12,flexShrink:0,flexWrap:'wrap',borderBottom:'1px solid #245369'}}>{[['profile','Profile'],['categories','Categories'],['schedule','Schedule & specials'],['location','Location'],['admin','Admin']].map(([id,label])=><button type="button" key={id} onClick={()=>setTab(id)} style={{background:tab===id?'#075a72':'#132638',color:'white',padding:'8px 12px',border:'1px solid #245369',borderRadius:8}}>{label}</button>)}</div>
        <div className="edit-panel-body admin-modal-body" style={{flex:1,overflowY:'auto',padding:24}}>
          <div style={{display:tab==='profile'?'block':'none'}}>
          <div
            className="edit-panel-cover"
            style={cover ? { backgroundImage: `url(${cover})` } : undefined}
          >
            {!cover && <span>📸 Cover photo preview</span>}
          </div>

          <div className="studio-form-grid"><div className="studio-field studio-full"><label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />

          </div><div className="studio-field studio-full"><label>Map emoji</label>
          <div className="admin-emoji-row">
            <button type="button" className="admin-emoji-current" onClick={() => setPickerOpen(v => !v)}>
              {emoji || '📍'}
            </button>
            <span className="admin-emoji-hint">Click to change</span>
          </div>
          {pickerOpen && (
            <div className="admin-emoji-picker">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e} type="button" className="admin-emoji-choice"
                  onClick={() => { setEmoji(e); setPickerOpen(false); }}
                >
                  {e}
                </button>
              ))}
              <button type="button" className="admin-emoji-choice admin-emoji-clear" onClick={() => { setEmoji(''); setPickerOpen(false); }}>
                Auto
              </button>
            </div>
          )}

          </div><div className="studio-field studio-full"><label>Street address</label><input value={address} onChange={e=>setAddress(e.target.value)}/>
          </div><div className="studio-field"><label>Phone</label><input value={phone} onChange={e=>setPhone(e.target.value)}/>
          </div><div className="studio-field"><label>Website</label><input value={website} onChange={e=>setWebsite(e.target.value)}/>
          </div><div className="studio-field studio-full"><label>Description</label><textarea rows={4} value={description} onChange={e=>setDescription(e.target.value)} style={{width:'100%'}}/>
          </div><div className="studio-field studio-full"><label>Cover photo URL</label><input value={cover} onChange={e=>setCover(e.target.value)}/>
          </div></div></div><div style={{display:tab==='categories'?'block':'none'}}>
          <label>Primary category</label>
          <select value={categories[0]||''} onChange={e=>setCategories(prev=>[e.target.value,...prev.filter(x=>x!==e.target.value)])}>{PANEL_CATEGORIES.map(cat=><option key={cat.id} value={cat.id}>{cat.label}</option>)}</select>
          <label>Additional categories</label>
          <div className="admin-checkbox-grid">
            {PANEL_CATEGORIES.map(c => (
              <label key={c.id} className="admin-checkbox-item">
                <input
                  type="checkbox"
                  checked={categories.includes(c.id)} disabled={categories[0]===c.id}
                  onChange={() => setCategories(prev => prev[0]===c.id?prev:toggleInArray(prev,c.id))}
                />
                {c.label}
              </label>
            ))}
          </div>

          <label>Subcategories</label>
          <div className="admin-emoji-hint">
            Pick as many as fit. The first one stays the venue&apos;s primary
            subcategory everywhere a single value is shown.
          </div>
          <div className="admin-chip-grid">
            {[...subcatOptions, ...extraSelected].map(opt => (
              <button
                key={opt}
                type="button"
                className={`admin-chip${isSubcatSelected(opt) ? ' selected' : ''}`}
                onClick={() => toggleSubcat(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="admin-subcat-add">
            <input
              value={customSubcat}
              placeholder="Add another, e.g. Craft Beer Bar"
              onChange={(e) => setCustomSubcat(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSubcat(); } }}
            />
            <button type="button" className="admin-chip" onClick={addCustomSubcat} disabled={!customSubcat.trim()}>
              + Add
            </button>
          </div>
          {subcategories.length > 0 && (
            <div className="admin-emoji-hint">
              Selected: {subcategories.join(' · ')}
            </div>
          )}

          </div><div style={{display:tab==='admin'?'block':'none'}}>
          <label>Badges / Status</label>
          <div className="edit-panel-toggle-col">
            <label className="admin-toggle">
              <input type="checkbox" checked={hideNewBadge} onChange={(e) => setHideNewBadge(e.target.checked)} />
              Hide &quot;New&quot; badge
            </label>
            <label className="admin-toggle">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              Private Venue 🔒
            </label>
            <label className="admin-toggle">
              <input type="checkbox" checked={isHidden} onChange={(e) => setIsHidden(e.target.checked)} />
              Hidden from map
            </label>
            <label className="admin-toggle">
              <input type="checkbox" checked={isVerified} onChange={(e) => setIsVerified(e.target.checked)} />
              Verified ✓
            </label>
          </div>

          </div><div style={{display:tab==='location'?'block':'none'}}>
          <label>📍 Location</label>
          <div className="admin-form-row">
            <div>
              <label>Lat</label>
              <input value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div>
              <label>Lng</label>
              <input value={lng} onChange={(e) => setLng(e.target.value)} />
            </div>
          </div>
          <div className="edit-panel-relocate-row">
            <button
              type="button"
              className={`edit-panel-relocate-btn${relocating ? ' active' : ''}`}
              onClick={onStartRelocate}
            >
              {relocating ? '📍 Click anywhere on map…' : '📌 Click map to move'}
            </button>
            {relocating && (
              <button type="button" className="edit-panel-relocate-cancel-btn" onClick={onCancelRelocate}>
                Cancel
              </button>
            )}
          </div>

          </div><div style={{display:tab==='admin'?'block':'none'}}>
          <label>⭐ Admin Rating (1-10)</label>
          <input
            type="number"
            min="1"
            max="10"
            step="0.1"
            value={adminRating}
            onChange={(e) => setAdminRating(e.target.value)}
            placeholder="e.g. 8.5"
          />
          <div className="admin-emoji-hint">
            Used for ranking until enough user ratings exist (5+). Google rating: {venue.google_rating != null ? venue.google_rating.toFixed(1) : '—'}.
          </div>

          </div>
          {tab==='schedule'&&<div>
            <h2>Schedule & specials</h2>
            <p style={{opacity:.7}}>Recurring trivia, game nights, live music, karaoke and happy hours. Entries are saved to the venue schedule database; feed and happy-hour map indicators are not enabled yet.</p>
            {busy&&<p>Working…</p>}{scheduleError&&<p role="alert">{scheduleError}</p>}
            {items.map(item=><div key={item.id} style={{padding:12,border:'1px solid #245369',borderRadius:8,marginBottom:8}}>
              <strong>{item.title}</strong> · {item.kind} · {item.recurrence==='weekly'?item.weekdays.map(d=>days[d]).join(', '):item.event_date} · {item.start_time||'Time unspecified'}
              <div style={{display:'flex',gap:8,marginTop:8}}><button type="button" onClick={()=>setDraft({...item,verified:!!item.verified_at,start_time:item.start_time?.slice(0,5)||'',end_time:item.end_time?.slice(0,5)||''})}>Edit</button><button type="button" onClick={()=>{if(window.confirm('Delete this schedule entry?'))scheduleRequest('delete',{id:item.id});}}>Delete</button></div>
            </div>)}
            {!draft?<button type="button" onClick={()=>setDraft(blank())}>+ Add schedule entry</button>:<div style={{display:'grid',gap:12,padding:14,border:'1px solid #245369',borderRadius:8}}>
              <label>Activity title<input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}/></label>
              <label>Type<select value={draft.kind} onChange={e=>setDraft(d=>({...d,kind:e.target.value}))}>{kinds.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
              <label>Frequency<select value={draft.recurrence} onChange={e=>setDraft(d=>({...d,recurrence:e.target.value}))}><option value="weekly">Weekly</option><option value="one_time">One-time</option></select></label>
              {draft.recurrence==='weekly'?<div><label>Days</label><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{days.map((day,i)=><label key={day}><input type="checkbox" checked={draft.weekdays.includes(i)} onChange={e=>setDraft(d=>({...d,weekdays:e.target.checked?[...d.weekdays,i]:d.weekdays.filter(x=>x!==i)}))}/>{day}</label>)}</div></div>:<label>Date<input type="date" value={draft.event_date||''} onChange={e=>setDraft(d=>({...d,event_date:e.target.value}))}/></label>}
              <label>Start time (optional)<input type="time" value={draft.start_time||''} onChange={e=>setDraft(d=>({...d,start_time:e.target.value}))}/></label>
              <label>End time (optional)<input type="time" value={draft.end_time||''} onChange={e=>setDraft(d=>({...d,end_time:e.target.value}))}/></label>
              <label>Details<textarea value={draft.description||''} onChange={e=>setDraft(d=>({...d,description:e.target.value}))}/></label>
              <label>Official source URL<input value={draft.source_url||''} onChange={e=>setDraft(d=>({...d,source_url:e.target.value}))}/></label>
              <label><input type="checkbox" checked={!!draft.verified} onChange={e=>setDraft(d=>({...d,verified:e.target.checked}))}/> Verified</label>
              <label><input type="checkbox" checked={draft.is_active!==false} onChange={e=>setDraft(d=>({...d,is_active:e.target.checked}))}/> Active</label>
              <div><button type="button" disabled={busy||!draft.title.trim()} onClick={()=>scheduleRequest('save',draft)}>Save schedule</button> <button type="button" onClick={()=>setDraft(null)}>Cancel</button></div>
            </div>}
          </div>}
          {error && <div className="admin-modal-error">⚠️ {error}</div>}

          <div className="studio-footer"><span className="studio-help">Venue changes save separately from schedule entries.</span><button className="edit-panel-save-btn" onClick={save} disabled={saving || deleting || !name || !categories.length}>
            {saving ? 'Saving…' : '💾 Save Venue'}
          </button></div>
          {tab==='admin'&&<button className="edit-panel-delete-btn" onClick={del} disabled={saving || deleting}>
            {deleting ? 'Deleting…' : '🗑️ Delete Venue'}
          </button>}
        </div>
      </div>
    </>
  );
}

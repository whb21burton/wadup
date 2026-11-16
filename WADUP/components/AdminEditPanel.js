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
  const [calendarMonth,setCalendarMonth]=useState(()=>new Date().getMonth());
  const [calendarYear,setCalendarYear]=useState(()=>new Date().getFullYear());
  const [calendarDay,setCalendarDay]=useState(()=>new Date().getDate());
  const [calendarView,setCalendarView]=useState('month');
  const [selectedOccurrence,setSelectedOccurrence]=useState(null);
  const [scheduleConfirm,setScheduleConfirm]=useState(null);
  const iso=(year,month,day)=>year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  const occurrenceDate=iso(calendarYear,calendarMonth,calendarDay);
  const eventOn=(item,date)=>{
    if(item.is_active===false)return false;
    if(item.recurrence==='one_time')return item.event_date===date;
    return (!item.starts_on||date>=item.starts_on)&&(!item.ends_on||date<=item.ends_on)&&
      (item.weekdays||[]).includes(new Date(date+'T12:00:00Z').getUTCDay());
  };
  const occurrencesFor=(date)=>items.filter(item=>eventOn(item,date)&&item.occurrence_overrides?.[date]!=='deleted');
  const shiftMonth=(delta)=>{const d=new Date(calendarYear,calendarMonth+delta,1);setCalendarYear(d.getFullYear());setCalendarMonth(d.getMonth());setCalendarDay(1);setSelectedOccurrence(null);};
  const executeOccurrenceAction=async()=>{
    if(!scheduleConfirm)return;
    const {action,item,date}=scheduleConfirm;
    await scheduleRequest(action,{id:item.id,date});
    setScheduleConfirm(null);setSelectedOccurrence(null);
  };
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
.wadup-venue-studio .wadup-calendar button{cursor:pointer;color:inherit}
.wadup-venue-studio .calendar-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.wadup-venue-studio .calendar-toolbar button,.wadup-venue-studio .calendar-actions button,.wadup-venue-studio .calendar-add{background:#132d40;border:1px solid #306077;border-radius:9px;padding:10px 13px;color:#f4fbff}
.wadup-venue-studio .calendar-toolbar button.selected,.wadup-venue-studio .calendar-add{background:#057b98}
.wadup-venue-studio .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.wadup-venue-studio .calendar-weekday{text-align:center;color:#91aabd;font-size:12px;padding:10px 0}
.wadup-venue-studio .calendar-cell{display:flex;flex-direction:column;align-items:stretch;text-align:left;gap:4px;min-height:78px;min-width:0;padding:6px;background:#102033;border:1px solid #284255;border-radius:6px}
.wadup-venue-studio .calendar-cell.selected{border-color:#00d5ef}
.wadup-venue-studio .calendar-cell small{display:block;background:#204a62;color:#e8f9ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:3px;border-radius:3px;font-size:10px}
.wadup-venue-studio .calendar-cell small.canceled,.wadup-venue-studio .calendar-event.canceled{text-decoration:line-through;opacity:.55}
.wadup-venue-studio .calendar-hour{display:grid;grid-template-columns:58px 1fr;min-height:52px;border-top:1px solid #264052;padding:6px 0;gap:8px}
.wadup-venue-studio .calendar-hour>span{font-size:12px;color:#9bb1c2}
.wadup-venue-studio .calendar-event{display:flex;flex-direction:column;text-align:left;gap:4px;background:#13516c;border-left:4px solid #00d6f5;border-radius:7px;padding:10px;width:100%;margin-bottom:5px}
.wadup-venue-studio .calendar-event small{opacity:.8}
.wadup-venue-studio .calendar-details,.wadup-venue-studio .calendar-confirm{margin-top:16px;background:#102236;border:1px solid #315368;border-radius:12px;padding:16px}
.wadup-venue-studio .calendar-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.wadup-venue-studio .calendar-details label{display:flex;flex-direction:column;gap:5px}
.wadup-venue-studio .calendar-details input,.wadup-venue-studio .calendar-details textarea,.wadup-venue-studio .calendar-details select{width:100%;min-width:0;background:#132535;color:#f1faff;border:1px solid #315368;border-radius:8px;padding:10px}
.wadup-venue-studio .calendar-details input[type=checkbox]{width:auto}
@media(max-width:700px){.wadup-venue-studio .calendar-cell{min-height:52px;padding:3px}.wadup-venue-studio .calendar-cell small{font-size:8px}.wadup-venue-studio .calendar-toolbar{flex-wrap:wrap}}
@media(max-width:700px){.wadup-venue-studio .studio-form-grid{grid-template-columns:1fr}.wadup-venue-studio .studio-footer{flex-direction:column;align-items:stretch}}
`}</style>
      {/* Skipped entirely while relocating — this is a transparent,
          full-viewport, very-high-z-index click-catcher (click outside the
          panel to close it), which otherwise sits directly on top of the
          map and swallows the exact click "Click map to move" is waiting
          for before it ever reaches Google Maps' own click listener. */}
      {!relocating && <div className="edit-panel-overlay" aria-hidden="true" />}
      <div className="edit-panel wadup-venue-studio" onClick={(e) => e.stopPropagation()} style={{position:'fixed',left:pos?.left??'5vw',top:pos?.top??'5vh',right:'auto',bottom:'auto',width:'min(1050px,90vw)',height:'min(800px,88vh)',maxWidth:'95vw',maxHeight:'92vh',resize:'both',overflow:'hidden',display:'flex',flexDirection:'column',zIndex:1000002,borderRadius:16}}>
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
          {tab==='schedule'&&<div className="wadup-calendar">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:18}}>
              <div><h2 style={{margin:0}}>Venue Calendar</h2><p className="studio-help">Manage what guests see on this venue's schedule.</p></div>
              <button type="button" className="calendar-add" onClick={()=>{setDraft({...blank(),event_date:occurrenceDate,starts_on:occurrenceDate,weekdays:[new Date(occurrenceDate+'T12:00:00Z').getUTCDay()]});setSelectedOccurrence(null);}}>+ Add Event</button>
            </div>
            {busy&&<p>Updating schedule…</p>}{scheduleError&&<p role="alert" style={{color:'#ff8d8d'}}>{scheduleError}</p>}
            <div className="calendar-toolbar">
              <button type="button" onClick={()=>shiftMonth(-1)} aria-label="Previous month">‹</button>
              <strong>{new Date(calendarYear,calendarMonth,1).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</strong>
              <button type="button" onClick={()=>shiftMonth(1)} aria-label="Next month">›</button>
              <div style={{flex:1}}/>
              <button type="button" className={calendarView==='month'?'selected':''} onClick={()=>setCalendarView('month')}>Month</button>
              <button type="button" className={calendarView==='day'?'selected':''} onClick={()=>setCalendarView('day')}>Day</button>
            </div>
            {calendarView==='month'?<div className="calendar-grid">
              {days.map(d=><div key={d} className="calendar-weekday">{d}</div>)}
              {Array.from({length:new Date(calendarYear,calendarMonth,1).getDay()},(_,i)=><div key={'blank'+i} className="calendar-blank"/>)}
              {Array.from({length:new Date(calendarYear,calendarMonth+1,0).getDate()},(_,i)=>{
                const n=i+1,date=iso(calendarYear,calendarMonth,n),list=occurrencesFor(date);
                return <button type="button" key={date} className={'calendar-cell'+(calendarDay===n?' selected':'')} onClick={()=>{setCalendarDay(n);setCalendarView('day');setSelectedOccurrence(null)}}>
                  <span>{n}</span>{list.slice(0,2).map(e=><small key={e.id} className={e.occurrence_overrides?.[date]==='canceled'?'canceled':''}>{e.title}</small>)}{list.length>2&&<small>+{list.length-2} more</small>}
                </button>;
              })}
            </div>:<div className="calendar-day">
              <h3>{new Date(occurrenceDate+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'})}</h3>
              {Array.from({length:24},(_,hour)=>{
                const list=occurrencesFor(occurrenceDate).filter(e=>Number((e.start_time||'00:00').slice(0,2))===hour);
                return <div className="calendar-hour" key={hour}><span>{String(hour%12||12)} {hour<12?'AM':'PM'}</span><div>{list.map(e=><button type="button" key={e.id} className={'calendar-event'+(e.occurrence_overrides?.[occurrenceDate]==='canceled'?' canceled':'')} onClick={()=>{setSelectedOccurrence({item:e,date:occurrenceDate});setDraft(null);}}>
                  <strong>{e.title}</strong><small>{e.start_time?.slice(0,5)||'All day'} – {e.end_time?.slice(0,5)||'Time not set'} {e.occurrence_overrides?.[occurrenceDate]==='canceled'?'· CANCELED':''}</small>
                </button>)}</div></div>;
              })}
            </div>}
            {selectedOccurrence&&!draft&&<div className="calendar-details">
              <h3>{selectedOccurrence.item.title}</h3>
              <p>{selectedOccurrence.item.kind.replaceAll('_',' ')} · {selectedOccurrence.item.start_time?.slice(0,5)||'No start time'} – {selectedOccurrence.item.end_time?.slice(0,5)||'No end time'}</p>
              {selectedOccurrence.item.occurrence_overrides?.[selectedOccurrence.date]==='canceled'&&<p style={{color:'#ffb48a'}}>Canceled for this date</p>}
              <div className="calendar-actions">
                <button type="button" onClick={()=>{const e=selectedOccurrence.item;setDraft({...e,verified:!!e.verified_at,start_time:e.start_time?.slice(0,5)||'',end_time:e.end_time?.slice(0,5)||''});}}>Edit schedule</button>
                {selectedOccurrence.item.occurrence_overrides?.[selectedOccurrence.date]==='canceled'?<button type="button" onClick={()=>setScheduleConfirm({...selectedOccurrence,action:'restore_occurrence'})}>Restore</button>:<button type="button" onClick={()=>setScheduleConfirm({...selectedOccurrence,action:'cancel_occurrence'})}>Cancel event</button>}
                <button type="button" onClick={()=>setScheduleConfirm({...selectedOccurrence,action:'delete_occurrence'})}>Delete this date</button>
                {selectedOccurrence.item.recurrence==='weekly'&&<button type="button" onClick={()=>setScheduleConfirm({...selectedOccurrence,action:'delete_future'})}>Delete all future repeats</button>}
              </div>
            </div>}
            {scheduleConfirm&&<div className="calendar-confirm" role="alertdialog" aria-label="Confirm schedule change">
              <h3>{scheduleConfirm.action==='delete_future'?'Delete this and all future repeats?':scheduleConfirm.action==='delete_occurrence'?'Delete this occurrence?':scheduleConfirm.action==='cancel_occurrence'?'Cancel this occurrence?':'Restore this occurrence?'}</h3>
              <p>{scheduleConfirm.action==='delete_future'?'Future repeats will disappear, but past event history stays. This cannot be undone automatically.':scheduleConfirm.action==='cancel_occurrence'?'Guests will see CANCELED for this date. Other weeks stay scheduled.':scheduleConfirm.action==='delete_occurrence'?'This date will disappear from the public calendar. Other repeats stay scheduled.':'This date will become active again.'}</p>
              <div className="calendar-actions"><button type="button" disabled={busy} onClick={executeOccurrenceAction}>Confirm</button><button type="button" onClick={()=>setScheduleConfirm(null)}>Keep event</button></div>
            </div>}
            {draft&&<div className="calendar-details" style={{display:'grid',gap:12}}>
              <h3>{draft.id?'Edit event':'New event'}</h3>
              <label>Event category<select value={draft.kind} onChange={e=>setDraft(d=>({...d,kind:e.target.value}))}>{kinds.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
              <label>Event name<input value={draft.title} placeholder="e.g. American History Trivia" onChange={e=>setDraft(d=>({...d,title:e.target.value}))}/></label>
              <label>Repeats<select value={draft.recurrence} onChange={e=>setDraft(d=>({...d,recurrence:e.target.value}))}><option value="one_time">Does not repeat</option><option value="weekly">Every week</option></select></label>
              {draft.recurrence==='weekly'?<><div><label>Repeat on</label><div className="calendar-actions">{days.map((d,i)=><label key={d}><input type="checkbox" checked={(draft.weekdays||[]).includes(i)} onChange={e=>setDraft(v=>({...v,weekdays:e.target.checked?[...v.weekdays,i]:v.weekdays.filter(x=>x!==i)}))}/>{d}</label>)}</div></div><label>Starts on<input type="date" value={draft.starts_on||''} onChange={e=>setDraft(v=>({...v,starts_on:e.target.value}))}/></label><label>Ends on (optional)<input type="date" value={draft.ends_on||''} onChange={e=>setDraft(v=>({...v,ends_on:e.target.value}))}/></label></>:<label>Event date<input type="date" value={draft.event_date||''} onChange={e=>setDraft(v=>({...v,event_date:e.target.value}))}/></label>}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}><label>Start time<input type="time" value={draft.start_time||''} onChange={e=>setDraft(v=>({...v,start_time:e.target.value}))}/></label><label>End time<input type="time" value={draft.end_time||''} onChange={e=>setDraft(v=>({...v,end_time:e.target.value}))}/></label></div>
              <label>Details<textarea value={draft.description||''} onChange={e=>setDraft(v=>({...v,description:e.target.value}))}/></label>
              <label>Official source URL<input value={draft.source_url||''} onChange={e=>setDraft(v=>({...v,source_url:e.target.value}))}/></label>
              <label><input type="checkbox" checked={!!draft.verified} onChange={e=>setDraft(v=>({...v,verified:e.target.checked}))}/> Verified</label>
              <div className="calendar-actions"><button type="button" disabled={busy||!draft.title?.trim()||!draft.start_time||!draft.end_time||draft.end_time<=draft.start_time} onClick={()=>scheduleRequest('save',draft)}>Save event</button><button type="button" onClick={()=>setDraft(null)}>Discard</button></div>
            </div>}
            <p className="studio-help">Happy hours and food specials remain venue-only. Event publication to the main WADUP feed requires separate integration.</p>
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

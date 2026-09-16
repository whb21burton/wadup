// components/AdminEditPanel.js — full-field venue editor that slides in from
// the right side of the map when an admin clicks a pin in Edit Mode (see
// pages/index.js). Distinct from pages/admin/venues.js's EditVenueModal: that
// one is a centered dialog for the full venue-list admin page, this one is a
// map-anchored side panel meant for "I'm looking at the pin, fix it right
// here" — including moving the venue by clicking a new spot on the map,
// which only makes sense in this map-embedded context.
import { useEffect, useState } from 'react';
import { EMOJI_OPTIONS, venueCategories } from '../lib/data';

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
}) {
  const [name, setName] = useState(venue.name || '');
  const [categories, setCategories] = useState(venueCategories(venue));
  const [subcategory, setSubcategory] = useState(venue.subcategory || '');
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
    setCategories(venueCategories(venue));
    setSubcategory(venue.subcategory || '');
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
    console.log('[EditMode] AdminEditPanel: Save clicked for', venue.id);
    setSaving(true);
    setError('');
    try {
      await onSave({
        name, categories, subcategory: subcategory || null,
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
      console.error('[EditMode] AdminEditPanel: save FAILED:', e.message);
      setError(e.message);
    }
    setSaving(false);
  };

  const del = async () => {
    console.log('[EditMode] AdminEditPanel: Delete clicked for', venue.id);
    if (!window.confirm('Are you sure? This cannot be undone.')) {
      console.log('[EditMode] AdminEditPanel: delete cancelled');
      return;
    }
    setDeleting(true);
    setError('');
    try {
      await onDelete();
    } catch (e) {
      console.error('[EditMode] AdminEditPanel: delete FAILED:', e.message);
      setError(e.message);
      setDeleting(false);
    }
  };

  // Which SUBCATEGORY_OPTIONS list applies — keyed off whichever category
  // is checked first above, same "first entry is primary" convention
  // update-venue.js uses when it syncs venues.category from the array.
  const primaryCat = categories[0] || venue.category || '';
  const subcatOptions = SUBCATEGORY_OPTIONS[primaryCat] || [];

  return (
    <>
      {/* Skipped entirely while relocating — this is a transparent,
          full-viewport, very-high-z-index click-catcher (click outside the
          panel to close it), which otherwise sits directly on top of the
          map and swallows the exact click "Click map to move" is waiting
          for before it ever reaches Google Maps' own click listener. */}
      {!relocating && <div className="edit-panel-overlay" onClick={onClose} />}
      <div className="edit-panel" onClick={(e) => e.stopPropagation()}>
        <div className="edit-panel-header">
          <span>✏️ Edit Venue</span>
          <button className="edit-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="edit-panel-body admin-modal-body">
          <div
            className="edit-panel-cover"
            style={venue.cover_photo_url ? { backgroundImage: `url(${venue.cover_photo_url})` } : undefined}
          >
            {!venue.cover_photo_url && <span>📸 No cover photo</span>}
          </div>

          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />

          <label>Emoji</label>
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

          <label>Categories</label>
          <div className="admin-checkbox-grid">
            {PANEL_CATEGORIES.map(c => (
              <label key={c.id} className="admin-checkbox-item">
                <input
                  type="checkbox"
                  checked={categories.includes(c.id)}
                  onChange={() => setCategories(prev => toggleInArray(prev, c.id))}
                />
                {c.label}
              </label>
            ))}
          </div>

          <label>Subcategory</label>
          {subcatOptions.length > 0 ? (
            <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
              <option value="">Select subcategory…</option>
              {subcatOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              value={subcategory}
              placeholder="e.g. Craft Beer Bar, Speakeasy, Golf Course"
              onChange={(e) => setSubcategory(e.target.value)}
            />
          )}

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

          {error && <div className="admin-modal-error">⚠️ {error}</div>}

          <button className="edit-panel-save-btn" onClick={save} disabled={saving || deleting || !name || !categories.length}>
            {saving ? 'Saving…' : '💾 Save Changes'}
          </button>
          <button className="edit-panel-delete-btn" onClick={del} disabled={saving || deleting}>
            {deleting ? 'Deleting…' : '🗑️ Delete Venue'}
          </button>
        </div>
      </div>
    </>
  );
}

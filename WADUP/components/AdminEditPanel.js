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

export default function AdminEditPanel({
  venue,             // live venues row being edited
  relocateTarget,    // { lat, lng } | null — set by the parent once "Click map to move" captures a new spot
  relocating,        // true while the parent is waiting for that next map click
  onStartRelocate,
  onClose,
  onSave,            // async (fields) => void — throws on failure
  onDelete,          // async () => void — throws on failure
}) {
  const [name, setName] = useState(venue.name || '');
  const [categories, setCategories] = useState(venueCategories(venue));
  const [subcategory, setSubcategory] = useState(venue.subcategory || '');
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

  return (
    <>
      <div className="edit-panel-overlay" onClick={onClose} />
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
          <input
            value={subcategory}
            placeholder="e.g. Craft Beer Bar, Speakeasy, Golf Course"
            onChange={(e) => setSubcategory(e.target.value)}
          />

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
          <button
            type="button"
            className={`edit-panel-relocate-btn${relocating ? ' active' : ''}`}
            onClick={onStartRelocate}
          >
            {relocating ? '📌 Click the map…' : '📌 Click map to move'}
          </button>

          <label>⭐ Google Rating</label>
          <div className="edit-panel-readonly">
            {venue.google_rating != null ? venue.google_rating.toFixed(1) : '—'} (read only)
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

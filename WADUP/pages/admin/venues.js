import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import { getAdminRole, isSuperAdmin } from '../../lib/admin';
import { CATEGORY_CHIPS } from '../../lib/data';
import AdminSidebar from '../../components/AdminSidebar';

const CATEGORY_TEXT = {
  nightlife: 'Nightlife', restaurant: 'Restaurant', events: 'Events',
  sports: 'Sports', outdoors: 'Outdoors', activities: 'Activities',
};
const CATEGORY_ICON = {
  nightlife: '🍸', restaurant: '🍔', events: '🎵', sports: '🏟️', outdoors: '🌳', activities: '🎳',
};
const EMOJI_CHOICES = ['🍸','🍔','🎵','🏟️','🌳','🎳','⛳','🎬','🎤','☕','🍺','🍕','🎨','🏋️','🎯','🎱','🏊','🚴','🍩','🍦'];
const EDITABLE_CATEGORIES = CATEGORY_CHIPS.filter(c => c.id !== 'all');

function venueIcon(v) {
  return v.custom_emoji || CATEGORY_ICON[v.category] || '📍';
}

async function authedFetch(url, session, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function EditVenueModal({ venue, session, onClose, onSaved }) {
  const [name, setName] = useState(venue.name || '');
  const [category, setCategory] = useState(venue.category || '');
  const [subcategory, setSubcategory] = useState(venue.subcategory || '');
  const [emoji, setEmoji] = useState(venue.custom_emoji || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [visible, setVisible] = useState(!venue.is_hidden);
  const [verified, setVerified] = useState(!!venue.is_verified);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await authedFetch('/api/admin/update-venue', session, {
        venueId: venue.id,
        updates: {
          name, category, subcategory: subcategory || null,
          custom_emoji: emoji || null,
          is_hidden: !visible,
          is_verified: verified,
        },
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <span>Edit Venue</span>
          <button className="admin-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="admin-modal-body">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />

          <label>Emoji</label>
          <div className="admin-emoji-row">
            <button type="button" className="admin-emoji-current" onClick={() => setPickerOpen(v => !v)}>
              {emoji || CATEGORY_ICON[category] || '📍'}
            </button>
            <span className="admin-emoji-hint">Click to change</span>
          </div>
          {pickerOpen && (
            <div className="admin-emoji-picker">
              {EMOJI_CHOICES.map(e => (
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

          <label>Category</label>
          <div className="admin-checkbox-grid">
            {/* Single-select in practice — venues.category is one text column,
                not an array, so checking one clears the others. Rendered as
                checkboxes to match the requested layout. */}
            {EDITABLE_CATEGORIES.map(c => (
              <label key={c.id} className="admin-checkbox-item">
                <input
                  type="checkbox"
                  checked={category === c.id}
                  onChange={() => setCategory(c.id)}
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

          <div className="admin-toggle-row">
            <label className="admin-toggle">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
              Visible
            </label>
            <label className="admin-toggle">
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              Verified
            </label>
          </div>

          {error && <div className="admin-modal-error">⚠️ {error}</div>}

          <button className="admin-save-btn" onClick={save} disabled={saving || !name || !category}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddVenueModal({ session, defaultCity, defaultState, onClose, onAdded }) {
  const [mode, setMode] = useState('search'); // 'search' | 'manual'
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', address: '', city: defaultCity || '', state: defaultState || '',
    lat: '', lng: '', category: 'nightlife', subcategory: '', custom_emoji: '',
  });
  const setField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const data = await authedFetch('/api/admin/places-search', session, {
        venueName: searchQuery, city: defaultCity, state: defaultState,
      });
      setSearchResults(data.results || []);
    } catch (e) {
      setError(e.message);
    }
    setSearching(false);
  };

  const pickResult = (r) => {
    setForm(f => ({
      ...f,
      name: r.name, address: r.address || '', lat: r.lat ?? '', lng: r.lng ?? '',
      subcategory: r.subcategory || '',
      google_place_id: r.google_place_id, google_rating: r.google_rating,
      google_review_count: r.google_review_count, cover_photo_url: r.cover_photo_url, hours: r.hours,
    }));
    setMode('manual'); // drop into the review/edit form with fields pre-filled
  };

  const submit = async () => {
    if (!form.name || !form.city || !form.category) {
      setError('Name, city, and category are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await authedFetch('/api/admin/add-venue', session, {
        venue: {
          ...form,
          lat: form.lat === '' ? null : parseFloat(form.lat),
          lng: form.lng === '' ? null : parseFloat(form.lng),
          subcategory: form.subcategory || null,
          custom_emoji: form.custom_emoji || null,
          source: form.google_place_id ? 'google_places' : 'manual',
        },
      });
      onAdded();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <span>Add Venue</span>
          <button className="admin-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="admin-modal-body">
          <div className="admin-tabs">
            <button className={`admin-tab-btn${mode === 'search' ? ' active' : ''}`} onClick={() => setMode('search')}>
              Search Google Places
            </button>
            <button className={`admin-tab-btn${mode === 'manual' ? ' active' : ''}`} onClick={() => setMode('manual')}>
              Add Manually
            </button>
          </div>

          {mode === 'search' ? (
            <>
              <label>Business name</label>
              <div className="admin-search-row">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="e.g. Easy Bistro"
                />
                <button className="admin-save-btn" onClick={runSearch} disabled={searching}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="admin-modal-error">⚠️ {error}</div>}
              {searchResults && (
                <div className="admin-search-results">
                  {searchResults.length === 0 ? (
                    <div className="admin-sync-desc">No results.</div>
                  ) : searchResults.map(r => (
                    <div key={r.google_place_id} className="admin-search-result" onClick={() => pickResult(r)}>
                      <div className="admin-venue-name">{r.name}</div>
                      <div className="admin-venue-meta">{r.formattedAddress}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <label>Name</label>
              <input value={form.name} onChange={(e) => setField('name', e.target.value)} />
              <label>Address</label>
              <input value={form.address} onChange={(e) => setField('address', e.target.value)} />
              <div className="admin-form-row">
                <div>
                  <label>City</label>
                  <input value={form.city} onChange={(e) => setField('city', e.target.value)} />
                </div>
                <div>
                  <label>State</label>
                  <input value={form.state} onChange={(e) => setField('state', e.target.value)} maxLength={2} />
                </div>
              </div>
              <div className="admin-form-row">
                <div>
                  <label>Lat</label>
                  <input value={form.lat} onChange={(e) => setField('lat', e.target.value)} />
                </div>
                <div>
                  <label>Lng</label>
                  <input value={form.lng} onChange={(e) => setField('lng', e.target.value)} />
                </div>
              </div>
              <label>Category</label>
              <div className="admin-checkbox-grid">
                {EDITABLE_CATEGORIES.map(c => (
                  <label key={c.id} className="admin-checkbox-item">
                    <input
                      type="checkbox"
                      checked={form.category === c.id}
                      onChange={() => setField('category', c.id)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <label>Subcategory</label>
              <input value={form.subcategory} onChange={(e) => setField('subcategory', e.target.value)} />
              <label>Emoji (optional override)</label>
              <input
                value={form.custom_emoji}
                onChange={(e) => setField('custom_emoji', e.target.value)}
                placeholder={CATEGORY_ICON[form.category] || '📍'}
                maxLength={4}
              />

              {error && <div className="admin-modal-error">⚠️ {error}</div>}
              <button className="admin-save-btn" onClick={submit} disabled={saving}>
                {saving ? 'Adding…' : 'Add Venue'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminVenues() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [adminRole, setAdminRole] = useState(null);
  const [session, setSession] = useState(null);

  const [allVenues, setAllVenues] = useState([]);
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [search, setSearch] = useState('');

  const [editingVenue, setEditingVenue] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [actionError, setActionError] = useState('');

  const bootstrap = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s?.user) { router.replace('/'); return; }
    const role = await getAdminRole(supabase, s.user.id);
    if (!role) { router.replace('/'); return; }
    setSession(s);
    setAdminRole(role);
    setChecking(false);
  }, [router]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const loadVenues = useCallback(async () => {
    if (!adminRole) return;
    setLoadingVenues(true);
    let query = supabase.from('venues').select('*').order('name', { ascending: true });
    if (!isSuperAdmin(adminRole)) {
      if (!adminRole.cities?.length) { setAllVenues([]); setLoadingVenues(false); return; }
      query = query.in('city', adminRole.cities);
    }
    const { data } = await query;
    setAllVenues(data || []);
    setLoadingVenues(false);
  }, [adminRole]);

  useEffect(() => { loadVenues(); }, [loadVenues]);

  const states = useMemo(() => [...new Set(allVenues.map(v => v.state).filter(Boolean))].sort(), [allVenues]);
  useEffect(() => { if (!selectedState && states.length) setSelectedState(states[0]); }, [states, selectedState]);

  const citiesForState = useMemo(
    () => [...new Set(allVenues.filter(v => v.state === selectedState).map(v => v.city).filter(Boolean))].sort(),
    [allVenues, selectedState]
  );
  useEffect(() => { if (citiesForState.length && !citiesForState.includes(selectedCity)) setSelectedCity(citiesForState[0]); }, [citiesForState, selectedCity]);

  const visibleVenues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allVenues
      .filter(v => v.state === selectedState && v.city === selectedCity)
      .filter(v => !q || v.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allVenues, selectedState, selectedCity, search]);

  const toggleHidden = async (venue) => {
    setActionError('');
    try {
      await authedFetch('/api/admin/update-venue', session, {
        venueId: venue.id, updates: { is_hidden: !venue.is_hidden },
      });
      loadVenues();
    } catch (e) {
      setActionError(e.message);
    }
  };

  const deleteVenue = async (venue) => {
    if (!window.confirm(`Permanently delete "${venue.name}"? This cannot be undone.`)) return;
    setActionError('');
    try {
      await authedFetch('/api/admin/delete-venue', session, { venueId: venue.id });
      loadVenues();
    } catch (e) {
      setActionError(e.message);
    }
  };

  if (checking) return <div className="venue-page-status admin-loading"><div className="cover-spin" /></div>;

  return (
    <>
      <Head>
        <title>Venue Manager — WadUp Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="admin-shell">
        <AdminSidebar adminRole={adminRole} />
        <main className="admin-main">
          <h1 className="admin-page-title">Venue Manager</h1>

          <div className="admin-filter-row">
            <select value={selectedState} onChange={(e) => { setSelectedState(e.target.value); setSelectedCity(''); }}>
              {states.length === 0 && <option value="">No states</option>}
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)}>
              {citiesForState.length === 0 && <option value="">No cities</option>}
              {citiesForState.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              className="admin-venue-search"
              type="text"
              placeholder="Search venues…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="admin-add-venue-btn" onClick={() => setAddOpen(true)}>+ Add Venue</button>
          </div>

          {actionError && <div className="admin-modal-error">⚠️ {actionError}</div>}

          {loadingVenues ? (
            <div className="admin-sync-desc">Loading venues…</div>
          ) : visibleVenues.length === 0 ? (
            <div className="admin-sync-desc">No venues match.</div>
          ) : (
            <div className="admin-venue-table">
              {visibleVenues.map(v => (
                <div key={v.id} className="admin-venue-table-row">
                  <span className="admin-venue-table-icon">{venueIcon(v)}</span>
                  <span className="admin-venue-table-name">{v.name}</span>
                  <span className="admin-venue-table-category">{CATEGORY_TEXT[v.category] || v.category}</span>
                  <span className={`admin-venue-table-status${v.is_hidden ? ' hidden' : ''}`}>
                    {v.is_hidden ? '❌ Hidden' : '✅ Visible'}
                  </span>
                  <div className="admin-venue-table-actions">
                    <button onClick={() => setEditingVenue(v)}>Edit</button>
                    <button onClick={() => toggleHidden(v)}>{v.is_hidden ? 'Show' : 'Hide'}</button>
                    {isSuperAdmin(adminRole) && (
                      <button className="admin-danger-btn" onClick={() => deleteVenue(v)}>Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {editingVenue && (
        <EditVenueModal
          venue={editingVenue}
          session={session}
          onClose={() => setEditingVenue(null)}
          onSaved={() => { setEditingVenue(null); loadVenues(); }}
        />
      )}
      {addOpen && (
        <AddVenueModal
          session={session}
          defaultCity={selectedCity}
          defaultState={selectedState}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); loadVenues(); }}
        />
      )}
    </>
  );
}

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import { getAdminRole, isSuperAdmin } from '../../lib/admin';
import { CATEGORY_CHIPS, venueCategories } from '../../lib/data';
import AdminSidebar from '../../components/AdminSidebar';

const CATEGORY_TEXT = {
  nightlife: 'Nightlife', restaurant: 'Restaurant', events: 'Events',
  sports: 'Sports', outdoors: 'Outdoors', activities: 'Activities',
};
const CATEGORY_ICON = {
  nightlife: '🍸', restaurant: '🍔', events: '🎵', sports: '🏟️', outdoors: '🌳', activities: '🎳',
};
const EMOJI_OPTIONS = [
  // Food & Drink
  '🍔', '🍕', '🌮', '🍣', '🍜', '🥢', '🍱', '🥩', '🍗', '🥗',
  '🍺', '🍸', '🍷', '☕', '🧃', '🥂', '🍾', '🧉',
  // Activities
  '🎳', '⛳', '🏌️', '🧗', '🚣', '🏊', '🎯', '🎮', '🎪', '🎠',
  '🎭', '🎬', '🎵', '🎤', '🎸', '🎺',
  // Sports
  '🏈', '⚾', '🏀', '🏒', '⚽', '🎾', '🏋️', '🤼', '🏇', '🥊',
  // Nature & Outdoors
  '🌳', '🌲', '⛰️', '🏔️', '🌊', '🏕️', '🌿', '🌺',
  // Places & Vibes
  '🍽️', '🕯️', '✨', '👑', '🔥', '⭐', '💎', '🏆',
  '🎉', '🎊', '🌙', '🌅', '🏙️', '🗺️',
  // Specific
  '🎰', '🎲', '🃏',
];
const EDITABLE_CATEGORIES = CATEGORY_CHIPS.filter(c => c.id !== 'all');

function venueIcon(v) {
  return v.custom_emoji || CATEGORY_ICON[venueCategories(v)[0]] || '📍';
}

function toggleCategory(categories, id) {
  return categories.includes(id) ? categories.filter(c => c !== id) : [...categories, id];
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
  const [categories, setCategories] = useState(venueCategories(venue));
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
          name, categories, subcategory: subcategory || null,
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
              {emoji || CATEGORY_ICON[categories[0]] || '📍'}
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
            {EDITABLE_CATEGORIES.map(c => (
              <label key={c.id} className="admin-checkbox-item">
                <input
                  type="checkbox"
                  checked={categories.includes(c.id)}
                  onChange={() => setCategories(prev => toggleCategory(prev, c.id))}
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

          <button className="admin-save-btn" onClick={save} disabled={saving || !name || !categories.length}>
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
    lat: '', lng: '', categories: ['nightlife'], subcategory: '', custom_emoji: '',
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
    if (!form.name || !form.city || !form.categories?.length) {
      setError('Name, city, and at least one category are required');
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
              <label>Categories</label>
              <div className="admin-checkbox-grid">
                {EDITABLE_CATEGORIES.map(c => (
                  <label key={c.id} className="admin-checkbox-item">
                    <input
                      type="checkbox"
                      checked={form.categories.includes(c.id)}
                      onChange={() => setField('categories', toggleCategory(form.categories, c.id))}
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
                placeholder={CATEGORY_ICON[form.categories[0]] || '📍'}
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

const SORT_OPTIONS = [
  { id: 'az',       label: 'A-Z' },
  { id: 'za',       label: 'Z-A' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'google',   label: 'Google Rating' },
  { id: 'votes',    label: 'Vote Score' },
];

// Mirrors lib/rankings.js's applyAdminRankOverride (a module-private helper
// there) — duplicated rather than exported/imported since this operates on
// an already-in-memory venue list instead of running its own Supabase query.
function sortByRankOverrideThenVotes(venues, category) {
  const overridden = venues
    .filter(v => v.admin_rank_override?.[category] != null)
    .sort((a, b) => a.admin_rank_override[category] - b.admin_rank_override[category]);
  const rest = venues
    .filter(v => v.admin_rank_override?.[category] == null)
    .sort((a, b) => (b.vote_score || 0) - (a.vote_score || 0));
  return [...overridden, ...rest];
}

function RankingsView({ venues, category, session, onSaved }) {
  const [order, setOrder] = useState(venues);
  const dragIndexRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setOrder(venues); }, [venues]);

  const onDragOver = (e, i) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === i) return;
    setOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      return next;
    });
    dragIndexRef.current = i;
  };

  const onDrop = async () => {
    dragIndexRef.current = null;
    setSaving(true);
    setError('');
    try {
      await Promise.all(order.map((v, idx) =>
        authedFetch('/api/admin/update-venue', session, {
          venueId: v.id,
          updates: { admin_rank_override: { ...(v.admin_rank_override || {}), [category]: idx } },
        })
      ));
      onSaved();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  if (!order.length) return <div className="admin-sync-desc">No venues in this category yet.</div>;

  return (
    <div className="admin-rankings-list">
      {order.map((v, i) => (
        <div
          key={v.id}
          className={`admin-rankings-row${v.admin_rank_override?.[category] != null ? ' overridden' : ''}`}
          draggable
          onDragStart={() => { dragIndexRef.current = i; }}
          onDragOver={(e) => onDragOver(e, i)}
          onDrop={onDrop}
        >
          <span className="admin-drag-handle">⠿</span>
          <span className="admin-venue-table-icon">{venueIcon(v)}</span>
          <span className="admin-venue-table-name">{v.name}</span>
          <span className="admin-rankings-score">{v.vote_score || 0} pts</span>
        </div>
      ))}
      {saving && <div className="admin-sync-desc">Saving order…</div>}
      {error && <div className="admin-modal-error">⚠️ {error}</div>}
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
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortMode, setSortMode] = useState('az');
  const [rankingsTab, setRankingsTab] = useState(EDITABLE_CATEGORIES[0].id);

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

  const scopedVenues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allVenues
      .filter(v => v.state === selectedState && v.city === selectedCity)
      .filter(v => categoryFilter === 'all' || venueCategories(v).includes(categoryFilter))
      .filter(v => !q || v.name.toLowerCase().includes(q));
  }, [allVenues, selectedState, selectedCity, categoryFilter, search]);

  const visibleVenues = useMemo(() => {
    const list = [...scopedVenues];
    if (sortMode === 'za') return list.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === 'google') return list.sort((a, b) => (b.google_rating || 0) - (a.google_rating || 0));
    if (sortMode === 'votes') return list.sort((a, b) => (b.vote_score || 0) - (a.vote_score || 0));
    return list.sort((a, b) => a.name.localeCompare(b.name)); // 'az' and the default
  }, [scopedVenues, sortMode]);

  const rankingsVenues = useMemo(() => {
    const list = allVenues.filter(v =>
      v.state === selectedState && v.city === selectedCity && venueCategories(v).includes(rankingsTab)
    );
    return sortByRankOverrideThenVotes(list, rankingsTab);
  }, [allVenues, selectedState, selectedCity, rankingsTab]);

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
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {EDITABLE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{CATEGORY_TEXT[c.id]}</option>)}
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

          <div className="admin-sort-row">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.id}
                className={`admin-sort-btn${sortMode === opt.id ? ' active' : ''}`}
                onClick={() => setSortMode(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {actionError && <div className="admin-modal-error">⚠️ {actionError}</div>}

          {sortMode === 'rankings' ? (
            <>
              <div className="admin-rankings-tabs">
                {EDITABLE_CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    className={`admin-rankings-tab${rankingsTab === c.id ? ' active' : ''}`}
                    onClick={() => setRankingsTab(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {loadingVenues ? (
                <div className="admin-sync-desc">Loading venues…</div>
              ) : (
                <RankingsView
                  venues={rankingsVenues}
                  category={rankingsTab}
                  session={session}
                  onSaved={loadVenues}
                />
              )}
            </>
          ) : loadingVenues ? (
            <div className="admin-sync-desc">Loading venues…</div>
          ) : visibleVenues.length === 0 ? (
            <div className="admin-sync-desc">No venues match.</div>
          ) : (
            <div className="admin-venue-table">
              {visibleVenues.map(v => (
                <div key={v.id} className="admin-venue-table-row">
                  <span className="admin-venue-table-icon">{venueIcon(v)}</span>
                  <span className="admin-venue-table-name">{v.name}</span>
                  <span className="admin-venue-table-category">
                    {venueCategories(v).map(c => CATEGORY_TEXT[c] || c).join(', ')}
                  </span>
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

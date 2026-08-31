import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import { getAdminRole, isSuperAdmin } from '../../lib/admin';
import AdminSidebar from '../../components/AdminSidebar';

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

function CityChipInput({ cities, setCities, knownCities }) {
  const [input, setInput] = useState('');
  const addCity = () => {
    const c = input.trim();
    if (c && !cities.includes(c)) setCities([...cities, c]);
    setInput('');
  };
  return (
    <div className="admin-city-input">
      <div className="admin-city-chips">
        {cities.map(c => (
          <span key={c} className="admin-city-chip">
            {c}
            <button type="button" onClick={() => setCities(cities.filter(x => x !== c))}>✕</button>
          </span>
        ))}
      </div>
      <div className="admin-city-add-row">
        <input
          list="admin-known-cities"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCity(); } }}
          placeholder="Add a city…"
        />
        <datalist id="admin-known-cities">
          {knownCities.map(c => <option key={c} value={c} />)}
        </datalist>
        <button type="button" onClick={addCity}>+ Add</button>
      </div>
    </div>
  );
}

export default function AdminAmbassadors() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [adminRole, setAdminRole] = useState(null);
  const [session, setSession] = useState(null);

  const [ambassadors, setAmbassadors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [knownCities, setKnownCities] = useState([]);
  const [error, setError] = useState('');

  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState(null);
  const [promoting, setPromoting] = useState(null); // user object mid-assignment
  const [promoteCities, setPromoteCities] = useState([]);

  const [editingId, setEditingId] = useState(null); // ambassador user_id being city-edited
  const [editCities, setEditCities] = useState([]);

  const bootstrap = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s?.user) { router.replace('/'); return; }
    const role = await getAdminRole(supabase, s.user.id);
    if (!role) { router.replace('/'); return; }
    if (!isSuperAdmin(role)) { router.replace('/admin'); return; }
    setSession(s);
    setAdminRole(role);
    setChecking(false);
  }, [router]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const loadAmbassadors = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('admin_roles')
      .select('user_id, assigned_cities, profiles(username, email)')
      .eq('role', 'ambassador')
      .order('created_at', { ascending: false });
    setAmbassadors(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (!checking) loadAmbassadors(); }, [checking, loadAmbassadors]);

  useEffect(() => {
    supabase.from('venues').select('city').then(({ data }) => {
      setKnownCities([...new Set((data || []).map(v => v.city).filter(Boolean))].sort());
    });
  }, []);

  const searchUsers = async () => {
    const q = userQuery.trim();
    if (!q) { setUserResults(null); return; }
    const { data } = await supabase
      .from('profiles')
      .select('id, username, email, account_type')
      .or(`username.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);
    setUserResults(data || []);
  };

  const confirmPromote = async () => {
    setError('');
    try {
      await authedFetch('/api/admin/assign-ambassador', session, {
        action: 'assign', userId: promoting.id, cities: promoteCities, states: [],
      });
      setPromoting(null);
      setPromoteCities([]);
      setUserResults(null);
      setUserQuery('');
      loadAmbassadors();
    } catch (e) {
      setError(e.message);
    }
  };

  const saveCities = async (userId) => {
    setError('');
    try {
      await authedFetch('/api/admin/assign-ambassador', session, {
        action: 'assign', userId, cities: editCities, states: [],
      });
      setEditingId(null);
      loadAmbassadors();
    } catch (e) {
      setError(e.message);
    }
  };

  const removeAmbassador = async (userId) => {
    if (!window.confirm('Remove ambassador access for this user?')) return;
    setError('');
    try {
      await authedFetch('/api/admin/assign-ambassador', session, { action: 'remove', userId });
      loadAmbassadors();
    } catch (e) {
      setError(e.message);
    }
  };

  if (checking) return <div className="venue-page-status admin-loading"><div className="cover-spin" /></div>;

  return (
    <>
      <Head>
        <title>Ambassadors — WadUp Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="admin-shell">
        <AdminSidebar adminRole={adminRole} />
        <main className="admin-main">
          <h1 className="admin-page-title">Ambassador Manager</h1>

          {error && <div className="admin-modal-error">⚠️ {error}</div>}

          <div className="admin-ambassador-search">
            <h2>Promote a user</h2>
            <div className="admin-search-row">
              <input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') searchUsers(); }}
                placeholder="Search by username or email…"
              />
              <button className="admin-save-btn" onClick={searchUsers}>Search</button>
            </div>
            {userResults && (
              <div className="admin-search-results">
                {userResults.length === 0 ? (
                  <div className="admin-sync-desc">No matching users.</div>
                ) : userResults.map(u => (
                  <div key={u.id} className="admin-user-result">
                    <div>
                      <div className="admin-venue-name">@{u.username}</div>
                      <div className="admin-venue-meta">{u.email}</div>
                    </div>
                    <button onClick={() => { setPromoting(u); setPromoteCities([]); }}>Promote</button>
                  </div>
                ))}
              </div>
            )}

            {promoting && (
              <div className="admin-promote-box">
                <div className="admin-venue-name">Assign cities for @{promoting.username}</div>
                <CityChipInput cities={promoteCities} setCities={setPromoteCities} knownCities={knownCities} />
                <div className="admin-promote-actions">
                  <button className="admin-save-btn" onClick={confirmPromote} disabled={!promoteCities.length}>
                    Confirm — Make Ambassador
                  </button>
                  <button onClick={() => setPromoting(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          <h2>Current Ambassadors</h2>
          {loading ? (
            <div className="admin-sync-desc">Loading…</div>
          ) : ambassadors.length === 0 ? (
            <div className="admin-sync-desc">No ambassadors yet.</div>
          ) : (
            <div className="admin-ambassador-table">
              {ambassadors.map(a => (
                <div key={a.user_id} className="admin-ambassador-row">
                  <div className="admin-venue-info">
                    <div className="admin-venue-name">@{a.profiles?.username}</div>
                    <div className="admin-venue-meta">{a.profiles?.email}</div>
                  </div>
                  {editingId === a.user_id ? (
                    <div className="admin-promote-box">
                      <CityChipInput cities={editCities} setCities={setEditCities} knownCities={knownCities} />
                      <div className="admin-promote-actions">
                        <button className="admin-save-btn" onClick={() => saveCities(a.user_id)}>Save</button>
                        <button onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="admin-ambassador-cities">
                      {(a.assigned_cities || []).join(', ') || '(no cities assigned)'}
                    </div>
                  )}
                  <div className="admin-venue-table-actions">
                    <button onClick={() => { setEditingId(a.user_id); setEditCities(a.assigned_cities || []); }}>
                      Edit Cities
                    </button>
                    <button className="admin-danger-btn" onClick={() => removeAmbassador(a.user_id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

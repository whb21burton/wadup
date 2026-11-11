import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import { getAdminRole, isSuperAdmin } from '../../lib/admin';
import { venueMatchesChip } from '../../lib/data';
import { adminBaseline, scoreBetween, wadupScore } from '../../lib/wadup-score';
import AdminSidebar from '../../components/AdminSidebar';

export default function AdminRankings() {
  const router = useRouter();
  const [role, setRole] = useState(null);
  const [session, setSession] = useState(null);
  const [venues, setVenues] = useState([]);
  const [city, setCity] = useState('Chattanooga');
  const [category, setCategory] = useState('activities');
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState({});
  const [order, setOrder] = useState([]);
  const [dragged, setDragged] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) { router.replace('/'); return; }
      const r = await getAdminRole(supabase, s.user.id);
      if (!isSuperAdmin(r)) { router.replace('/admin'); return; }
      if (active) { setRole(r); setSession(s); }
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!role) return;
    let active = true;
    setLoading(true);
    // Limit to 1,000 per city; paging will be added for larger markets.
    supabase.from('venues')
      .select('id,name,city,categories,subcategory,subcategories,admin_rating,google_rating,google_review_count,average_rating,total_ratings,is_hidden')
      .eq('city', city).eq('is_hidden', false).limit(1000)
      .then(({ data, error }) => {
        if (!active) return;
        setStatus(error?.message || '');
        setVenues(data || []);
        setDirty({});
        setOrder([]);
        setLoading(false);
      });
    return () => { active = false; };
  }, [role, city]);

  const filtered = useMemo(() => venues.filter(v =>
    venueMatchesChip(category, v) &&
    v.name.toLowerCase().includes(search.toLowerCase())
  ).sort((a,b) => (dirty[b.id] ?? adminBaseline(b)) - (dirty[a.id] ?? adminBaseline(a)) || a.name.localeCompare(b.name)),
  [venues, category, search, dirty]);

  const reorder = (fromId, toId) => {
    if (fromId === toId) return;
    const current = [...filtered];
    const from = current.findIndex(v => v.id === fromId);
    const to = current.findIndex(v => v.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    const above = current[to - 1];
    const below = current[to + 1];
    const upper = above ? (dirty[above.id] ?? adminBaseline(above)) : null;
    const lower = below ? (dirty[below.id] ?? adminBaseline(below)) : null;
    const score = scoreBetween(upper, lower);
    if ((upper != null && score >= upper) || (lower != null && score <= lower)) {
      setStatus('Scores are too close to insert here. Move another venue or adjust the neighboring scores first.');
      return;
    }
    setDirty(prev => ({ ...prev, [moved.id]: score }));
    setStatus('Unsaved ranking change');
  };

  const save = async () => {
    if (!session || !Object.keys(dirty).length) return;
    setStatus('Saving...');
    try {
      const response = await fetch('/api/admin/rankings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ updates: Object.entries(dirty).map(([id,score]) => ({ id, score })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Save failed');
      setVenues(prev => prev.map(v => dirty[v.id] == null ? v : { ...v, admin_rating: dirty[v.id] }));
      setDirty({});
      setStatus(`Saved ${result.saved} venue score(s)`);
    } catch (e) { setStatus(e.message); }
  };

  return <div className="admin-layout">
    <Head><title>Wadup Rankings Manager</title></Head>
    <AdminSidebar adminRole={role} />
    <main className="admin-main" style={{ padding: '28px', color: '#fff' }}>
      <h1>🏆 Rankings Manager</h1>
      <p style={{ color: '#9cb5c5' }}>Drag venues to rank them. Only the super admin can save changes. Your ranking carries the weight of 10 user reviews, without creating fake reviews.</p>
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, margin:'20px 0' }}>
        <select aria-label="City" value={city} onChange={e=>setCity(e.target.value)}><option>Chattanooga</option></select>
        <select aria-label="Category" value={category} onChange={e=>{setCategory(e.target.value);setDirty({});}}>
          {['activities','restaurant','nightlife','outdoors','sports','events'].map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <input aria-label="Search venues" placeholder="Find a venue..." value={search} onChange={e=>setSearch(e.target.value)} />
        <button disabled={!Object.keys(dirty).length} onClick={save} style={{background:'#ffeb00',padding:'10px 18px',borderRadius:9,color:'#111',fontWeight:700}}>Save rankings ({Object.keys(dirty).length})</button>
      </div>
      {status && <p role="status">{status}</p>}
      {loading ? <p>Loading venues...</p> : filtered.map((v,i)=><div key={v.id} draggable
        onDragStart={e=>{setDragged(v.id);e.dataTransfer.effectAllowed='move';}}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();reorder(dragged,v.id);setDragged(null);}}
        onDragEnd={()=>setDragged(null)}
        style={{display:'flex',alignItems:'center',gap:12,padding:'13px',marginBottom:7,border:'1px solid #254054',borderRadius:10,background:dirty[v.id]!=null?'#153640':'#101b2b',cursor:'grab'}}>
        <span aria-hidden="true">⠿</span><strong style={{minWidth:42}}>#{i+1}</strong>
        <span style={{flex:1}}>{v.name}</span>
        <span style={{color:'#90a6b6',fontSize:12}}>Google seed {v.google_rating ?? '—'}/5</span>
        <strong style={{color:'#ffeb00'}}>{(dirty[v.id] != null ? ((10 * dirty[v.id] + (v.total_ratings || 0) * (Number(v.average_rating) || 0)) / (10 + (v.total_ratings || 0))) : wadupScore(v)).toFixed(2)}/10</strong>
        <button aria-label={`Move ${v.name} up`} disabled={i===0} onClick={()=>reorder(v.id,filtered[i-1].id)}>↑</button>
        <button aria-label={`Move ${v.name} down`} disabled={i===filtered.length-1} onClick={()=>reorder(v.id,filtered[i+1].id)}>↓</button>
      </div>)}
    </main>
  </div>;
}

import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';
import { CATEGORY_LABELS } from '../../lib/data';

export default function BrowseVenues() {
  const [venues,  setVenues]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [query,   setQuery]   = useState('');

  useEffect(() => {
    supabase
      .from('venues')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        setVenues(data || []);
        setLoading(false);
      });
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? venues.filter(v =>
          v.name?.toLowerCase().includes(q) ||
          v.city?.toLowerCase().includes(q) ||
          v.subcategory?.toLowerCase().includes(q))
      : venues;

    const groups = {};
    filtered.forEach(v => {
      const key = v.category || 'other';
      (groups[key] = groups[key] || []).push(v);
    });
    return groups;
  }, [venues, query]);

  const categoryOrder = Object.keys(grouped).sort((a, b) =>
    (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b)
  );

  return (
    <>
      <Head>
        <title>Browse Venues — WadUp</title>
        <meta name="description" content="Browse bars, nightlife, outdoors, and activities on WadUp." />
      </Head>

      <div className="browse-page">
        <div className="browse-header">
          <Link href="/" className="venue-back-btn" aria-label="Back to map">←</Link>
          <h1>Browse Venues</h1>
        </div>

        <input
          className="browse-search"
          type="text"
          placeholder="Search by name, city, or type…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {loading ? (
          <div className="venue-page-status"><div className="cover-spin" /></div>
        ) : venues.length === 0 ? (
          <p className="venue-empty-note">No venues yet — check back soon.</p>
        ) : categoryOrder.length === 0 ? (
          <p className="venue-empty-note">No venues match &ldquo;{query}&rdquo;.</p>
        ) : (
          categoryOrder.map(cat => (
            <div key={cat} className="browse-group">
              <h2 className="browse-group-title">{CATEGORY_LABELS[cat] || cat}</h2>
              <div className="browse-grid">
                {grouped[cat].map(v => (
                  <Link key={v.id} href={`/venue/${v.id}`} className="browse-card">
                    <div className="browse-card-name">{v.name}</div>
                    <div className="browse-card-sub">{v.subcategory || ''}</div>
                    <div className="browse-card-meta">
                      <span>📍 {v.city}{v.state ? `, ${v.state}` : ''}</span>
                      {(v.total_ratings || 0) >= 5 && (
                        <span className="browse-card-rating">⭐ {(v.average_rating || 0).toFixed(1)}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

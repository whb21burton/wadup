import { useState } from 'react';
import { venueCategories } from '../lib/data';

// There's no per-venue "does it actually serve burgers" flag in the schema —
// these presets show for every restaurant/nightlife venue regardless, as
// optional fields a reviewer can just skip. custom_subcategories (set by an
// admin per venue — see pages/admin/venues.js) is the real per-venue
// mechanism and is appended on top, deduped against the presets.
const RESTAURANT_SUBCATS = ['Burgers', 'Pizza', 'Wings', 'Mexican', 'Italian', 'Asian', 'BBQ', 'Seafood'];
const NIGHTLIFE_SUBCATS  = ['Sports Bar', 'Speakeasy', 'Dance'];

function subcatOptionsFor(venue) {
  const cats = venueCategories(venue);
  const opts = [];
  if (cats.includes('restaurant')) opts.push(...RESTAURANT_SUBCATS);
  if (cats.includes('nightlife'))  opts.push(...NIGHTLIFE_SUBCATS);
  (venue.custom_subcategories || []).forEach(s => { if (!opts.includes(s)) opts.push(s); });
  return opts;
}

export default function WriteReviewModal({ open, onClose, venue, session, onSubmitted, onRequireLogin }) {
  const [overallRating, setOverallRating] = useState(8);
  const [subcatRatings, setSubcatRatings] = useState({}); // { [subcat]: number }
  const [content,       setContent]       = useState('');
  const [error,         setError]         = useState('');
  const [saving,        setSaving]        = useState(false);

  if (!open) return null;

  const subcatOptions = subcatOptionsFor(venue || {});

  const reset = () => {
    setOverallRating(8); setSubcatRatings({}); setContent(''); setError('');
  };
  const close = () => { reset(); onClose(); };

  const setSubcatRating = (subcat, rawValue) => {
    setSubcatRatings(prev => {
      const next = { ...prev };
      if (rawValue === '') { delete next[subcat]; return next; }
      next[subcat] = Number(rawValue);
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!session) { onRequireLogin(); return; }

    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/reviews/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          venue_id: venue.id,
          overall_rating: overallRating,
          subcategory_ratings: subcatRatings,
          content: content.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save review');
        setSaving(false);
        return;
      }
      setSaving(false);
      reset();
      onSubmitted(data.venue);
    } catch (err) {
      setError(err.message || 'Something went wrong saving your review.');
      setSaving(false);
    }
  };

  return (
    <div className="review-modal-backdrop" onClick={close}>
      <div className="review-modal" onClick={(e) => e.stopPropagation()}>
        <div className="review-modal-header">
          <span>Write a Review</span>
          <button className="review-modal-close" onClick={close} aria-label="Close">✕</button>
        </div>

        {!session ? (
          <div className="review-modal-body">
            <div className="review-login-prompt">
              <p>You need to be logged in to write a review.</p>
              <button className="auth-submit" onClick={onRequireLogin}>Log In / Sign Up</button>
            </div>
          </div>
        ) : (
          <form className="review-modal-body" onSubmit={submit}>
            <label>Rate Overall</label>
            <div className="rating-slider-row">
              <input
                type="range" min="1" max="10" step="0.5"
                value={overallRating}
                onChange={(e) => setOverallRating(Number(e.target.value))}
              />
              <span className="rating-slider-value">{overallRating.toFixed(1)} /10</span>
            </div>

            {subcatOptions.length > 0 && (
              <>
                <label>Subcategories (optional)</label>
                <div className="subcat-rating-grid">
                  {subcatOptions.map(subcat => (
                    <div key={subcat} className="subcat-rating-row">
                      <span className="subcat-rating-label">{subcat}</span>
                      <input
                        type="number" min="1" max="10" step="0.5"
                        placeholder="–"
                        value={subcatRatings[subcat] ?? ''}
                        onChange={(e) => setSubcatRating(subcat, e.target.value)}
                      />
                      <span className="subcat-rating-suffix">/10</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <label>Leave a review (optional)</label>
            <textarea
              rows={4}
              placeholder="What was it like?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="auth-submit" disabled={saving}>
              {saving ? 'Posting…' : 'Submit Rating'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

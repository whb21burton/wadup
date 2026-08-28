import { useState } from 'react';
import { supabase } from '../lib/supabase';

const REVIEW_TAGS = [
  'Atmosphere', 'Food', 'Drinks', 'Service', 'Music',
  'Value', 'Cleanliness', 'Location', 'Crowd',
];

export default function WriteReviewModal({ open, onClose, venueId, session, onSubmitted, onRequireLogin }) {
  const [rating,   setRating]   = useState(0);
  const [hoverStar,setHoverStar] = useState(0);
  const [tags,     setTags]     = useState([]);
  const [content,  setContent]  = useState('');
  const [photos,   setPhotos]   = useState([]); // File[]
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);

  if (!open) return null;

  const reset = () => {
    setRating(0); setHoverStar(0); setTags([]); setContent(''); setPhotos([]); setError('');
  };

  const close = () => { reset(); onClose(); };

  const toggleTag = (tag) => {
    setTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);
  };

  const onPickPhotos = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 6);
    setPhotos(files);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!session) { onRequireLogin(); return; }
    if (rating < 1) { setError('Please choose a star rating.'); return; }

    setError('');
    setSaving(true);
    try {
      const photoUrls = [];
      for (let i = 0; i < photos.length; i++) {
        const file = photos[i];
        const path = `${session.user.id}/${Date.now()}_${i}_${file.name}`.replace(/\s+/g, '_');
        const { error: upErr } = await supabase.storage.from('review-photos').upload(path, file);
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('review-photos').getPublicUrl(path);
        if (pub?.publicUrl) photoUrls.push(pub.publicUrl);
      }

      const { error: insErr } = await supabase.from('reviews').insert({
        user_id: session.user.id,
        venue_id: venueId,
        rating,
        content: content.trim() || null,
        tags,
        photo_urls: photoUrls,
      });

      if (insErr) {
        if (insErr.code === '23505') {
          setError("You've already reviewed this venue.");
        } else {
          setError(insErr.message);
        }
        setSaving(false);
        return;
      }

      setSaving(false);
      reset();
      onSubmitted();
    } catch (err) {
      setError(err.message || 'Something went wrong uploading your review.');
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
            <label>Your Rating</label>
            <div className="star-picker">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  type="button"
                  key={n}
                  className={`star-btn${n <= (hoverStar || rating) ? ' filled' : ''}`}
                  onMouseEnter={() => setHoverStar(n)}
                  onMouseLeave={() => setHoverStar(0)}
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  ★
                </button>
              ))}
            </div>

            <label>Tags (optional)</label>
            <div className="tag-picker">
              {REVIEW_TAGS.map(tag => (
                <button
                  type="button"
                  key={tag}
                  className={`tag-chip${tags.includes(tag) ? ' active' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>

            <label>Your Review</label>
            <textarea
              rows={4}
              placeholder="What was it like?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />

            <label>Photos (optional)</label>
            <input type="file" accept="image/*" multiple onChange={onPickPhotos} />
            {photos.length > 0 && (
              <div className="photo-preview-row">
                {photos.map((f, i) => (
                  <img key={i} src={URL.createObjectURL(f)} alt="" className="photo-preview" />
                ))}
              </div>
            )}

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="auth-submit" disabled={saving}>
              {saving ? 'Posting…' : 'Submit Review'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

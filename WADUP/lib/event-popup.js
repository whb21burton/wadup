import {CATEGORY_LABELS, formatTime} from './data.js';
import {affiliateTicketUrl, officialTicketLink, ticketFallback, ticketStatus} from './ticket-quality.js';

// Popups are built as raw HTML strings for Google's InfoWindow — escape any
// text that ultimately comes from an API response or (eventually) user input.
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEventPopup(ev, selectedDay, icon, affiliateAccount) {
  const performances = (Array.isArray(ev.showings) && ev.showings.length ? ev.showings : [ev])
    .filter(show => show && show.dateStr === selectedDay)
    .sort((a,b) => ((a.dateStr || '') + 'T' + (a.timeStr || '')).localeCompare((b.dateStr || '') + 'T' + (b.timeStr || '')));
  const showingRows = performances.map(show => {
    const day = show.dateStr ? new Date(show.dateStr + 'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : 'Date TBD';
    const fallback = officialTicketLink(show.officialUrl, show.venueWebsite, affiliateAccount) || ticketFallback(show) ||
      (show.venueWebsite ? {url:show.venueWebsite,label:'View venue schedule'} : null);
    const ticketLink = ticketStatus(show) !== 'dead' ? affiliateTicketUrl(show.url, affiliateAccount) : null;
    return `<div style="padding:10px 0;border-top:1px solid #e4e7eb">
      <div class="popup-row"><span class="popup-stat">📅 ${escapeHtml(day)} · ${escapeHtml(show.timeStr ? formatTime(show.timeStr) : 'Time TBD')}</span>
      ${show.price ? `<span class="popup-stat popup-price">${escapeHtml(show.price)}</span>` : ''}</div>
      ${ticketLink ? `<a class="popup-link" href="${escapeHtml(ticketLink)}" target="_blank" rel="noopener noreferrer">🎟️ Get Tickets for ${escapeHtml(show.timeStr ? formatTime(show.timeStr) : day)} →</a>` : fallback ? `<a class="popup-link" href="${escapeHtml(fallback.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fallback.label)} →</a>` : `<span style="color:#777">Ticket information unavailable.</span>`}
    </div>`;
  }).join('');

  return `
    <div class="gm-iw">
      <div class="popup-name">${icon} ${escapeHtml(ev.name)}</div>
      <div class="popup-type">${escapeHtml(CATEGORY_LABELS[ev.cat] || ev.cat)}${ev.city ? ' · ' + escapeHtml(ev.city) + ', ' + escapeHtml(ev.state) : ''}</div>
      <div class="tm-showtimes" style="max-height:300px;overflow-y:auto;overscroll-behavior:contain">${showingRows || '<div style="padding:10px 0">No performances scheduled for this day.</div>'}</div>
      <div class="popup-source">${performances.some(show => show.isOfficial || show.officialUrl) ? 'Official venue schedule' : 'via Ticketmaster'}</div>
    </div>`;
}

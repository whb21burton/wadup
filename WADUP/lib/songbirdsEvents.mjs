const HOST = 'venue.songbirds.org';
const FEED = `https://${HOST}/wp-json/tribe/events/v1/events`;
const LOCAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function usesSongbirdsFeed(url) {
  return httpsUrl(url)?.hostname === HOST;
}

export async function fetchSongbirdsEvents(venueId, fetchPage = fetch, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(now);
  const events = [];
  let page = 1;
  let pages;
  do {
    const query = new URLSearchParams({ page: String(page), per_page: '50', start_date: `${today} 00:00:00` });
    const response = await fetchPage(`${FEED}?${query}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Songbirds calendar HTTP ${response.status}`);
    const payload = await response.json();
    pages = payload.total_pages;
    if (!Array.isArray(payload.events) || !Number.isInteger(pages) || pages < 0 || pages > 10) {
      throw new Error('Unexpected Songbirds calendar response');
    }
    for (const event of payload.events) {
      const officialUrl = httpsUrl(event.url);
      if (event.status !== 'publish' || event.all_day !== false || event.timezone !== 'America/New_York' ||
          !officialUrl || officialUrl.hostname !== HOST || !officialUrl.pathname.startsWith('/event/') ||
          !event.title?.trim() || !LOCAL_TIMESTAMP.test(event.start_date) || event.start_date.slice(0, 10) < today) continue;

      events.push({
        venueId,
        name: event.title.trim(),
        dateStr: event.start_date.slice(0, 10),
        timeStr: event.start_date.slice(11),
        officialUrl: (httpsUrl(event.website) || officialUrl).href,
        source: 'official-venue',
      });
    }
    page++;
  } while (page <= pages);
  return [...new Map(events.map(event => [JSON.stringify([event.name, event.dateStr, event.timeStr]), event])).values()];
}

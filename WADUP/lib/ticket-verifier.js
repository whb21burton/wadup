import { ticketDestination } from './ticket-quality';
export async function verifyTicket(row, previous) {
  const url=ticketDestination(row.url);
  if (!url) return null;
  if (previous?.url===url && Date.parse(previous.expires_at)>Date.now()) return previous;
  let status='unknown', reason='unconfirmed', failures=0;
  try {
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(4500),headers:{Accept:'text/html'}});
    reason='HTTP '+response.status;
    if ([404,410].includes(response.status)) {
      failures=previous?.url===url ? (previous.failures||0)+1 : 1;
      if(failures>=2) status='dead';
    } else if(response.ok) {
      const body=(await response.text()).slice(0,500000);
      const id=new URL(url).pathname.split('/').filter(Boolean).pop();
      if (/page not found|event not found|access denied|captcha/i.test(body)) reason='ambiguous page';
      else if(body.includes(id) && /application\/ld\+json/i.test(body) && /"@type"\s*:\s*"(?:MusicEvent|SportsEvent|TheaterEvent|Event)"/i.test(body)) status='working';
    }
  } catch { reason='network or timeout'; }
  return {url,status,reason,failures,checked_at:new Date().toISOString(),expires_at:new Date(Date.now()+(status==='unknown'?2:24)*3600000).toISOString()};
}

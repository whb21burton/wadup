import {supabaseAdmin} from '../supabase-admin';
import {EVENT_VENUES} from '../../../lib/event-venues';
import {fetchOfficialSchedule} from '../../../lib/venue-schedule-fetch';
export const config={maxDuration:60};
export default async function handler(req,res){
 const secret=process.env.CRON_SECRET;
 if(!secret)return res.status(503).json({error:'Server authorization is not configured'});
 if(req.headers.authorization!=='Bearer '+secret.trim())return res.status(401).json({error:req.headers.authorization?'Authorization does not match server configuration':'Authorization header missing'});
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 if(process.env.VENUE_SYNC_ENABLED!=='1')return res.status(503).json({error:'Venue staging sync disabled'});
 const results=[];
 for(let i=0;i<EVENT_VENUES.length;i+=2){
  const batch=await Promise.all(EVENT_VENUES.slice(i,i+2).map(v=>fetchOfficialSchedule(v.id)));
  for(const result of batch){
   const checked=new Date().toISOString();
   let status=result.status,reason=result.reason;
   if(result.rows.length){
    const rows=result.rows.map(e=>({venue_id:e.venueId,performance_key:JSON.stringify([e.name.normalize('NFKC').toLowerCase().trim(),e.dateStr,e.timeStr]),name:e.name,local_date:e.dateStr,local_time:e.timeStr,official_url:e.officialUrl,last_seen_at:checked}));
    const {error}=await supabaseAdmin.from('official_venue_performances').upsert(rows,{onConflict:'venue_id,performance_key'});
    if(error){status='error';reason=error.message;}
   }
   const {error}=await supabaseAdmin.from('official_venue_sync_status').upsert({venue_id:result.venueId,status,reason,checked_at:checked,performance_count:result.rows.length},{onConflict:'venue_id'});
   results.push({venue:result.venueId,status,reason,count:result.rows.length,storageError:error?.message});
  }
 }
 return res.status(results.some(r=>r.storageError||r.status==='error')?500:200).json({results});
}

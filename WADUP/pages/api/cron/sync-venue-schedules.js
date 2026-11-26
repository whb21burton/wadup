import {loadCronDatabase} from '../../../lib/cron-auth';
import {EVENT_VENUES} from '../../../lib/event-venues';
import {fetchOfficialSchedule} from '../../../lib/venue-schedule-fetch';
export const config={maxDuration:60};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const verify=req.query.verify==='1';
 if(verify&&(req.method!=='POST'||process.env.VERCEL_ENV!=='preview'))return res.status(404).end();
 const secret=verify?process.env.VENUE_SYNC_VERIFY_SECRET:process.env.CRON_SECRET;
 if(!secret)return res.status(503).json({error:'Server authorization is not configured'});
 if(req.headers.authorization!=='Bearer '+secret.trim())return res.status(401).json({error:req.headers.authorization?'Authorization does not match server configuration':'Authorization header missing'});
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 if(!verify&&process.env.VENUE_SYNC_ENABLED!=='1')return res.status(503).json({error:'Venue staging sync disabled'});
 const supabaseAdmin=verify?null:await loadCronDatabase();
 if(!verify&&!supabaseAdmin)return res.status(503).json({error:'Cron database is not configured for this environment'});
 const results=[];
 for(let i=0;i<EVENT_VENUES.length;i+=2){
  const checkedAt=new Date().toISOString();
  const batch=await Promise.all(EVENT_VENUES.slice(i,i+2).map(v=>fetchOfficialSchedule(v.id)));
  for(const {venueId,status,reason,rows,complete} of batch){
   const unique=new Map();
   for(const row of rows){
    const key=JSON.stringify([row.name.normalize('NFKC').toLowerCase().trim(),row.dateStr,row.timeStr]);
    if(!unique.has(key))unique.set(key,{performance_key:key,name:row.name,local_date:row.dateStr,local_time:row.timeStr,official_url:row.officialUrl});
   }
   if(verify){
    const venue=EVENT_VENUES.find(venue=>venue.id===venueId);
    results.push({venue:venueId,status,count:unique.size,complete:complete===true,
     hasCanonicalLocation:Number.isFinite(venue?.location?.lat)&&Number.isFinite(venue?.location?.lng)});
    continue;
   }
   const {error}=await supabaseAdmin.rpc('write_official_venue_snapshot',{
    p_venue:venueId,p_checked_at:checkedAt,p_status:status,p_reason:reason,
    p_rows:[...unique.values()],p_complete:complete===true,
   });
   results.push({venue:venueId,status,reason,count:unique.size,storageError:error?.message});
  }
 }
 if(verify)return res.status(results.every(result=>result.complete&&result.count>0&&result.hasCanonicalLocation)?200:502)
  .json({mode:'verification',results});
 return res.status(results.some(r=>r.storageError||r.status==='error')?500:200).json({results});
}

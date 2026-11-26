import {EVENT_VENUES} from '../../lib/event-venues';
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).end();
 if(process.env.VENUE_SYNC_ENABLED!=='1')return res.status(200).json({performances:[],enabled:false});
 const date=typeof req.query.date==='string'?req.query.date:'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return res.status(400).json({error:'Invalid date'});
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.NEXT_PUBLIC_SUPABASE_URL){res.setHeader('Cache-Control','no-store');return res.status(503).json({error:'Schedule unavailable',performances:[]});}
 const {supabaseAdmin}=await import('./supabase-admin');
 const rows=[];
 let cursor={p_after_venue:'',p_after_key:''};
 for(;;){
  const {data,error}=await supabaseAdmin.rpc('read_official_venue_performances',{p_date:date,...cursor});
  if(error||!Array.isArray(data))return res.status(503).json({error:'Schedule unavailable'});
  if(!data.length)break;
  rows.push(...data);
  const last=data[data.length-1];
  if(last.venue_id===cursor.p_after_venue&&last.performance_key===cursor.p_after_key)return res.status(503).json({error:'Schedule pagination stalled'});
  cursor={p_after_venue:last.venue_id,p_after_key:last.performance_key};
 }
 const venues=new Map(EVENT_VENUES.map(v=>[v.id,v]));
 const performances=rows.flatMap(r=>{
 const v=venues.get(r.venue_id);if(!v)return [];
 return [{venueId:v.id,venueName:v.name,venueType:v.type,venueWebsite:v.website,location:v.location||null,city:v.city,state:v.state,name:r.name,dateStr:r.local_date,timeStr:r.local_time,officialUrl:r.official_url,lastVerifiedAt:r.last_seen_at}];
 });
 res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');
 return res.status(200).json({performances,enabled:true});
}

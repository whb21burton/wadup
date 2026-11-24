import {supabaseAdmin} from './supabase-admin';
import {EVENT_VENUES} from '../../lib/event-venues';
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).end();
 if(process.env.VENUE_SYNC_ENABLED!=='1')return res.status(200).json({performances:[],enabled:false});
 const date=typeof req.query.date==='string'?req.query.date:'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return res.status(400).json({error:'Invalid date'});
 const {data,error}=await supabaseAdmin.from('official_venue_performances').select('venue_id,name,local_date,local_time,official_url').eq('local_date',date).gte('last_seen_at',new Date(Date.now()-7*86400000).toISOString()).limit(2000);
 if(error)return res.status(503).json({error:'Schedule unavailable'});
 const venues=new Map(EVENT_VENUES.map(v=>[v.id,v]));
 const performances=(data||[]).flatMap(r=>{
 const v=venues.get(r.venue_id);if(!v)return [];
 return [{venueId:v.id,venueName:v.name,venueType:v.type,venueWebsite:v.website,city:v.city,state:v.state,name:r.name,dateStr:r.local_date,timeStr:r.local_time,officialUrl:r.official_url}];
 });
 res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');
 return res.status(200).json({performances,enabled:true});
}

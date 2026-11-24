import {supabaseAdmin} from '../supabase-admin';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).end();
 const secret=process.env.CRON_SECRET;
 if(!secret||req.headers.authorization!=='Bearer '+secret)return res.status(401).end();
 const today=new Date().toISOString().slice(0,10);
 const queries=[supabaseAdmin.from('official_venue_sync_status').select('*').order('venue_id'),supabaseAdmin.from('official_venue_performances').select('*',{count:'exact',head:true}).gte('local_date',today),supabaseAdmin.from('tm_events_cache').select('*',{count:'exact',head:true}).gte('date_str',today)];
 for(const status of ['working','dead','unknown'])queries.push(supabaseAdmin.from('tm_events_cache').select('*',{count:'exact',head:true}).gte('date_str',today).filter('ticket_verification->>status','eq',status).filter('ticket_verification->>expires_at','gt',new Date().toISOString()));
 const results=await Promise.all(queries);
 return res.status(200).json({venues:results[0].data||[],officialPerformances:results[1].count,ticketmasterRecords:results[2].count,verification:{working:results[3].count,dead:results[4].count,unknown:results[5].count},errors:results.map((r,i)=>r.error?{query:i,message:r.error.message}:null).filter(Boolean)});
}

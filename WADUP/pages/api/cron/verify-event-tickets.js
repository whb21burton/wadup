import {loadCronDatabase} from '../../../lib/cron-auth';
import {verifyTicket} from '../../../lib/ticket-verifier';
import {ticketDestination} from '../../../lib/ticket-quality';
export const config={maxDuration:60};
export default async function handler(req,res){
 const secret=process.env.CRON_SECRET;
 if(!secret||req.headers.authorization!=='Bearer '+secret)return res.status(401).end();
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 if(process.env.TICKET_VERIFY_ENABLED!=='1')return res.status(503).json({error:'Verification disabled'});
 const supabaseAdmin=await loadCronDatabase();
 if(!supabaseAdmin)return res.status(503).json({error:'Cron database is not configured for this environment'});
 const today=new Date().toISOString().slice(0,10);
 const end=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
 const {data,error}=await supabaseAdmin.from('tm_events_cache').select('tm_id,url,ticket_verification').gte('date_str',today).lte('date_str',end).order('date_str').order('tm_id').limit(10000);
 if(error)return res.status(503).json({error:'Verification storage unavailable'});
 const queue=(data||[]).filter(r=>ticketDestination(r.url)&&(!r.ticket_verification||r.ticket_verification.url!==ticketDestination(r.url)||!(Date.parse(r.ticket_verification.expires_at)>Date.now()))).sort((a,b)=>(Date.parse(a.ticket_verification?.checked_at)||0)-(Date.parse(b.ticket_verification?.checked_at)||0)).slice(0,24);
 const counts={working:0,dead:0,unknown:0,errors:0};
 for(let i=0;i<queue.length;i+=4){
 await Promise.all(queue.slice(i,i+4).map(async row=>{
 try{
 const result=await verifyTicket(row,row.ticket_verification);
 if(!result)return;
 const {error}=await supabaseAdmin.from('tm_events_cache').update({ticket_verification:result}).eq('tm_id',row.tm_id).eq('url',row.url);
 if(error)counts.errors++;else counts[result.status]++;
 }catch{counts.errors++;}
 }));
 }
 return res.status(counts.errors?500:200).json({checked:queue.length,...counts});
}

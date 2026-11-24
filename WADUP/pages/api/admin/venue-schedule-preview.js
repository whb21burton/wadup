import { fetchOfficialSchedule } from '../../../lib/venue-schedule-fetch';
export const config={maxDuration:30};
export default async function handler(req,res) {
 if(req.method!=='GET')return res.status(405).end();
 const secret=process.env.CRON_SECRET;
 if(!secret||req.headers.authorization!=='Bearer '+secret)return res.status(401).end();
 const id=typeof req.query.venue==='string'?req.query.venue:'';
 try {
  const result=await fetchOfficialSchedule(id);
  return res.status(200).json(result);
 }catch{return res.status(400).json({error:'Unknown or invalid venue'});}
}

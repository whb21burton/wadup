import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

const FIELDS=['name','description','phone','website','cover_photo_url'];
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const token=(req.headers.authorization||'').split(' ').pop();
  if(!token)return res.status(401).json({error:'Sign in required'});
  const {data:{user},error:userError}=await supabaseAdmin.auth.getUser(token);
  if(userError||!user)return res.status(401).json({error:'Invalid session'});
  const {venueId,updates}=req.body||{};
  if(typeof venueId!=='string'||!updates||typeof updates!=='object'||Array.isArray(updates))return res.status(400).json({error:'Invalid request'});
  const {data:venue}=await supabaseAdmin.from('venues').select('id,city,owner_id').eq('id',venueId).maybeSingle();
  if(!venue)return res.status(404).json({error:'Venue not found'});
  const admin=await requireAdmin(req);
  if(venue.owner_id!==user.id&&!(admin&&canAccessCity(admin.adminRole,venue.city)))return res.status(403).json({error:'Not authorized'});
  const safe={};
  for(const field of FIELDS)if(Object.prototype.hasOwnProperty.call(updates,field)){
    const value=updates[field];
    if(typeof value!=='string'||value.length>4000)return res.status(400).json({error:'Invalid '+field});
    safe[field]=value.trim();
  }
  if(!Object.keys(safe).length)return res.status(400).json({error:'No changes'});
  if(safe.name!==undefined&&!safe.name)return res.status(400).json({error:'Venue name is required'});
  for(const field of ['website','cover_photo_url'])if(safe[field]&&!/^https?:\/\//i.test(safe[field]))return res.status(400).json({error:'Use a full https:// URL'});
  const {data,error}=await supabaseAdmin.from('venues').update(safe).eq('id',venueId).select().single();
  if(error)return res.status(500).json({error:'Unable to save venue'});
  return res.json({venue:data});
}
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';
import { CATEGORY_CHIPS } from '../../../lib/data';

const FIELDS=['name','description','phone','website','cover_photo_url','address'];
const CATEGORIES=new Set(['restaurant','nightlife','events','sports','outdoors','activities']);
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const token=(req.headers.authorization||'').split(' ').pop();
  if(!token)return res.status(401).json({error:'Sign in required'});
  const {data:{user},error:userError}=await supabaseAdmin.auth.getUser(token);
  if(userError||!user)return res.status(401).json({error:'Invalid session'});
  const {venueId,updates}=req.body||{};
  if(typeof venueId!=='string'||!updates||typeof updates!=='object'||Array.isArray(updates))return res.status(400).json({error:'Invalid request'});
  const {data:venue}=await supabaseAdmin.from('venues').select('id,city,owner_id,name,address,lat,lng,category,categories,subcategory,subcategories').eq('id',venueId).maybeSingle();
  if(!venue)return res.status(404).json({error:'Venue not found'});
  const admin=await requireAdmin(req);
  if(venue.owner_id!==user.id&&!(admin&&canAccessCity(admin.adminRole,venue.city)))return res.status(403).json({error:'Not authorized'});
  const safe={};
  for(const field of FIELDS)if(Object.prototype.hasOwnProperty.call(updates,field)){
    const value=updates[field];
    if(typeof value!=='string'||value.length>4000)return res.status(400).json({error:'Invalid '+field});
    safe[field]=value.trim();
  }
  const hasLat=Object.prototype.hasOwnProperty.call(updates,'lat'),hasLng=Object.prototype.hasOwnProperty.call(updates,'lng');
  if(hasLat!==hasLng)return res.status(400).json({error:'Provide both latitude and longitude'});
  if(hasLat){
    const {lat,lng}=updates;
    if(typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180)return res.status(400).json({error:'Invalid map pin coordinates'});
    safe.lat=lat;safe.lng=lng;
  }
  if(updates.categories!==undefined){
    if(!Array.isArray(updates.categories)||!updates.categories.length||updates.categories.length>6||!updates.categories.every(x=>CATEGORIES.has(x))||new Set(updates.categories).size!==updates.categories.length)return res.status(400).json({error:'Choose a valid primary and optional secondary categories'});
    safe.categories=updates.categories;safe.category=updates.categories[0];
  }
  if(updates.subcategories!==undefined){
    if(!Array.isArray(updates.subcategories)||updates.subcategories.length>12||!updates.subcategories.every(x=>typeof x==='string'&&x.trim()&&x.length<=60))return res.status(400).json({error:'Invalid subcategories'});
    const selectedCategories=safe.categories||venue.categories?.length&&venue.categories||[venue.category].filter(Boolean);
    const allowed=new Set(CATEGORY_CHIPS.filter(ch=>selectedCategories.includes(ch.id==='bars'?'nightlife':ch.id)).flatMap(ch=>ch.subcategories.map(s=>s.id)));
    if(!updates.subcategories.every(s=>allowed.has(s)))return res.status(400).json({error:'Select only subcategories available under your chosen categories'});
    if(new Set(updates.subcategories).size!==updates.subcategories.length)return res.status(400).json({error:'Duplicate subcategories'});
    safe.subcategories=updates.subcategories.map(x=>x.trim());safe.subcategory=safe.subcategories[0]||null;
  }
  if(!Object.keys(safe).length)return res.status(400).json({error:'No changes'});
  if(safe.name!==undefined&&!safe.name)return res.status(400).json({error:'Venue name is required'});
  for(const field of ['website','cover_photo_url'])if(safe[field]&&!/^https?:\/\//i.test(safe[field]))return res.status(400).json({error:'Use a full https:// URL'});
  const {data,error}=await supabaseAdmin.from('venues').update(safe).eq('id',venueId).select().single();
  if(error)return res.status(500).json({error:'Unable to save venue'});
  return res.json({venue:data});
}
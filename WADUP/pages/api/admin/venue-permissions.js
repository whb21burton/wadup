import {supabaseAdmin} from '../supabase-admin';
import {requireAdmin} from './_authAdmin';
import {canAccessCity} from '../../../lib/admin';
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=(req.headers.authorization||'').split(' ').pop();
 if(!token)return res.status(401).json({canManage:false});
 const {data:{user},error}=await supabaseAdmin.auth.getUser(token);
 if(error||!user)return res.status(401).json({canManage:false});
 const {data:venue}=await supabaseAdmin.from('venues').select('owner_id,city').eq('id',req.query.venueId).maybeSingle();
 if(!venue)return res.status(404).json({canManage:false});
 const admin=await requireAdmin(req);
 return res.json({canManage:venue.owner_id===user.id||!!(admin&&canAccessCity(admin.adminRole,venue.city))});
}
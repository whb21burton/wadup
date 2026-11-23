export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });
  const { venueId, image, positionX = 50, positionY = 50, zoom = 1, device = 'desktop' } = req.body || {};
  if (!['desktop','mobile'].includes(device) || typeof zoom !== 'number' || zoom < 0.5 || zoom > 3) return res.status(400).json({error:'Invalid photo settings'});
  if (![positionX,positionY].every(v=>Number.isInteger(v)&&v>=0&&v<=100)) return res.status(400).json({error:'Invalid photo position'});
  if (typeof venueId !== 'string' || !/^[0-9a-f-]{36}$/i.test(venueId)) return res.status(400).json({ error: 'Invalid venue' });
  if (typeof image !== 'string' || image.length > 7000000 || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return res.status(400).json({ error: 'Upload a JPG, PNG, or WebP under 5 MB' });
  const { data: venue } = await supabaseAdmin.from('venues').select('id,city,owner_id').eq('id', venueId).maybeSingle();
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  const admin = await requireAdmin(req);
  if (venue.owner_id !== user.id && !(admin && canAccessCity(admin.adminRole, venue.city))) return res.status(403).json({ error: 'Not authorized' });
  const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  if (bytes.length > 5 * 1024 * 1024 || bytes.length < 100) return res.status(400).json({ error: 'Image size is invalid' });
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!jpg && !png && !webp) return res.status(400).json({ error: 'Invalid image file' });
  const type = jpg ? 'image/jpeg' : png ? 'image/png' : 'image/webp';
  const ext = jpg ? 'jpg' : png ? 'png' : 'webp';
  const key = venueId + '/' + device + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,9) + '.' + ext;
  const { error: uploadError } = await supabaseAdmin.storage.from('venue-covers').upload(key, bytes, { contentType: type, upsert: false, cacheControl: '3600' });
  if (uploadError) return res.status(500).json({ error: 'Photo upload failed' });
  const { data: urlData } = supabaseAdmin.storage.from('venue-covers').getPublicUrl(key);
  const { data: updated, error: updateError } = await supabaseAdmin.from('venues').update(device === 'mobile'
    ? {cover_photo_mobile_url:urlData.publicUrl,cover_mobile_position_x:positionX,cover_mobile_position_y:positionY,cover_mobile_zoom:zoom}
    : {cover_photo_url:urlData.publicUrl,cover_position_x:positionX,cover_position_y:positionY,cover_zoom:zoom}).eq('id',venueId).select().single();
  if (updateError) return res.status(500).json({ error: 'Photo uploaded but could not be saved to venue' });
  return res.json({ venue: updated });
}

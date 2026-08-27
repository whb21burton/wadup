// pages/api/geocode.js — Google Geocoding proxy
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { address, latlng } = req.query;
  const key = process.env.GMAPS_KEY || 'AIzaSyBoXf6UAa_SckH9gxfbiOK9OPpaySNH76w';

  const qs = address
    ? `address=${encodeURIComponent(address)}&key=${key}`
    : `latlng=${latlng}&key=${key}`;

  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${qs}`);
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

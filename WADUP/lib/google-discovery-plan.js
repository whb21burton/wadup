export const DISCOVERY_SLOT_MINUTES = 15;
export const DISCOVERY_SEARCHES_PER_SLOT = 2;
export const CHATTANOOGA_CENTER = { lat: 35.0456, lng: -85.3096 };

export function discoveryRegions(ordered, current) {
  if (!ordered) return current ? [{ name: current, ...CHATTANOOGA_CENTER }] : [];
  try {
    const regions = JSON.parse(ordered);
    if (!Array.isArray(regions) || !regions.length || regions.length > 12 ||
        regions.some(region => !region || typeof region.name !== 'string' || !region.name.trim() ||
          !Number.isFinite(region.lat) || Math.abs(region.lat) > 90 ||
          !Number.isFinite(region.lng) || Math.abs(region.lng) > 180) ||
        new Set(regions.map(region => region.name)).size !== regions.length) return [];
    return regions;
  } catch {
    return [];
  }
}

export function tileDistance(tile, center) {
  const lat = (Number(tile.lat) - center.lat) * 111.2;
  const lng = (Number(tile.lng) - center.lng) * 111.2 * Math.cos(center.lat * Math.PI / 180);
  return lat * lat + lng * lng;
}

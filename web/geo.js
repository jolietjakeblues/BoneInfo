// WKT-hulpfuncties. Geometrie in de index is altijd een POINT in WGS84
// (geo_point, geen polygonen) — zie triply/elastic-service.json.

// "Point (5.852071 51.779803)" -> [lon, lat], of null als het veld ontbreekt
// of niet te parsen is.
export function parsePoint(wkt) {
  if (!wkt) return null;
  const value = Array.isArray(wkt) ? wkt[0] : wkt;
  const m = /point\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(value || '');
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

// Elasticsearch's geo_centroid-aggregatie geeft {lat, lon} terug (geen WKT).
export function centroidLatLon(bucket) {
  const c = bucket?.middelpunt?.location;
  if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number') return null;
  return [c.lat, c.lon];
}

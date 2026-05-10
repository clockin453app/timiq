/** Haversine distance on Earth (same model as backend time_clock.geofence). */

const EARTH_RADIUS_M = 6371000;

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

export function nearestSiteId<T extends { id: string; latitude: number; longitude: number }>(
  lat: number,
  lng: number,
  sites: T[],
): string | null {
  if (sites.length === 0) {
    return null;
  }

  let bestId: string | null = null;
  let bestDistance = Infinity;

  for (const site of sites) {
    const distance = haversineDistanceMeters(lat, lng, site.latitude, site.longitude);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = site.id;
    }
  }

  return bestId;
}

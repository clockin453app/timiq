/** Client-side OpenStreetMap Nominatim search (no API key). Respect usage policy in production. */

export type NominatimSearchHit = {
  display_name: string;
  lat: string;
  lon: string;
};

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";

export async function searchNominatim(query: string): Promise<NominatimSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const params = new URLSearchParams({
    format: "json",
    limit: "5",
    q: trimmed,
  });

  const response = await fetch(`${NOMINATIM_SEARCH}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": "TimIQ/1.0 (workforce management; development)",
    },
  });

  if (!response.ok) {
    throw new Error("Address search failed. Try again later.");
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter(
      (row): row is NominatimSearchHit =>
        typeof row === "object" &&
        row !== null &&
        "display_name" in row &&
        "lat" in row &&
        "lon" in row &&
        typeof (row as NominatimSearchHit).display_name === "string" &&
        typeof (row as NominatimSearchHit).lat === "string" &&
        typeof (row as NominatimSearchHit).lon === "string",
    )
    .slice(0, 5);
}

/** Client-safe map copy — keep out of Leaflet modules so SSR never evaluates `leaflet`. */
export const CLOCK_MAP_FALLBACK_MESSAGE =
  "Map temporarily unavailable. GPS validation is still active.";

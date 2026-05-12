import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type ClockAssignedSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number;
};

export type ClockStatus = {
  has_open_shift: boolean;
  open_shift_id: string | null;
  /** ISO 8601 clock-in time for the open shift; absent on older API responses. */
  open_shift_clock_in_at?: string | null;
  status: string;
  active_location_count: number;
  current_break_open: boolean;
  assigned_sites: ClockAssignedSite[];
  current_status:
    | "not_clocked_in"
    | "on_shift"
    | "open_break"
    | "completed_today"
    | "no_assigned_sites";
  has_completed_shift_today: boolean;
  open_break_id: string | null;
  open_shift_location_id: string | null;
  open_shift_location_name: string | null;
  can_clock_in: boolean;
  can_clock_out: boolean;
  clock_in_blocked_reason: string | null;
  clock_out_blocked_reason: string | null;
};

export type ClockActionResponse = {
  shift_id: string;
  status: string;
  worked_seconds?: number | null;
  break_seconds?: number | null;
};

export type BreakActionResponse = {
  shift_id: string;
  break_id: string;
  status: string;
};

export type GeolocationRequest = {
  latitude: number;
  longitude: number;
  accuracy_meters: number;
  timestamp_utc: string;
};

const MAX_GPS_CLIENT_WINDOW_MS = 115_000;

export function isGpsCaptureStale(capturedAtMs: number): boolean {
  return Date.now() - capturedAtMs > MAX_GPS_CLIENT_WINDOW_MS;
}

export async function getClockStatus(): Promise<ClockStatus> {
  const response = await fetch(`${API_URL}/api/time-clock/status`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load clock status.");
  }

  return response.json() as Promise<ClockStatus>;
}

function appendClockMultipart(body: FormData, payload: GeolocationRequest, selfie: File) {
  body.append("latitude", String(payload.latitude));
  body.append("longitude", String(payload.longitude));
  body.append("accuracy_meters", String(payload.accuracy_meters));
  body.append("timestamp_utc", payload.timestamp_utc);
  body.append("selfie", selfie, selfie.name);
}

async function postMultipartClock(
  path: string,
  payload: GeolocationRequest,
  selfie: File,
): Promise<ClockActionResponse> {
  const body = new FormData();
  appendClockMultipart(body, payload, selfie);

  const response = await fetch(`${API_URL}/api/time-clock/${path}`, {
    method: "POST",
    credentials: "include",
    body,
  });

  if (!response.ok) {
    let detail = "Clock action failed.";
    try {
      const parsed = (await response.json()) as { detail?: unknown };
      detail = fastApiDetailToMessage(parsed.detail, detail);
    } catch {
      // Ignore parsing failures and keep fallback message.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<ClockActionResponse>;
}

export async function clockInWithSelfie(
  payload: GeolocationRequest,
  selfie: File,
): Promise<ClockActionResponse> {
  return postMultipartClock("clock-in", payload, selfie);
}

export async function clockOutWithSelfie(
  payload: GeolocationRequest,
  selfie: File,
): Promise<ClockActionResponse> {
  return postMultipartClock("clock-out", payload, selfie);
}

export async function breakStart(): Promise<BreakActionResponse> {
  const response = await fetch(`${API_URL}/api/time-clock/break-start`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    let detail = "Could not start break.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = fastApiDetailToMessage(body.detail, detail);
    } catch {
      // Ignore parsing failures and keep fallback message.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<BreakActionResponse>;
}

export async function breakEnd(): Promise<BreakActionResponse> {
  const response = await fetch(`${API_URL}/api/time-clock/break-end`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    let detail = "Could not end break.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = fastApiDetailToMessage(body.detail, detail);
    } catch {
      // Ignore parsing failures and keep fallback message.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<BreakActionResponse>;
}

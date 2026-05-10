import { API_URL } from "../../config/api";

export type ClockStatus = {
  has_open_shift: boolean;
  open_shift_id: string | null;
  status: string;
  active_location_count: number;
  current_break_open: boolean;
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
      const parsed = (await response.json()) as { detail?: string };
      if (parsed.detail) {
        detail = parsed.detail;
      }
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
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
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
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // Ignore parsing failures and keep fallback message.
    }
    throw new Error(detail);
  }

  return response.json() as Promise<BreakActionResponse>;
}

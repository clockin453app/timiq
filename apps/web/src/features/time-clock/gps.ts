export type GeolocationRequest = {
  latitude: number;
  longitude: number;
  accuracy_meters: number;
  timestamp_utc: string;
};

/** Matches backend `MAX_GPS_AGE_SECONDS` in time_clock.service. */
export const BACKEND_MAX_GPS_AGE_MS = 120_000;

/** Client refreshes before server rejects stale timestamps (15s margin). */
export const CLIENT_GPS_STALE_MS = 105_000;

/** Matches backend `MAX_GPS_ACCURACY_METERS`. */
export const BACKEND_MAX_ACCURACY_M = 100;

export type GpsCapture = {
  payload: GeolocationRequest;
  /** Epoch ms for the fix (from `position.timestamp` when valid). */
  capturedAtMs: number;
};

export type GpsStabilizationPhase =
  | "searching"
  | "improving"
  | "captured"
  | "too_low"
  | "denied"
  | "failed"
  | "unsupported";

export type GpsStabilizationUpdate = {
  phase: GpsStabilizationPhase;
  bestAccuracyMeters: number | null;
  bestCapture: GpsCapture | null;
  samples: number;
};

export function getClockGeolocationOptionsActive(): PositionOptions {
  return {
    enableHighAccuracy: true,
    // During stabilization we want fresh samples, not cached.
    maximumAge: 0,
  };
}

export function isGpsCaptureStale(capturedAtMs: number): boolean {
  return Date.now() - capturedAtMs > CLIENT_GPS_STALE_MS;
}

export function isGpsAccuracyAcceptable(accuracyMeters: number): boolean {
  return Number.isFinite(accuracyMeters) && accuracyMeters > 0 && accuracyMeters <= BACKEND_MAX_ACCURACY_M;
}

/** Build payload using the browser-reported fix time, not a pre-callback clock. */
export function buildGpsCaptureFromPosition(position: GeolocationPosition): GpsCapture {
  const fixTimeMs =
    Number.isFinite(position.timestamp) && position.timestamp > 0
      ? Math.floor(position.timestamp)
      : Date.now();
  return {
    capturedAtMs: fixTimeMs,
    payload: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy_meters: position.coords.accuracy,
      timestamp_utc: new Date(fixTimeMs).toISOString(),
    },
  };
}

export type StabilizeGpsOptions = {
  /** Max time to watch for improvements. Default 25s. */
  maxWaitMs?: number;
  /** Preferred accuracy threshold to stop early. Default 80m. */
  preferredAccuracyM?: number;
  /** Minimum acceptable accuracy to allow submit. Default 100m (backend max). */
  acceptAccuracyM?: number;
  onUpdate?: (update: GpsStabilizationUpdate) => void;
};

function pushUpdate(opts: StabilizeGpsOptions, update: GpsStabilizationUpdate) {
  try {
    opts.onUpdate?.(update);
  } catch {
    // ignore UI callback errors
  }
}

/**
 * Stabilize GPS using `watchPosition`:
 * - collect multiple samples
 * - keep the best sample (lowest accuracy)
 * - stop when preferred accuracy is reached, or when max wait is reached
 */
export function stabilizeGpsFix(options: StabilizeGpsOptions = {}): Promise<GpsCapture> {
  const maxWaitMs = options.maxWaitMs ?? 25_000;
  const preferredAccuracyM = options.preferredAccuracyM ?? 80;
  const acceptAccuracyM = options.acceptAccuracyM ?? BACKEND_MAX_ACCURACY_M;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      pushUpdate(options, {
        phase: "unsupported",
        bestAccuracyMeters: null,
        bestCapture: null,
        samples: 0,
      });
      reject(new Error("UNSUPPORTED"));
      return;
    }

    let samples = 0;
    let best: GpsCapture | null = null;
    let bestAcc: number | null = null;
    let didResolve = false;

    pushUpdate(options, {
      phase: "searching",
      bestAccuracyMeters: null,
      bestCapture: null,
      samples: 0,
    });

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        samples += 1;
        const capture = buildGpsCaptureFromPosition(position);
        const acc = capture.payload.accuracy_meters;
        const improved = bestAcc === null || acc < bestAcc;
        if (improved) {
          best = capture;
          bestAcc = acc;
        }

        const phase: GpsStabilizationPhase =
          bestAcc !== null && bestAcc <= preferredAccuracyM
            ? "captured"
            : "improving";

        pushUpdate(options, {
          phase,
          bestAccuracyMeters: bestAcc,
          bestCapture: best,
          samples,
        });

        if (bestAcc !== null && bestAcc <= preferredAccuracyM && !didResolve) {
          didResolve = true;
          navigator.geolocation.clearWatch(watchId);
          resolve(best as GpsCapture);
        }
      },
      (error: GeolocationPositionError) => {
        if (didResolve) {
          return;
        }
        if (error.code === error.PERMISSION_DENIED) {
          pushUpdate(options, {
            phase: "denied",
            bestAccuracyMeters: bestAcc,
            bestCapture: best,
            samples,
          });
          navigator.geolocation.clearWatch(watchId);
          reject(new Error("PERMISSION_DENIED"));
          return;
        }
        // Keep watching for transient errors until timer expires.
        pushUpdate(options, {
          phase: "improving",
          bestAccuracyMeters: bestAcc,
          bestCapture: best,
          samples,
        });
      },
      getClockGeolocationOptionsActive(),
    );

    window.setTimeout(() => {
      if (didResolve) {
        return;
      }
      navigator.geolocation.clearWatch(watchId);
      if (best && bestAcc !== null) {
        const phase: GpsStabilizationPhase =
          bestAcc <= acceptAccuracyM ? "captured" : "too_low";
        pushUpdate(options, {
          phase,
          bestAccuracyMeters: bestAcc,
          bestCapture: best,
          samples,
        });
        resolve(best);
        return;
      }
      pushUpdate(options, {
        phase: "failed",
        bestAccuracyMeters: null,
        bestCapture: null,
        samples,
      });
      reject(new Error("FAILED"));
    }, maxWaitMs);
  });
}

export function isGpsClientSubmittable(capture: GpsCapture): boolean {
  return !isGpsCaptureStale(capture.capturedAtMs) && isGpsAccuracyAcceptable(capture.payload.accuracy_meters);
}

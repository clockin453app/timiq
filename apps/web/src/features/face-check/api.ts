import { API_URL } from "../../config/api";

export type FaceReviewMetadata = {
  shift_id: string;
  employee: {
    user_id: string;
    display_name: string;
    email: string | null;
  };
  location_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  shift_status: string;
  face_check_status: string | null;
  face_match_confidence: number | null;
  face_check_reason: string | null;
  has_reference_photo: boolean;
  has_clock_in_selfie: boolean;
  has_clock_out_selfie: boolean;
};

async function readJsonError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchFaceReviewMetadata(shiftId: string): Promise<FaceReviewMetadata> {
  const response = await fetch(`${API_URL}/api/time-records/${encodeURIComponent(shiftId)}/face-review`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readJsonError(response, "Could not load face check review."));
  }
  return response.json() as Promise<FaceReviewMetadata>;
}

export type FaceReviewImageKind = "reference-image" | "clock-in-selfie" | "clock-out-selfie";

export async function fetchFaceReviewImage(shiftId: string, kind: FaceReviewImageKind): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/time-records/${encodeURIComponent(shiftId)}/face-review/${kind}`,
    {
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await readJsonError(response, "Could not load image."));
  }
  return response.blob();
}

export async function fetchFaceReferenceImage(userId: string): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/employee-profiles/users/${encodeURIComponent(userId)}/face-reference-image`,
    {
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await readJsonError(response, "Could not load face reference image."));
  }
  return response.blob();
}

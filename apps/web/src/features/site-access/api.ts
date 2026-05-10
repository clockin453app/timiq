import { API_URL } from "../../config/api";

export type SiteAccessRecord = {
  id: string;
  user_id: string;
  location_id: string;
  created_at: string;
};

export type CreateSiteAccessRequest = {
  user_id: string;
  location_id: string;
};

export async function listSiteAccessRecords(): Promise<SiteAccessRecord[]> {
  const response = await fetch(`${API_URL}/api/site-access`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load site access.");
  }

  return response.json() as Promise<SiteAccessRecord[]>;
}

export async function createSiteAccessRecord(
  request: CreateSiteAccessRequest,
): Promise<SiteAccessRecord> {
  const response = await fetch(`${API_URL}/api/site-access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to assign this location.");
  }

  if (response.status === 404) {
    throw new Error("User or location was not found.");
  }

  if (response.status === 409) {
    throw new Error("This user already has access to this location.");
  }

  if (!response.ok) {
    throw new Error("Could not assign location.");
  }

  return response.json() as Promise<SiteAccessRecord>;
}

export async function deleteSiteAccessRecord(
  request: CreateSiteAccessRequest,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/site-access`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to remove this location access.");
  }

  if (response.status === 404) {
    throw new Error("Site access was not found.");
  }

  if (!response.ok) {
    throw new Error("Could not remove location access.");
  }
}
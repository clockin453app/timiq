import { API_URL } from "../../config/api";

export type Location = {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateLocationRequest = {
  company_id?: string | null;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number;
  is_active: boolean;
};

export type UpdateLocationRequest = {
  company_id?: string | null;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number;
  is_active: boolean;
};

export async function listLocations(): Promise<Location[]> {
  const response = await fetch(`${API_URL}/api/locations`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load locations.");
  }

  return response.json() as Promise<Location[]>;
}

export async function createLocation(
  request: CreateLocationRequest,
): Promise<Location> {
  const response = await fetch(`${API_URL}/api/locations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to create this location.");
  }

  if (response.status === 404) {
    throw new Error("Company was not found.");
  }

  if (response.status === 409) {
    throw new Error("A location with this name already exists for this company.");
  }

  if (!response.ok) {
    throw new Error("Could not create location.");
  }

  return response.json() as Promise<Location>;
}

export async function updateLocation(
  locationId: string,
  request: UpdateLocationRequest,
): Promise<Location> {
  const response = await fetch(`${API_URL}/api/locations/${locationId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to update this location.");
  }

  if (response.status === 404) {
    throw new Error("Location or company was not found.");
  }

  if (response.status === 409) {
    throw new Error("A location with this name already exists for this company.");
  }

  if (!response.ok) {
    throw new Error("Could not update location.");
  }

  return response.json() as Promise<Location>;
}

export async function updateLocationStatus(
  locationId: string,
  isActive: boolean,
): Promise<Location> {
  const response = await fetch(`${API_URL}/api/locations/${locationId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      is_active: isActive,
    }),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to update this location.");
  }

  if (response.status === 404) {
    throw new Error("Location was not found.");
  }

  if (!response.ok) {
    throw new Error("Could not update location.");
  }

  return response.json() as Promise<Location>;
}
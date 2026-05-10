import { API_URL } from "../../config/api";

export type SystemHealth = {
  app: string;
  environment: string;
  status: string;
  database: string;
  storage: string;
};

export async function getSystemHealth(): Promise<SystemHealth> {
  const response = await fetch(`${API_URL}/api/system-health`, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 403) {
    throw new Error("Only an Administrator can view system health.");
  }

  if (!response.ok) {
    throw new Error("Could not load system health.");
  }

  return response.json() as Promise<SystemHealth>;
}

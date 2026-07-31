function resolveApiBaseUrl(): string {
  const fromBuild = import.meta.env.VITE_API_URL;
  if (typeof fromBuild === "string" && fromBuild.trim() !== "") {
    return fromBuild.trim().replace(/\/$/, "");
  }
  const fromRuntime = typeof window !== "undefined" ? window.__APPPADEL_API_URL__ : undefined;
  if (typeof fromRuntime === "string" && fromRuntime.trim() !== "") {
    return fromRuntime.trim().replace(/\/$/, "");
  }
  return "http://localhost:4000";
}

export const API_URL = resolveApiBaseUrl();
export const ADMIN_TOKEN_KEY = "apppadel_admin_token";

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? `API error ${response.status}`);
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export function apiAdmin<T>(token: string, path: string, options?: RequestInit): Promise<T> {
  return api<T>(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {})
    }
  });
}

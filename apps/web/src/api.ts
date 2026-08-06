import type {
  PlanSettings,
  RacePlan,
  Route,
  SunTimes,
  WeatherSample,
} from '@raceforecaster/core';

export interface PlanBundle {
  plan: RacePlan;
  weather: WeatherSample[];
  sun: SunTimes[];
}

export interface UploadResult {
  route: Route;
  warnings: string[];
}

export interface ShareResult {
  id: string;
  url: string;
}

export interface SharedPlan extends PlanBundle {
  route: Route;
  settings: PlanSettings;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Unexpected response from the server (${response.status}).`, response.status);
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

/** Settings as the API expects them: the route travels separately. */
function settingsPayload(routeId: string, settings: PlanSettings): string {
  return JSON.stringify({
    routeId,
    startTime: settings.startTime,
    targetSpeedKmh: settings.targetSpeedKmh,
    rider: settings.rider,
    checkpoints: settings.checkpoints,
    apparentTempMode: settings.apparentTempMode,
  });
}

export function uploadRoute(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  return request<UploadResult>('/api/routes', { method: 'POST', body: form });
}

export function uploadRouteXml(xml: string, name: string): Promise<UploadResult> {
  return request<UploadResult>('/api/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/gpx+xml', 'X-Route-Name': name },
    body: xml,
  });
}

export function fetchPlan(routeId: string, settings: PlanSettings): Promise<PlanBundle> {
  return request<PlanBundle>('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: settingsPayload(routeId, settings),
  });
}

export function createShare(routeId: string, settings: PlanSettings): Promise<ShareResult> {
  return request<ShareResult>('/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: settingsPayload(routeId, settings),
  });
}

export function loadShare(id: string): Promise<SharedPlan> {
  return request<SharedPlan>(`/api/shares/${encodeURIComponent(id)}`);
}

// --- Accounts --------------------------------------------------------------

export type UserRole = 'user' | 'full' | 'admin';

/** 'full' and 'admin' can upload routes and edit start time; only 'admin' manages other users. */
export function canManageRoutes(role: UserRole | undefined): boolean {
  return role === 'full' || role === 'admin';
}

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export function signup(username: string, password: string): Promise<{ user: AuthUser }> {
  return request('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function login(username: string, password: string): Promise<{ user: AuthUser }> {
  return request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function fetchCurrentUser(): Promise<{ user: AuthUser | null }> {
  return request('/api/auth/me');
}

// --- Saved routes ------------------------------------------------------------

export interface SavedRoute {
  id: string;
  name: string;
  isPublic: boolean;
  createdAt: number;
}

export function fetchMyRoutes(): Promise<{ routes: SavedRoute[]; limit: number }> {
  return request('/api/my/routes');
}

export function saveMyRoute(routeId: string, isPublic = true): Promise<{ ok: true }> {
  return request('/api/my/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeId, isPublic }),
  });
}

export function updateMyRoute(
  routeId: string,
  patch: { isPublic?: boolean; name?: string },
): Promise<{ ok: true }> {
  return request(`/api/my/routes/${encodeURIComponent(routeId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteMyRoute(routeId: string): Promise<{ ok: true }> {
  return request(`/api/my/routes/${encodeURIComponent(routeId)}`, { method: 'DELETE' });
}

export function fetchRoute(routeId: string): Promise<{ route: Route }> {
  return request(`/api/routes/${encodeURIComponent(routeId)}`);
}

/** The route the app lands on at "/" with no share link. */
export function fetchDefaultRoute(): Promise<{ route: Route; startTime?: number }> {
  return request('/api/default-route');
}

// --- Admin -------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
}

export function fetchAdminUsers(): Promise<{ users: AdminUserRow[] }> {
  return request('/api/admin/users');
}

export function setUserRole(userId: string, role: UserRole): Promise<{ ok: true }> {
  return request(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

export function setDefaultRoute(routeId: string, startTime?: number): Promise<{ ok: true }> {
  return request('/api/admin/default-route', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routeId, startTime }),
  });
}

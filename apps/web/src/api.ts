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

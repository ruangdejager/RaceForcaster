import {
  buildPlan,
  checkpointAtDistance,
  datesSpanned,
  DEFAULT_RIDER,
  toLocalDateTimeInput,
  parseLocalDateTime,
  type ApparentTempMode,
  type Checkpoint,
  type CheckpointKind,
  type PlanSettings,
  type RacePlan,
  type Route,
  type SunTimes,
  type WeatherSample,
} from '@raceforecaster/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api.js';
import { ApiError } from '../api.js';

export type PlannerStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface PlannerState {
  status: PlannerStatus;
  route: Route | null;
  plan: RacePlan | null;
  settings: PlanSettings | null;
  /** The forecast points the current plan was built from, for the station list. */
  weather: WeatherSample[] | null;
  warnings: string[];
  error: string | null;
  /** True while a background forecast fetch is in flight. */
  refreshing: boolean;
  /** True only for the site's unmodified default landing route. */
  isDefaultRoute: boolean;
}

/**
 * A sensible first guess: tomorrow morning.
 *
 * Deliberately not "next Saturday" — a date a day out is inside met.no's
 * hour-by-hour window, so the first thing a new visitor sees is the app at
 * full resolution rather than a page of caveats.
 */
function defaultStartTime(timezone: string): number {
  const tomorrow = Date.now() + 86_400_000;
  const datePart = toLocalDateTimeInput(timezone, tomorrow).slice(0, 10);
  return parseLocalDateTime(`${datePart}T08:00`, timezone) ?? tomorrow;
}

function initialSettings(route: Route): PlanSettings {
  return {
    startTime: defaultStartTime(route.timezone),
    targetSpeedKmh: 21,
    rider: DEFAULT_RIDER,
    checkpoints: route.checkpoints,
    apparentTempMode: 'ambient',
  };
}

/**
 * An admin can pin the default route's start time to a real race day. Once
 * that day has passed, showing it as-is would put every visitor's plan in
 * the past, so roll the calendar date forward to today while keeping the
 * time-of-day the admin picked.
 */
function resolveDefaultStartTime(timezone: string, storedStartTime: number): number {
  const todayPart = toLocalDateTimeInput(timezone, Date.now()).slice(0, 10);
  const storedLocal = toLocalDateTimeInput(timezone, storedStartTime);
  const storedDatePart = storedLocal.slice(0, 10);
  if (storedDatePart >= todayPart) return storedStartTime;

  const timePart = storedLocal.slice(11);
  return parseLocalDateTime(`${todayPart}T${timePart}`, timezone) ?? defaultStartTime(timezone);
}

export function usePlanner() {
  const [status, setStatus] = useState<PlannerStatus>('empty');
  const [route, setRoute] = useState<Route | null>(null);
  const [settings, setSettings] = useState<PlanSettings | null>(null);
  const [weather, setWeather] = useState<WeatherSample[] | null>(null);
  const [sun, setSun] = useState<SunTimes[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** True only while showing the site's default landing route, unmodified by
   *  a share link or the rider's own upload — used to hide the redundant
   *  "Share" button, since the current URL already reproduces this view. */
  const [isDefaultRoute, setIsDefaultRoute] = useState(false);

  // Guards against a slow response for an abandoned route overwriting a newer
  // one — someone uploading twice in quick succession.
  const requestSeq = useRef(0);

  /**
   * The plan itself is derived, not stored.
   *
   * This is the payoff of keeping the engine in a platform-neutral package:
   * the browser reruns the exact code the server ran, over the forecast data
   * already in memory, so moving the speed control repaints the whole plan
   * without a single network request.
   */
  const plan = useMemo<RacePlan | null>(() => {
    if (!route || !settings || !weather || !sun) return null;
    try {
      return buildPlan({ route, settings, weatherSamples: weather, sunTimes: sun });
    } catch (err) {
      console.error('Could not build the plan', err);
      return null;
    }
  }, [route, settings, weather, sun]);

  /** Load a route and its first forecast. */
  const loadRoute = useCallback(
    async (nextRoute: Route, nextWarnings: string[], startTimeOverride?: number) => {
    const seq = ++requestSeq.current;
    const nextSettings = {
      ...initialSettings(nextRoute),
      ...(startTimeOverride !== undefined ? { startTime: startTimeOverride } : {}),
    };

    setStatus('loading');
    setError(null);
    setRoute(nextRoute);
    setSettings(nextSettings);
    setWarnings(nextWarnings);
    setWeather(null);
    setSun(null);

    try {
      const bundle = await api.fetchPlan(nextRoute.id, nextSettings);
      if (seq !== requestSeq.current) return;
      setWeather(bundle.weather);
      setSun(bundle.sun);
      setStatus('ready');
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'Could not fetch the forecast.');
      setStatus('error');
    }
    },
    [],
  );

  /**
   * The route the app lands on at "/" — everyone sees this first, privileged
   * or not; "New route" (privileged only) is what lets someone move past it.
   * A 404 here just means no admin has set one yet, which is a normal empty
   * state to fall back to quietly, not something to show as an error.
   */
  const loadDefaultRoute = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await api.fetchDefaultRoute();
      const startTime =
        result.startTime !== undefined
          ? resolveDefaultStartTime(result.route.timezone, result.startTime)
          : undefined;
      await loadRoute(result.route, [], startTime);
      setIsDefaultRoute(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStatus('empty');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load the default route.');
      setStatus('error');
    }
  }, [loadRoute]);

  /** Open a route already known to the server, e.g. from "My routes". */
  const openRouteById = useCallback(
    async (routeId: string) => {
      setStatus('loading');
      setError(null);
      setIsDefaultRoute(false);
      try {
        const result = await api.fetchRoute(routeId);
        await loadRoute(result.route, []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not open that route.');
        setStatus('error');
      }
    },
    [loadRoute],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      setStatus('loading');
      setError(null);
      setIsDefaultRoute(false);
      try {
        const result = await api.uploadRoute(file);
        await loadRoute(result.route, result.warnings);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that route file.');
        setStatus('error');
      }
    },
    [loadRoute],
  );

  const openShare = useCallback(async (id: string) => {
    const seq = ++requestSeq.current;
    setStatus('loading');
    setError(null);
    setIsDefaultRoute(false);
    try {
      const shared = await api.loadShare(id);
      if (seq !== requestSeq.current) return;
      setRoute(shared.route);
      setSettings(shared.settings);
      setWeather(shared.weather);
      setSun(shared.sun);
      setWarnings([]);
      setStatus('ready');
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'Could not open that link.');
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    requestSeq.current += 1;
    setStatus('empty');
    setRoute(null);
    setSettings(null);
    setWeather(null);
    setSun(null);
    setWarnings([]);
    setError(null);
    setIsDefaultRoute(false);
  }, []);

  // --- Settings mutations -------------------------------------------------

  const patchSettings = useCallback((patch: Partial<PlanSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const setSpeed = useCallback(
    (kmh: number) => {
      patchSettings({ targetSpeedKmh: Math.min(80, Math.max(5, Math.round(kmh * 10) / 10)) });
    },
    [patchSettings],
  );

  const setStartTime = useCallback(
    (epochMs: number) => patchSettings({ startTime: epochMs }),
    [patchSettings],
  );

  const setApparentMode = useCallback(
    (mode: ApparentTempMode) => patchSettings({ apparentTempMode: mode }),
    [patchSettings],
  );

  /**
   * Nudge a checkpoint stop up or down.
   *
   * Takes a delta rather than an absolute value on purpose. The buttons are
   * small and people tap them several times in a row; computing `current + 5`
   * from a value captured at render time makes every tap in a batch read the
   * same stale number, so three taps would add five minutes instead of
   * fifteen. Reading inside the updater is the only version that survives that.
   */
  const adjustStopMinutes = useCallback((checkpointId: string, deltaMinutes: number) => {
    setSettings((current) => {
      if (!current) return current;
      const checkpoints: Checkpoint[] = current.checkpoints.map((cp) =>
        cp.id === checkpointId
          ? { ...cp, stopMinutes: Math.max(0, Math.min(24 * 60, cp.stopMinutes + deltaMinutes)) }
          : cp,
      );
      return { ...current, checkpoints };
    });
  }, []);

  /**
   * Add a checkpoint or water point at a distance along the route.
   *
   * Open to every viewer, not just privileged accounts — this only ever
   * touches the *local* settings snapshot (the same one speed and stop
   * minutes already live in), never the route's own stored data, so there's
   * nothing here for a plain viewer to damage. It rides along in a "Share"
   * link the same way a stop-minute edit already does.
   */
  const addCheckpoint = useCallback(
    (distanceKm: number, name: string, kind: Extract<CheckpointKind, 'checkpoint' | 'water'>) => {
      if (!route) return;
      const cp = checkpointAtDistance(route, distanceKm * 1000, name.trim() || 'Checkpoint');
      if (!cp) return;
      setSettings((current) => {
        if (!current) return current;
        const checkpoints = [...current.checkpoints, { ...cp, kind }].sort((a, b) => a.dist - b.dist);
        return { ...current, checkpoints };
      });
    },
    [route],
  );

  /** Only ever removes a manually-added stop — the route's own checkpoints aren't touched. */
  const removeCheckpoint = useCallback((checkpointId: string) => {
    if (!checkpointId.startsWith('cp-manual-')) return;
    setSettings((current) => {
      if (!current) return current;
      return { ...current, checkpoints: current.checkpoints.filter((cp) => cp.id !== checkpointId) };
    });
  }, []);

  // --- Keep the sun data covering the race --------------------------------
  //
  // Moving the start date far enough can take the race onto days we never
  // fetched sunrise and sunset for. The plan would still render, just without
  // knowing which hours are dark, so quietly top the data up.
  useEffect(() => {
    if (status !== 'ready' || !route || !settings || !sun || !plan) return;

    const needed = datesSpanned(route.timezone, settings.startTime, plan.summary.finishTime);
    const have = new Set(sun.map((s) => s.date));
    if (needed.every((d) => have.has(d))) return;

    let cancelled = false;
    setRefreshing(true);
    api
      .fetchPlan(route.id, settings)
      .then((bundle) => {
        if (cancelled) return;
        setWeather(bundle.weather);
        setSun(bundle.sun);
      })
      .catch(() => {
        /* Keep the existing plan; the dark-hours figure is simply incomplete. */
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, route, settings, sun, plan]);

  const share = useCallback(async (): Promise<string> => {
    if (!route || !settings) throw new Error('Nothing to share yet.');
    const result = await api.createShare(route.id, settings);
    return result.url;
  }, [route, settings]);

  const state: PlannerState = {
    status,
    route,
    plan,
    settings,
    weather,
    warnings,
    error,
    refreshing,
    isDefaultRoute,
  };

  return {
    ...state,
    loadRoute,
    loadDefaultRoute,
    openRouteById,
    uploadFile,
    openShare,
    reset,
    setSpeed,
    setStartTime,
    setApparentMode,
    adjustStopMinutes,
    addCheckpoint,
    removeCheckpoint,
    share,
  };
}

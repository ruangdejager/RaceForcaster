import {
  buildPlan,
  datesSpanned,
  DEFAULT_RIDER,
  toLocalDateTimeInput,
  parseLocalDateTime,
  type ApparentTempMode,
  type Checkpoint,
  type PlanSettings,
  type RacePlan,
  type Route,
  type SunTimes,
  type WeatherSample,
} from '@raceforecaster/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api.js';

export type PlannerStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface PlannerState {
  status: PlannerStatus;
  route: Route | null;
  plan: RacePlan | null;
  settings: PlanSettings | null;
  warnings: string[];
  error: string | null;
  /** True while a background forecast fetch is in flight. */
  refreshing: boolean;
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

export function usePlanner() {
  const [status, setStatus] = useState<PlannerStatus>('empty');
  const [route, setRoute] = useState<Route | null>(null);
  const [settings, setSettings] = useState<PlanSettings | null>(null);
  const [weather, setWeather] = useState<WeatherSample[] | null>(null);
  const [sun, setSun] = useState<SunTimes[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
  const loadRoute = useCallback(async (nextRoute: Route, nextWarnings: string[]) => {
    const seq = ++requestSeq.current;
    const nextSettings = initialSettings(nextRoute);

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
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setStatus('loading');
      setError(null);
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

  const state: PlannerState = { status, route, plan, settings, warnings, error, refreshing };

  return {
    ...state,
    loadRoute,
    uploadFile,
    openShare,
    reset,
    setSpeed,
    setStartTime,
    setApparentMode,
    adjustStopMinutes,
    share,
  };
}

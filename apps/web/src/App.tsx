import { useCallback, useEffect, useState } from 'react';
import { uploadRouteXml } from './api.js';
import { ControlBar } from './components/ControlBar.jsx';
import { ElevationProfile } from './components/ElevationProfile.jsx';
import { ForecastNotice } from './components/ForecastNotice.jsx';
import { PlanCharts } from './components/charts/PlanCharts.jsx';
import { Timeline } from './components/Timeline.jsx';
import { UploadPanel } from './components/UploadPanel.jsx';
import { km } from './format.js';
import { usePlanner } from './state/usePlanner.js';

/** `/s/<id>` is a shared plan; anything else is the blank slate. */
function shareIdFromPath(): string | null {
  const match = /^\/s\/([\w-]+)\/?$/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

export function App(): JSX.Element {
  const planner = usePlanner();
  const [shareState, setShareState] = useState<'idle' | 'working' | 'copied' | 'failed'>('idle');
  const [sampleError, setSampleError] = useState<string | null>(null);

  const { openShare } = planner;
  useEffect(() => {
    const id = shareIdFromPath();
    if (id) void openShare(id);
  }, [openShare]);

  const loadSample = useCallback(async () => {
    setSampleError(null);
    try {
      const response = await fetch('/samples/demo-230km.gpx');
      if (!response.ok) throw new Error('The sample route is not available.');
      const xml = await response.text();
      const result = await uploadRouteXml(xml, 'Demo 230 km');
      await planner.loadRoute(result.route, result.warnings);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : 'Could not load the sample route.');
    }
  }, [planner]);

  const handleShare = useCallback(async () => {
    setShareState('working');
    try {
      const url = await planner.share();
      await navigator.clipboard.writeText(url);
      window.history.replaceState(null, '', new URL(url).pathname);
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2600);
    } catch {
      setShareState('failed');
      setTimeout(() => setShareState('idle'), 2600);
    }
  }, [planner]);

  const { status, route, plan, settings, warnings, error, refreshing } = planner;
  const busy = status === 'loading';

  return (
    <div className="app">
      <header className="site-head">
        <h1>RaceForecaster</h1>
        {route && (
          <span className="route-name">
            {route.name} · {km(route.totalDistance)} km · {Math.round(route.totalAscent)} m up
          </span>
        )}
        {plan && (
          <button type="button" className="link-button" onClick={handleShare}>
            {shareState === 'working' && <span className="spinner" />}
            {shareState === 'idle' && 'Share'}
            {shareState === 'working' && ' Saving…'}
            {shareState === 'copied' && 'Link copied'}
            {shareState === 'failed' && 'Copy failed'}
          </button>
        )}
        {route && (
          <button type="button" className="link-button" onClick={planner.reset}>
            New route
          </button>
        )}
      </header>

      {!route && (
        <UploadPanel busy={busy} onFile={(f) => void planner.uploadFile(f)} onSample={() => void loadSample()} />
      )}

      {sampleError && <p className="notice error">{sampleError}</p>}
      {error && <p className="notice error">{error}</p>}
      {warnings.map((w) => (
        <p key={w} className="notice warn">
          {w}
        </p>
      ))}

      {busy && route && (
        <p className="notice">
          <span className="spinner" /> Fetching the forecast along the route…
        </p>
      )}

      {settings && route && (
        <ControlBar
          settings={settings}
          plan={plan}
          timezone={route.timezone}
          onSpeedChange={planner.setSpeed}
          onStartTimeChange={planner.setStartTime}
        />
      )}

      {route && plan && (
        <div className="profile-block">
          <ElevationProfile route={route} plan={plan} />
        </div>
      )}

      {plan && <ForecastNotice plan={plan} />}

      {plan && (
        <>
          <Timeline plan={plan} onStopAdjust={planner.adjustStopMinutes} />
          <PlanCharts plan={plan} />
        </>
      )}

      <footer className="site-foot">
        <p>
          Weather data from{' '}
          <a href="https://www.met.no/" target="_blank" rel="noreferrer noopener">
            MET Norway
          </a>{' '}
          (the Norwegian Meteorological Institute), used under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer noopener">
            CC BY 4.0
          </a>
          . Forecasts are forecasts — treat them as a plan, not a promise, and check again closer to
          the day.
          {refreshing && (
            <>
              {' '}
              <span className="spinner" /> updating…
            </>
          )}
        </p>
      </footer>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { saveMyRoute, uploadRouteXml } from './api.js';
import { AuthModal } from './components/AuthModal.jsx';
import { ControlBar } from './components/ControlBar.jsx';
import { ElevationProfile } from './components/ElevationProfile.jsx';
import { ForecastNotice } from './components/ForecastNotice.jsx';
import { MyRoutesPanel } from './components/MyRoutesPanel.jsx';
import { StationList } from './components/StationList.jsx';
import { PlanCharts } from './components/charts/PlanCharts.jsx';
import { WindProfileChart } from './components/charts/WindProfileChart.jsx';
import { Timeline } from './components/Timeline.jsx';
import { UploadPanel } from './components/UploadPanel.jsx';
import { km } from './format.js';
import { useAuth } from './state/useAuth.js';
import { usePlanner } from './state/usePlanner.js';

/** `/s/<id>` is a shared plan; anything else is the blank slate. */
function shareIdFromPath(): string | null {
  const match = /^\/s\/([\w-]+)\/?$/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

export function App(): JSX.Element {
  const planner = usePlanner();
  const auth = useAuth();
  const [shareState, setShareState] = useState<'idle' | 'working' | 'copied' | 'failed'>('idle');
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup' | null>(null);
  const [showMyRoutes, setShowMyRoutes] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'working' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const { openShare, route } = planner;
  useEffect(() => {
    const id = shareIdFromPath();
    if (id) void openShare(id);
  }, [openShare]);

  // A fresh route means fresh warnings — don't carry a dismissal from the
  // last file over to a new one just because the wording happened to match.
  useEffect(() => {
    setDismissedWarnings(new Set());
  }, [route?.id]);

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

  const handleSave = useCallback(async () => {
    if (!route) return;
    if (auth.status !== 'authed') {
      setAuthModalMode('login');
      return;
    }
    setSaveState('working');
    setSaveError(null);
    try {
      await saveMyRoute(route.id);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2600);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save that route.');
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3200);
    }
  }, [route, auth.status]);

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

  const { status, plan, settings, weather, warnings, error, refreshing } = planner;
  const busy = status === 'loading';

  // A skipped checkpoint almost always means one bad coordinate in the source
  // file (see the "Skipped ... 4442.1 km off the route" case — that number is
  // the distance to 0,0, not a real position), which is useful to whoever
  // maintains the GPX and irrelevant to everyone else opening the link. It
  // stays in the console for debugging without cluttering the page for every
  // rider who just wants their forecast.
  useEffect(() => {
    for (const w of warnings) {
      if (w.startsWith('Skipped "')) console.warn(w);
    }
  }, [warnings]);

  const visibleWarnings = warnings.filter(
    (w) => !dismissedWarnings.has(w) && !w.startsWith('Skipped "'),
  );

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
          <button type="button" className="link-button" onClick={() => void handleSave()}>
            {saveState === 'working' && <span className="spinner" />}
            {saveState === 'idle' && 'Save'}
            {saveState === 'working' && ' Saving…'}
            {saveState === 'saved' && 'Saved'}
            {saveState === 'error' && 'Save failed'}
          </button>
        )}
        {route && (
          <button type="button" className="link-button" onClick={planner.reset}>
            New route
          </button>
        )}

        <span className="site-head-account">
          {auth.status === 'authed' && auth.user && (
            <>
              <button type="button" className="link-button" onClick={() => setShowMyRoutes(true)}>
                {auth.user.username} · My routes
              </button>
              <button type="button" className="link-button" onClick={() => void auth.logout()}>
                Log out
              </button>
            </>
          )}
          {auth.status === 'anonymous' && (
            <button type="button" className="link-button" onClick={() => setAuthModalMode('login')}>
              Log in
            </button>
          )}
        </span>
      </header>

      {!route && (
        <UploadPanel busy={busy} onFile={(f) => void planner.uploadFile(f)} onSample={() => void loadSample()} />
      )}

      {sampleError && <p className="notice error">{sampleError}</p>}
      {error && <p className="notice error">{error}</p>}
      {saveError && <p className="notice error">{saveError}</p>}
      {visibleWarnings.map((w) => (
        <p key={w} className="notice warn notice-dismissible">
          {w}
          <button
            type="button"
            className="notice-dismiss"
            aria-label="Dismiss this warning"
            onClick={() => setDismissedWarnings((prev) => new Set(prev).add(w))}
          >
            ×
          </button>
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

      {route && plan && (
        <div className="wind-profile-block">
          <WindProfileChart route={route} plan={plan} />
        </div>
      )}

      {plan && <ForecastNotice plan={plan} />}

      {plan && (
        <>
          <Timeline plan={plan} onStopAdjust={planner.adjustStopMinutes} />
          <PlanCharts plan={plan} />
          {route && weather && <StationList weather={weather} route={route} />}
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

      {authModalMode && (
        <AuthModal
          mode={authModalMode}
          error={auth.error}
          onModeChange={setAuthModalMode}
          onSubmit={authModalMode === 'signup' ? auth.signup : auth.login}
          onClose={() => {
            setAuthModalMode(null);
            auth.clearError();
          }}
        />
      )}

      {showMyRoutes && (
        <MyRoutesPanel
          onOpenRoute={(id) => void planner.openRouteById(id)}
          onClose={() => setShowMyRoutes(false)}
        />
      )}
    </div>
  );
}

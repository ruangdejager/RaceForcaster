import { useCallback, useEffect, useState } from 'react';
import { canManageRoutes, saveMyRoute, setDefaultRoute } from './api.js';
import { AddCheckpointForm } from './components/AddCheckpointForm.jsx';
import { AdminPanel } from './components/AdminPanel.jsx';
import { AuthModal } from './components/AuthModal.jsx';
import { ControlBar } from './components/ControlBar.jsx';
import { ElevationProfile } from './components/ElevationProfile.jsx';
import { ForecastNotice } from './components/ForecastNotice.jsx';
import { MyRoutesPanel } from './components/MyRoutesPanel.jsx';
import { PlanCharts } from './components/charts/PlanCharts.jsx';
import { WindProfileChart } from './components/charts/WindProfileChart.jsx';
import { Timeline } from './components/Timeline.jsx';
import { UploadPanel } from './components/UploadPanel.jsx';
import { km } from './format.js';
import { useAuth } from './state/useAuth.js';
import { usePlanner } from './state/usePlanner.js';

/** `/s/<id>` is a shared plan; anything else lands on the site's default route. */
function shareIdFromPath(): string | null {
  const match = /^\/s\/([\w-]+)\/?$/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

export function App(): JSX.Element {
  const planner = usePlanner();
  const auth = useAuth();
  const [shareState, setShareState] = useState<'idle' | 'working' | 'copied' | 'failed'>('idle');
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup' | null>(null);
  const [showMyRoutes, setShowMyRoutes] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'working' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [defaultState, setDefaultState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  const { openShare, loadDefaultRoute, route } = planner;
  const canManage = canManageRoutes(auth.user?.role);

  // A specific share link always wins; otherwise land on the site's default
  // route — everyone sees the same starting point, privileged or not, and
  // "New route" (below, privileged-only) is what lets someone move past it.
  useEffect(() => {
    const id = shareIdFromPath();
    if (id) void openShare(id);
    else void loadDefaultRoute();
  }, [openShare, loadDefaultRoute]);

  // A fresh route means fresh warnings — don't carry a dismissal from the
  // last file over to a new one just because the wording happened to match.
  useEffect(() => {
    setDismissedWarnings(new Set());
  }, [route?.id]);

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

  const handleSetDefault = useCallback(async () => {
    if (!route || !planner.settings) return;
    setDefaultState('working');
    try {
      await setDefaultRoute(route.id, planner.settings.startTime);
      setDefaultState('done');
      setTimeout(() => setDefaultState('idle'), 2600);
    } catch {
      setDefaultState('error');
      setTimeout(() => setDefaultState('idle'), 3200);
    }
  }, [route, planner]);

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

  const { status, plan, settings, warnings, error, refreshing, isDefaultRoute } = planner;
  const busy = status === 'loading';
  // The current URL already reproduces the unmodified default landing route,
  // so a "Share" link is only useful once you're logged in (to build a route
  // to hand off) or once you've moved past the default some other way.
  const showShare = auth.status === 'authed' || !isDefaultRoute;

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
        {plan && showShare && (
          <button type="button" className="link-button" onClick={handleShare}>
            {shareState === 'working' && <span className="spinner" />}
            {shareState === 'idle' && 'Share'}
            {shareState === 'working' && ' Saving…'}
            {shareState === 'copied' && 'Link copied'}
            {shareState === 'failed' && 'Copy failed'}
          </button>
        )}
        {route && canManage && (
          <button type="button" className="link-button" onClick={() => void handleSave()}>
            {saveState === 'working' && <span className="spinner" />}
            {saveState === 'idle' && 'Save'}
            {saveState === 'working' && ' Saving…'}
            {saveState === 'saved' && 'Saved'}
            {saveState === 'error' && 'Save failed'}
          </button>
        )}
        {route && auth.user?.role === 'admin' && (
          <button type="button" className="link-button" onClick={() => void handleSetDefault()}>
            {defaultState === 'working' && <span className="spinner" />}
            {defaultState === 'idle' && 'Set as default'}
            {defaultState === 'working' && ' Setting…'}
            {defaultState === 'done' && 'Default set'}
            {defaultState === 'error' && 'Failed'}
          </button>
        )}
        {route && canManage && (
          <button type="button" className="link-button" onClick={planner.reset}>
            New route
          </button>
        )}

        <span className="site-head-account">
          {auth.status === 'authed' && auth.user && (
            <>
              {auth.user.role === 'admin' && (
                <button type="button" className="link-button" onClick={() => setShowAdmin(true)}>
                  Admin
                </button>
              )}
              {canManage && (
                <button type="button" className="link-button" onClick={() => setShowMyRoutes(true)}>
                  {auth.user.username} · My routes
                </button>
              )}
              {!canManage && <span className="link-button" style={{ borderColor: 'transparent' }}>{auth.user.username}</span>}
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

      {status === 'empty' && (
        <>
          {canManage ? (
            <UploadPanel busy={busy} onFile={(f) => void planner.uploadFile(f)} />
          ) : (
            <p className="notice">
              No default route has been set up yet. Log in with an account that can add routes to
              upload one.
            </p>
          )}
        </>
      )}

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

      {busy && (
        <p className="notice">
          <span className="spinner" /> Fetching the forecast along the route…
        </p>
      )}

      {settings && route && (
        <ControlBar
          settings={settings}
          plan={plan}
          timezone={route.timezone}
          canEditStartTime={canManage}
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

      {plan && route && (
        <div className="timeline-block">
          <AddCheckpointForm totalDistanceM={route.totalDistance} onAdd={planner.addCheckpoint} />
          <Timeline
            plan={plan}
            onStopAdjust={planner.adjustStopMinutes}
            onCheckpointRemove={planner.removeCheckpoint}
          />
        </div>
      )}

      {plan && (
        <div className="charts-block">
          <PlanCharts plan={plan} />
        </div>
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

      {showAdmin && auth.user && (
        <AdminPanel currentUserId={auth.user.id} onClose={() => setShowAdmin(false)} />
      )}
    </div>
  );
}

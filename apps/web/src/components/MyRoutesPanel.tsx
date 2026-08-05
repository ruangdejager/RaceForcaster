import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { SavedRoute } from '../api.js';

interface Props {
  onOpenRoute: (routeId: string) => void;
  onClose: () => void;
}

/** `Sat 8 Aug` — enough to tell saved routes apart, no need for a full timestamp. */
function dateLabel(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function MyRoutesPanel({ onOpenRoute, onClose }: Props): JSX.Element {
  const [routes, setRoutes] = useState<SavedRoute[] | null>(null);
  const [limit, setLimit] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = (): void => {
    api
      .fetchMyRoutes()
      .then((res) => {
        setRoutes(res.routes);
        setLimit(res.limit);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your routes.'));
  };

  useEffect(reload, []);

  const toggleVisibility = async (route: SavedRoute): Promise<void> => {
    setBusyId(route.id);
    try {
      await api.updateMyRoute(route.id, { isPublic: !route.isPublic });
      setRoutes((prev) =>
        prev
          ? prev.map((r) => (r.id === route.id ? { ...r, isPublic: !r.isPublic } : r))
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that route.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (route: SavedRoute): Promise<void> => {
    setBusyId(route.id);
    try {
      await api.deleteMyRoute(route.id);
      setRoutes((prev) => (prev ? prev.filter((r) => r.id !== route.id) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that route.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>My routes</h2>
          <span className="modal-count">
            {routes ? routes.length : '…'} / {limit}
          </span>
        </div>

        {error && <p className="modal-error">{error}</p>}

        {routes && routes.length === 0 && (
          <p className="modal-hint">
            Nothing saved yet. Open a route and hit <strong>Save</strong> to keep it here — up to{' '}
            {limit} at a time.
          </p>
        )}

        <ul className="my-routes-list">
          {routes?.map((route) => (
            <li key={route.id} className="my-routes-row">
              <button
                type="button"
                className="my-routes-open"
                onClick={() => {
                  onOpenRoute(route.id);
                  onClose();
                }}
              >
                {route.name}
                <span className="my-routes-date">{dateLabel(route.createdAt)}</span>
              </button>

              <div className="my-routes-actions">
                <button
                  type="button"
                  className={`visibility-toggle ${route.isPublic ? 'public' : 'private'}`}
                  onClick={() => void toggleVisibility(route)}
                  disabled={busyId === route.id}
                  title={
                    route.isPublic
                      ? 'Anyone with the link can open this'
                      : 'Only you, logged in, can open this'
                  }
                >
                  {route.isPublic ? 'Public' : 'Private'}
                </button>
                <button
                  type="button"
                  className="my-routes-remove"
                  onClick={() => void remove(route)}
                  disabled={busyId === route.id}
                  aria-label={`Remove ${route.name}`}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

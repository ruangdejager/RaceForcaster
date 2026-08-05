import { useCallback, useEffect, useState } from 'react';
import * as api from '../api.js';
import type { AuthUser } from '../api.js';

export type AuthStatus = 'checking' | 'anonymous' | 'authed';

/**
 * Who's logged in, backed by the session cookie the server already set —
 * this hook just asks `/api/auth/me` once on load rather than trying to
 * infer anything from client-side state, so a page refresh, an expired
 * session, or logging in from another tab all resolve to the truth.
 */
export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchCurrentUser()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setStatus(res.user ? 'authed' : 'anonymous');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signup = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const res = await api.signup(username, password);
      setUser(res.user);
      setStatus('authed');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that account.');
      return false;
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const res = await api.login(username, password);
      setUser(res.user);
      setStatus('authed');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in.');
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  return { status, user, error, signup, login, logout, clearError: () => setError(null) };
}

import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { AdminUserRow, UserRole } from '../api.js';

interface Props {
  currentUserId: string;
  onClose: () => void;
}

const ROLES: UserRole[] = ['user', 'full', 'admin'];

/**
 * Role management: grant "full" (route-management access — the paid tier,
 * once there is one) or "admin" (that, plus this panel). No payment
 * mechanism exists yet, so this is the whole story for now: an admin
 * flips a switch by hand.
 */
export function AdminPanel({ currentUserId, onClose }: Props): JSX.Element {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = (): void => {
    api
      .fetchAdminUsers()
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load users.'));
  };

  useEffect(reload, []);

  const changeRole = async (userId: string, role: UserRole): Promise<void> => {
    setBusyId(userId);
    setError(null);
    try {
      await api.setUserRole(userId, role);
      setUsers((prev) => (prev ? prev.map((u) => (u.id === userId ? { ...u, role } : u)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that role.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Admin</h2>
          <span className="modal-count">{users ? users.length : '…'} accounts</span>
        </div>

        {error && <p className="modal-error">{error}</p>}

        <ul className="admin-users-list">
          {users?.map((u) => (
            <li key={u.id} className="admin-users-row">
              <span className="admin-username">
                {u.username}
                {u.id === currentUserId && <span className="admin-you"> (you)</span>}
              </span>
              <select
                value={u.role}
                disabled={busyId === u.id}
                onChange={(e) => void changeRole(u.id, e.target.value as UserRole)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        <p className="modal-hint">
          <strong>user</strong> — view and adjust any plan, can't upload or change start time.{' '}
          <strong>full</strong> — can also add routes and edit start time (the paid tier, once billing
          exists). <strong>admin</strong> — that, plus this panel.
        </p>
      </div>
    </div>
  );
}

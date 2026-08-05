import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { currentUserId, endSession, startSession } from '../auth/session.js';
import type { Store } from '../db/index.js';

export interface AuthDeps {
  store: Store;
  /** Only set the cookie's Secure flag once the app is actually served over HTTPS. */
  cookieSecure: boolean;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

function publicUser(username: string, id: string): { id: string; username: string } {
  return { id, username };
}

export function createAuthApi(deps: AuthDeps): Hono {
  const auth = new Hono();

  auth.post('/signup', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body['username'] === 'string' ? body['username'].trim() : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';

    if (!USERNAME_PATTERN.test(username)) {
      return c.json(
        { error: 'Username must be 3-32 characters: letters, numbers, "_", "." or "-".' },
        400,
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return c.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }
    if (deps.store.getUserByUsername(username)) {
      return c.json({ error: 'That username is already taken.' }, 409);
    }

    const id = nanoid(14);
    const passwordHash = await hashPassword(password);
    deps.store.createUser(id, username, passwordHash);

    startSession(c, deps.store, id, deps.cookieSecure);
    return c.json({ user: publicUser(username, id) }, 201);
  });

  auth.post('/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body['username'] === 'string' ? body['username'].trim() : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';

    const user = deps.store.getUserByUsername(username);
    // Verify against a hash either way (a real one, or a fixed dummy) so a
    // wrong username doesn't return measurably faster than a wrong password —
    // that timing difference is exactly what lets an attacker enumerate which
    // usernames exist.
    const ok = await verifyPassword(
      password,
      user?.passwordHash ??
        'scrypt:32768:0000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    );

    if (!user || !ok) {
      return c.json({ error: 'Incorrect username or password.' }, 401);
    }

    startSession(c, deps.store, user.id, deps.cookieSecure);
    return c.json({ user: publicUser(user.username, user.id) });
  });

  auth.post('/logout', (c) => {
    endSession(c, deps.store);
    return c.json({ ok: true });
  });

  auth.get('/me', (c) => {
    const userId = currentUserId(c, deps.store);
    if (!userId) return c.json({ user: null });
    const user = deps.store.getUserById(userId);
    if (!user) return c.json({ user: null });
    return c.json({ user: publicUser(user.username, user.id) });
  });

  return auth;
}

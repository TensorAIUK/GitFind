interface KVNamespace {
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  USERS_KV?: KVNamespace;
  AUTH_SECRET?: string;
  APP_USERNAME?: string;
  APP_PASSWORD?: string;
  INVITE_CODE?: string;
  ALLOW_REGISTRATION?: string;
}

interface StoredUser {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface SessionPayload {
  username: string;
  exp: number;
}

const SESSION_COOKIE = 'gitfind_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

async function hashPassword(password: string, saltBase64?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = saltBase64
    ? fromBase64Url(saltBase64)
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return {
    hash: toBase64Url(new Uint8Array(derived)),
    salt: toBase64Url(saltBytes),
  };
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createSessionToken(username: string, secret: string): Promise<string> {
  const payload: SessionPayload = {
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${toBase64Url(new Uint8Array(sig))}`;
}

async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  try {
    const key = await getSigningKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as SessionPayload;
    if (!payload.username || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function sessionCookieHeader(token: string, request: Request, maxAge = SESSION_TTL_SECONDS): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function getAuthSecret(env: Env): string | null {
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) {
    return env.AUTH_SECRET;
  }
  // Fallback derived from APP_PASSWORD if user only set APP_USERNAME & APP_PASSWORD
  if (env.APP_PASSWORD) {
    return `gitfind-derived-${env.APP_PASSWORD}`;
  }
  return null;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const secret = getAuthSecret(env);
  if (!secret) {
    return json(
      {
        error:
          'Server auth is not configured. Set AUTH_SECRET + APP_USERNAME + APP_PASSWORD (or USERS_KV) in Cloudflare Worker Variables and Secrets.',
      },
      500
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const username = (body.username ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  if (!username || !password) {
    return json({ error: 'Username and password are required.' }, 400);
  }

  let authenticated = false;

  // 1. Check KV user store if bound
  if (env.USERS_KV) {
    const raw = await env.USERS_KV.get(`user:${username}`);
    if (raw) {
      const stored = JSON.parse(raw) as StoredUser;
      const { hash } = await hashPassword(password, stored.salt);
      if (timingSafeEqual(hash, stored.passwordHash)) {
        authenticated = true;
      }
    }
  }

  // 2. Check single-user env credentials if configured
  if (!authenticated && env.APP_USERNAME && env.APP_PASSWORD) {
    if (
      timingSafeEqual(username, env.APP_USERNAME.trim().toLowerCase()) &&
      timingSafeEqual(password, env.APP_PASSWORD)
    ) {
      authenticated = true;
    }
  }

  if (!authenticated) {
    return json({ error: 'Invalid username or password.' }, 401);
  }

  const token = await createSessionToken(username, secret);
  return json(
    { authenticated: true, user: { username } },
    200,
    { 'Set-Cookie': sessionCookieHeader(token, request) }
  );
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (!env.USERS_KV) {
    return json(
      {
        error:
          'Account registration requires a Cloudflare KV namespace bound as USERS_KV. Use your configured APP_USERNAME/APP_PASSWORD to sign in, or bind USERS_KV.',
      },
      501
    );
  }

  const secret = getAuthSecret(env);
  if (!secret) {
    return json({ error: 'AUTH_SECRET must be configured in Cloudflare Worker secrets.' }, 500);
  }

  let body: { username?: string; password?: string; inviteCode?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string; inviteCode?: string };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // Protect registration unless ALLOW_REGISTRATION=true or valid INVITE_CODE is provided
  if (env.INVITE_CODE) {
    if (!body.inviteCode || !timingSafeEqual(body.inviteCode, env.INVITE_CODE)) {
      return json({ error: 'Invalid invite code.' }, 403);
    }
  } else if (env.ALLOW_REGISTRATION !== 'true') {
    return json(
      { error: 'Public registration is disabled. Set INVITE_CODE or ALLOW_REGISTRATION=true.' },
      403
    );
  }

  const username = (body.username ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    return json(
      { error: 'Username must be 3-32 characters (letters, numbers, ., _, -).' },
      400
    );
  }
  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' }, 400);
  }

  const existing = await env.USERS_KV.get(`user:${username}`);
  if (existing) {
    return json({ error: 'Username already exists.' }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  const record: StoredUser = {
    username,
    passwordHash: hash,
    salt,
    createdAt: new Date().toISOString(),
  };

  await env.USERS_KV.put(`user:${username}`, JSON.stringify(record));

  const token = await createSessionToken(username, secret);
  return json(
    { authenticated: true, user: { username } },
    201,
    { 'Set-Cookie': sessionCookieHeader(token, request) }
  );
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const secret = getAuthSecret(env);
  if (!secret) {
    return json({ authenticated: false, configured: false }, 401);
  }

  const cookie = getCookie(request, SESSION_COOKIE);
  if (!cookie) {
    return json({ authenticated: false, configured: true }, 401);
  }

  const payload = await verifySessionToken(cookie, secret);
  if (!payload) {
    return json({ authenticated: false, configured: true }, 401);
  }

  return json({
    authenticated: true,
    configured: true,
    user: { username: payload.username },
    registrationEnabled: Boolean(env.USERS_KV && (env.INVITE_CODE || env.ALLOW_REGISTRATION === 'true')),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      return handleMe(request, env);
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return json(
        { ok: true },
        200,
        { 'Set-Cookie': sessionCookieHeader('', request, 0) }
      );
    }

    return env.ASSETS.fetch(request);
  },
};

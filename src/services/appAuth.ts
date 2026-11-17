export interface AppUser {
  username: string;
}

export interface AppAuthStatus {
  authenticated: boolean;
  configured: boolean;
  user?: AppUser;
}

export async function fetchAppSession(): Promise<AppAuthStatus> {
  const res = await fetch('/api/auth/me', {
    credentials: 'same-origin',
  });

  if (res.ok) {
    return (await res.json()) as AppAuthStatus;
  }

  if (res.status === 401) {
    try {
      const data = (await res.json()) as AppAuthStatus;
      return { authenticated: false, configured: data.configured ?? true };
    } catch {
      return { authenticated: false, configured: true };
    }
  }

  throw new Error(`Auth check failed (${res.status})`);
}

export async function loginApp(username: string, password: string): Promise<AppUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username, password }),
  });

  const data = (await res.json()) as { user?: AppUser; error?: string };
  if (!res.ok || !data.user) {
    throw new Error(data.error || 'Login failed');
  }
  return data.user;
}

export async function registerApp(
  username: string,
  password: string,
  inviteCode: string
): Promise<AppUser> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username, password, inviteCode }),
  });

  const data = (await res.json()) as { user?: AppUser; error?: string };
  if (!res.ok || !data.user) {
    throw new Error(data.error || 'Registration failed');
  }
  return data.user;
}

export async function logoutApp(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
}

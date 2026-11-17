import {
  GitHubCodeMatch,
  GitHubRepo,
  GitHubUser,
  GitTreeItem,
  RateLimitInfo,
} from '../types/github';

const GITHUB_API_BASE = 'https://api.github.com';

export class GitHubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

type RateLimitListener = (info: RateLimitInfo) => void;
let rateLimitListener: RateLimitListener | null = null;

export function setRateLimitListener(listener: RateLimitListener | null) {
  rateLimitListener = listener;
}

async function githubFetch<T>(
  path: string,
  token: string,
  options: { accept?: string; signal?: AbortSignal } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers,
    signal: options.signal,
  });

  const limit = res.headers.get('X-RateLimit-Limit');
  const remaining = res.headers.get('X-RateLimit-Remaining');
  const reset = res.headers.get('X-RateLimit-Reset');

  if (limit && remaining && reset && rateLimitListener) {
    rateLimitListener({
      limit: Number(limit),
      remaining: Number(remaining),
      reset: Number(reset),
    });
  }

  if (!res.ok) {
    let message = `GitHub API error (${res.status})`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) {
        message = data.message;
      }
    } catch {
      // ignore json parse failure
    }
    if (res.status === 401) {
      message = 'Invalid or expired GitHub Personal Access Token.';
    } else if (res.status === 403 && remaining === '0') {
      const resetDate = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : 'soon';
      message = `GitHub API rate limit exceeded. Resets at ${resetDate}.`;
    }
    throw new GitHubApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export async function verifyToken(token: string): Promise<GitHubUser> {
  return githubFetch<GitHubUser>('/user', token);
}

export interface SearchReposParams {
  query: string;
  sort?: 'best-match' | 'stars' | 'forks' | 'updated';
  order?: 'desc' | 'asc';
  page?: number;
  perPage?: number;
}

export interface SearchReposResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepo[];
}

export async function searchRepositories(
  token: string,
  params: SearchReposParams
): Promise<SearchReposResponse> {
  const qs = new URLSearchParams({
    q: params.query,
    per_page: String(params.perPage ?? 20),
    page: String(params.page ?? 1),
  });

  if (params.sort && params.sort !== 'best-match') {
    qs.set('sort', params.sort);
    qs.set('order', params.order ?? 'desc');
  }

  return githubFetch<SearchReposResponse>(`/search/repositories?${qs.toString()}`, token);
}

export interface SearchCodeResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubCodeMatch[];
}

export async function searchCode(
  token: string,
  params: { query: string; page?: number; perPage?: number }
): Promise<SearchCodeResponse> {
  const qs = new URLSearchParams({
    q: params.query,
    per_page: String(params.perPage ?? 20),
    page: String(params.page ?? 1),
  });

  return githubFetch<SearchCodeResponse>(`/search/code?${qs.toString()}`, token, {
    accept: 'application/vnd.github.text-match+json',
  });
}

export async function getRepo(
  token: string,
  owner: string,
  repo: string,
  signal?: AbortSignal
): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>(`/repos/${owner}/${repo}`, token, { signal });
}

export async function getRepoTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  signal?: AbortSignal
): Promise<{ tree: GitTreeItem[]; truncated: boolean }> {
  const encodedBranch = encodeURIComponent(branch);
  const res = await githubFetch<{
    sha: string;
    tree: GitTreeItem[];
    truncated: boolean;
  }>(`/repos/${owner}/${repo}/git/trees/${encodedBranch}?recursive=1`, token, { signal });

  return { tree: res.tree ?? [], truncated: Boolean(res.truncated) };
}

function decodeBase64Utf8(base64: string): string {
  const cleaned = base64.replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
  signal?: AbortSignal
): Promise<string> {
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const encodedRef = encodeURIComponent(ref);
  const data = await githubFetch<{
    type: string;
    encoding?: string;
    content?: string;
    size?: number;
  }>(`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodedRef}`, token, { signal });

  if (data.type !== 'file' || !data.content) {
    throw new Error(`Unable to read file content for ${filePath}`);
  }

  if (data.encoding === 'base64') {
    return decodeBase64Utf8(data.content);
  }

  return data.content;
}

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  // Match full GitHub URL: https://github.com/owner/repo(.git)
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2].replace(/\.git$/i, ''),
    };
  }

  // Match owner/repo
  const slugMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slugMatch) {
    return {
      owner: slugMatch[1],
      repo: slugMatch[2].replace(/\.git$/i, ''),
    };
  }

  return null;
}

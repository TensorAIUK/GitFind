export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  public_repos: number;
  total_private_repos?: number;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // unix timestamp in seconds
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
  size: number; // KB
  topics?: string[];
  license?: {
    key: string;
    name: string;
    spdx_id: string;
  } | null;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface GitHubCodeMatch {
  name: string;
  path: string;
  sha: string;
  html_url: string;
  repository: {
    id: number;
    full_name: string;
    private: boolean;
    html_url: string;
    description: string | null;
    default_branch?: string;
  };
  text_matches?: Array<{
    fragment: string;
    matches: Array<{
      text: string;
      indices: [number, number];
    }>;
  }>;
}

export interface GitTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export type FindingSeverity = 'high' | 'medium' | 'info';
export type FindingCategory = 'secret' | 'sensitive-file' | 'security' | 'hygiene' | 'custom';

export interface ScanFinding {
  id: string;
  ruleId: string;
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  path: string;
  line?: number;
  snippet?: string;
  matchText?: string;
  description: string;
}

export interface RepoHealth {
  hasReadme: boolean;
  hasLicense: boolean;
  hasCi: boolean;
  hasTests: boolean;
  hasDocker: boolean;
  hasGitignore: boolean;
  manifests: string[];
  totalFiles: number;
  totalDirs: number;
  totalSizeBytes: number;
  extensions: Array<{ ext: string; count: number; bytes: number }>;
}

export interface ScanOptions {
  checkSecrets: boolean;
  checkSecurity: boolean;
  checkHygiene: boolean;
  customPattern: string;
  customCaseSensitive: boolean;
  maxFiles: number;
}

export interface ScanResult {
  repo: GitHubRepo;
  scannedAt: string;
  mode: 'tree' | 'deep';
  filesScanned: number;
  filesSkipped: number;
  totalTreeFiles: number;
  truncatedTree: boolean;
  health: RepoHealth;
  findings: ScanFinding[];
  tree: GitTreeItem[];
}

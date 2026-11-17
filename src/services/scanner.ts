import {
  FindingCategory,
  FindingSeverity,
  GitHubRepo,
  GitTreeItem,
  RepoHealth,
  ScanFinding,
  ScanOptions,
  ScanResult,
} from '../types/github';
import { getFileContent } from './githubApi';

interface ContentRule {
  id: string;
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  regex: RegExp;
  description: string;
}

const SECRET_RULES: ContentRule[] = [
  {
    id: 'aws-access-key',
    title: 'AWS Access Key ID',
    severity: 'high',
    category: 'secret',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    description: 'Potential AWS IAM Access Key ID committed to source code.',
  },
  {
    id: 'github-token',
    title: 'GitHub Personal / App Token',
    severity: 'high',
    category: 'secret',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/,
    description: 'Potential GitHub access token detected.',
  },
  {
    id: 'private-key',
    title: 'Private Key Header',
    severity: 'high',
    category: 'secret',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
    description: 'Private cryptographic key block found in repository.',
  },
  {
    id: 'stripe-live-key',
    title: 'Stripe Live Secret Key',
    severity: 'high',
    category: 'secret',
    regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/,
    description: 'Potential Stripe live API secret key.',
  },
  {
    id: 'slack-token',
    title: 'Slack API Token',
    severity: 'high',
    category: 'secret',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
    description: 'Potential Slack bot, user, or app token.',
  },
  {
    id: 'google-api-key',
    title: 'Google API Key',
    severity: 'high',
    category: 'secret',
    regex: /\bAIza[0-9A-Za-z-_]{35}\b/,
    description: 'Potential Google Cloud / Maps / Firebase API key.',
  },
  {
    id: 'generic-secret-assign',
    title: 'Hardcoded Secret Assignment',
    severity: 'high',
    category: 'secret',
    regex:
      /\b(?:password|passwd|secret|api_key|apikey|access_token|auth_token|client_secret)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    description: 'Possible hardcoded credential or secret string literal.',
  },
];

const SECURITY_RULES: ContentRule[] = [
  {
    id: 'dynamic-eval',
    title: 'Dynamic Code Execution (eval / Function)',
    severity: 'medium',
    category: 'security',
    regex: /\b(?:eval|new Function)\s*\(/,
    description: 'Dynamic code execution can introduce injection vulnerabilities if inputs are untrusted.',
  },
  {
    id: 'dom-xss-sink',
    title: 'Raw HTML Injection Sink',
    severity: 'medium',
    category: 'security',
    regex: /\b(?:dangerouslySetInnerHTML|innerHTML\s*=|outerHTML\s*=)/,
    description: 'Direct HTML insertion can lead to XSS if content is not sanitized.',
  },
  {
    id: 'insecure-http',
    title: 'Insecure HTTP URL',
    severity: 'info',
    category: 'security',
    regex: /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|www\.w3\.org|schemas\.)[A-Za-z0-9.-]+/i,
    description: 'Non-HTTPS external URL detected.',
  },
];

const HYGIENE_RULES: ContentRule[] = [
  {
    id: 'todo-fixme',
    title: 'TODO / FIXME / HACK Marker',
    severity: 'info',
    category: 'hygiene',
    regex: /\b(?:TODO|FIXME|HACK|XXX)\b[:\s]/,
    description: 'Developer annotation indicating pending work or technical debt.',
  },
];

const SKIP_DIR_PREFIXES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.nuxt/',
  'vendor/',
  'target/',
  '__pycache__/',
  '.venv/',
  'venv/',
  'coverage/',
];

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
  '.lock', '.min.js', '.min.css', '.map',
]);

const SKIP_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
]);

const MAX_SCAN_FILE_BYTES = 180_000; // ~180 KB per file

export function analyzeRepoHealth(tree: GitTreeItem[]): RepoHealth {
  let totalFiles = 0;
  let totalDirs = 0;
  let totalSizeBytes = 0;
  const extMap = new Map<string, { count: number; bytes: number }>();

  let hasReadme = false;
  let hasLicense = false;
  let hasCi = false;
  let hasTests = false;
  let hasDocker = false;
  let hasGitignore = false;
  const manifests = new Set<string>();

  for (const item of tree) {
    if (item.type === 'tree') {
      totalDirs++;
      continue;
    }

    totalFiles++;
    const size = item.size ?? 0;
    totalSizeBytes += size;

    const lower = item.path.toLowerCase();
    const base = lower.split('/').pop() ?? lower;

    if (base.startsWith('readme')) hasReadme = true;
    if (base.startsWith('license') || base.startsWith('licence')) hasLicense = true;
    if (lower.startsWith('.github/workflows/') || base === '.gitlab-ci.yml' || base === 'jenkinsfile') {
      hasCi = true;
    }
    if (
      lower.includes('/test/') ||
      lower.includes('/tests/') ||
      lower.includes('__tests__') ||
      base.includes('.test.') ||
      base.includes('.spec.') ||
      base.startsWith('test_')
    ) {
      hasTests = true;
    }
    if (base === 'dockerfile' || base.startsWith('dockerfile.') || base === 'docker-compose.yml' || base === 'docker-compose.yaml') {
      hasDocker = true;
    }
    if (base === '.gitignore') hasGitignore = true;

    if (
      [
        'package.json',
        'pyproject.toml',
        'requirements.txt',
        'cargo.toml',
        'go.mod',
        'pom.xml',
        'build.gradle',
        'gemfile',
        'composer.json',
      ].includes(base)
    ) {
      manifests.add(item.path);
    }

    const dotIdx = base.lastIndexOf('.');
    const ext = dotIdx > 0 ? base.slice(dotIdx) : '(no ext)';
    const prev = extMap.get(ext) ?? { count: 0, bytes: 0 };
    extMap.set(ext, { count: prev.count + 1, bytes: prev.bytes + size });
  }

  const extensions = Array.from(extMap.entries())
    .map(([ext, stats]) => ({ ext, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    hasReadme,
    hasLicense,
    hasCi,
    hasTests,
    hasDocker,
    hasGitignore,
    manifests: Array.from(manifests).slice(0, 8),
    totalFiles,
    totalDirs,
    totalSizeBytes,
    extensions,
  };
}

export function scanTreeForSensitiveFiles(tree: GitTreeItem[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  let idx = 0;

  for (const item of tree) {
    if (item.type !== 'blob') continue;
    const lower = item.path.toLowerCase();
    const base = lower.split('/').pop() ?? lower;

    // .env files (excluding example/template files)
    if (
      (base === '.env' || base.startsWith('.env.')) &&
      !base.includes('example') &&
      !base.includes('sample') &&
      !base.includes('template')
    ) {
      findings.push({
        id: `tree-${idx++}`,
        ruleId: 'sensitive-env-file',
        title: 'Environment File Committed',
        severity: 'high',
        category: 'sensitive-file',
        path: item.path,
        description: 'Environment config files often contain live secrets or API credentials.',
      });
    }

    // Private key / cert files
    if (
      /\.(pem|key|p12|pfx|jks|keystore)$/i.test(base) ||
      base === 'id_rsa' ||
      base === 'id_ed25519' ||
      base === 'id_dsa'
    ) {
      findings.push({
        id: `tree-${idx++}`,
        ruleId: 'sensitive-key-file',
        title: 'Key or Certificate File',
        severity: 'high',
        category: 'sensitive-file',
        path: item.path,
        description: 'Cryptographic key or certificate file detected in repository tree.',
      });
    }

    // Credential files
    if (
      base === 'credentials.json' ||
      base === 'secrets.yaml' ||
      base === 'secrets.yml' ||
      base === '.npmrc' ||
      base === '.pypirc' ||
      base === '.netrc'
    ) {
      findings.push({
        id: `tree-${idx++}`,
        ruleId: 'sensitive-cred-file',
        title: 'Potential Credentials File',
        severity: 'medium',
        category: 'sensitive-file',
        path: item.path,
        description: 'File name commonly associated with stored credentials or auth tokens.',
      });
    }

    // Large binary / file warning (> 5 MB)
    if ((item.size ?? 0) > 5 * 1024 * 1024) {
      const mb = ((item.size ?? 0) / (1024 * 1024)).toFixed(1);
      findings.push({
        id: `tree-${idx++}`,
        ruleId: 'large-file',
        title: `Large File (${mb} MB)`,
        severity: 'info',
        category: 'hygiene',
        path: item.path,
        description: 'Large files bloat git history and slow down clones.',
      });
    }
  }

  return findings;
}

export function isScannableTextFile(item: GitTreeItem): boolean {
  if (item.type !== 'blob') return false;
  if ((item.size ?? 0) === 0 || (item.size ?? 0) > MAX_SCAN_FILE_BYTES) return false;

  const lower = item.path.toLowerCase();
  if (SKIP_DIR_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower.includes(`/${prefix}`))) {
    return false;
  }

  const base = lower.split('/').pop() ?? lower;
  if (SKIP_FILENAMES.has(base)) return false;

  for (const ext of SKIP_EXTENSIONS) {
    if (lower.endsWith(ext)) return false;
  }

  return true;
}

function buildActiveRules(options: ScanOptions): ContentRule[] {
  const rules: ContentRule[] = [];
  if (options.checkSecrets) rules.push(...SECRET_RULES);
  if (options.checkSecurity) rules.push(...SECURITY_RULES);
  if (options.checkHygiene) rules.push(...HYGIENE_RULES);

  if (options.customPattern.trim()) {
    try {
      const flags = options.customCaseSensitive ? '' : 'i';
      const regex = new RegExp(options.customPattern.trim(), flags);
      rules.push({
        id: 'custom-pattern',
        title: `Custom Match: ${options.customPattern.trim()}`,
        severity: 'medium',
        category: 'custom',
        regex,
        description: 'Matched user-defined custom regex/keyword pattern.',
      });
    } catch {
      // Invalid regex is validated in UI; ignore if somehow passed
    }
  }

  return rules;
}

export interface DeepScanProgress {
  scanned: number;
  total: number;
  currentPath: string;
}

export async function runDeepScan(params: {
  token: string;
  repo: GitHubRepo;
  tree: GitTreeItem[];
  truncatedTree: boolean;
  options: ScanOptions;
  signal?: AbortSignal;
  onProgress?: (progress: DeepScanProgress) => void;
}): Promise<ScanResult> {
  const { token, repo, tree, truncatedTree, options, signal, onProgress } = params;
  const health = analyzeRepoHealth(tree);
  const findings: ScanFinding[] = scanTreeForSensitiveFiles(tree);

  const candidates = tree.filter(isScannableTextFile);
  const toScan = candidates.slice(0, options.maxFiles);
  const filesSkipped = tree.filter((t) => t.type === 'blob').length - toScan.length;

  const rules = buildActiveRules(options);
  let scanned = 0;
  let findingCounter = 0;

  // Process in small concurrent batches of 5 to be fast yet respectful of GitHub API
  const BATCH_SIZE = 5;
  for (let i = 0; i < toScan.length; i += BATCH_SIZE) {
    if (signal?.aborted) {
      throw new DOMException('Scan aborted', 'AbortError');
    }

    const batch = toScan.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (item) => {
        if (signal?.aborted) return;
        try {
          const content = await getFileContent(
            token,
            repo.owner.login,
            repo.name,
            item.path,
            repo.default_branch,
            signal
          );

          // Skip binary-looking content with null bytes
          if (content.includes('\u0000')) return;

          const lines = content.split(/\r?\n/);
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            if (!line || line.length > 1000) continue;

            for (const rule of rules) {
              const match = rule.regex.exec(line);
              if (match) {
                findings.push({
                  id: `content-${findingCounter++}`,
                  ruleId: rule.id,
                  title: rule.title,
                  severity: rule.severity,
                  category: rule.category,
                  path: item.path,
                  line: lineIdx + 1,
                  snippet: line.trim().slice(0, 180),
                  matchText: match[0],
                  description: rule.description,
                });
              }
            }
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
          // Skip individual file fetch errors (e.g. submodule or 404)
        } finally {
          scanned++;
          onProgress?.({
            scanned,
            total: toScan.length,
            currentPath: item.path,
          });
        }
      })
    );
  }

  // Sort findings: high -> medium -> info
  const severityOrder: Record<FindingSeverity, number> = { high: 0, medium: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    repo,
    scannedAt: new Date().toISOString(),
    mode: 'deep',
    filesScanned: scanned,
    filesSkipped,
    totalTreeFiles: health.totalFiles,
    truncatedTree,
    health,
    findings,
    tree,
  };
}

export function maskSecret(snippet: string, matchText?: string): string {
  if (!matchText || matchText.length < 8) return snippet;
  const masked =
    matchText.slice(0, 4) + '•'.repeat(Math.min(12, matchText.length - 6)) + matchText.slice(-2);
  return snippet.replace(matchText, masked);
}

export function exportScanAsMarkdown(result: ScanResult): string {
  const lines: string[] = [
    `# GitFind Scan Report: ${result.repo.full_name}`,
    ``,
    `- **Scanned At**: ${new Date(result.scannedAt).toLocaleString()}`,
    `- **Mode**: ${result.mode === 'deep' ? 'Deep Content Scan' : 'Quick Tree Scan'}`,
    `- **Branch**: \`${result.repo.default_branch}\``,
    `- **Files Scanned**: ${result.filesScanned} / ${result.totalTreeFiles}`,
    `- **Total Findings**: ${result.findings.length}`,
    ``,
    `## Repository Health`,
    `- README: ${result.health.hasReadme ? 'Yes' : 'No'}`,
    `- License: ${result.health.hasLicense ? 'Yes' : 'No'}`,
    `- CI/CD: ${result.health.hasCi ? 'Yes' : 'No'}`,
    `- Tests: ${result.health.hasTests ? 'Yes' : 'No'}`,
    `- Docker: ${result.health.hasDocker ? 'Yes' : 'No'}`,
    ``,
    `## Findings`,
  ];

  if (result.findings.length === 0) {
    lines.push('No findings detected.');
  } else {
    for (const f of result.findings) {
      const loc = f.line ? `${f.path}:${f.line}` : f.path;
      lines.push(`- **[${f.severity.toUpperCase()}] ${f.title}** — \`${loc}\``);
      if (f.snippet) {
        const safe = f.category === 'secret' ? maskSecret(f.snippet, f.matchText) : f.snippet;
        lines.push(`  \`${safe}\``);
      }
    }
  }

  return lines.join('\n');
}

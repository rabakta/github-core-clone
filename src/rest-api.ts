// REST v3 API implementation

import type { Repository, Issue, Label, Comment, PullRequest, Branch, Commit, Content, UserIdentity, RateLimit } from './types.ts';
import { storage } from './storage.ts';
import { createHash } from 'node:crypto';

const RATE_LIMIT = 5000;
const rateLimitMap = new Map<string, { count: number; reset: number }>();

function getRateLimit(token: string): RateLimit {
  const now = Date.now();
  const entry = rateLimitMap.get(token);
  if (!entry || now > entry.reset) {
    const reset = Math.ceil((now + 3600000) / 1000);
    rateLimitMap.set(token, { count: 1, reset });
    return { limit: RATE_LIMIT, remaining: RATE_LIMIT - 1, reset, used: 1, resource: 'core' };
  }
  entry.count += 1;
  return { limit: RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - entry.count), reset: entry.reset, used: entry.count, resource: 'core' };
}

function parseLinkHeader(baseUrl: string, page: number, perPage: number, total: number): string {
  const links: string[] = [];
  const totalPages = Math.ceil(total / perPage);
  if (page > 1) {
    links.push(`<${baseUrl}?page=1&per_page=${perPage}>; rel="first"`);
    links.push(`<${baseUrl}?page=${page - 1}&per_page=${perPage}>; rel="prev"`);
  }
  if (page < totalPages) {
    links.push(`<${baseUrl}?page=${page + 1}&per_page=${perPage}>; rel="next"`);
    links.push(`<${baseUrl}?page=${totalPages}&per_page=${perPage}>; rel="last"`);
  }
  return links.join(', ');
}

export function handleRestRequest(
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
  auth: string | null,
  baseUrl: string
): { status: number; body: unknown; headers: Record<string, string> } {
  const token = auth?.replace(/^Bearer\s+/i, '') ?? 'anonymous';
  const rateLimit = getRateLimit(token);
  const headers: Record<string, string> = {
    'x-ratelimit-limit': String(rateLimit.limit),
    'x-ratelimit-remaining': String(rateLimit.remaining),
    'x-ratelimit-reset': String(rateLimit.reset),
    'x-ratelimit-used': String(rateLimit.used),
  };

  // Authentication check
  if (!auth && path !== '/healthz' && path !== '/api/v3' && path !== '/api/v3/') {
    return { status: 401, body: { message: 'Requires authentication' }, headers };
  }

  const pathParts = path.split('/').filter(Boolean);
  
  // GET /api/v3 - API root
  if (method === 'GET' && (path === '/api/v3' || path === '/api/v3/')) {
    return {
      status: 200,
      body: { current_user_url: '/api/v3/user', rate_limit_url: '/api/v3/rate_limit' },
      headers: { 'x-oauth-scopes': 'repo, read:org', ...headers },
    };
  }

  // GET /api/v3/rate_limit
  if (method === 'GET' && path === '/api/v3/rate_limit') {
    return { status: 200, body: { resources: { core: rateLimit } }, headers };
  }

  // GET /api/v3/user - authenticated user
  if (method === 'GET' && path === '/api/v3/user') {
    const user = storage.getUser('testuser') ?? { name: 'Test User', email: 'test@example.com', login: 'testuser' };
    return { status: 200, body: { ...user, id: 1, avatar_url: '', url: '/api/v3/user', html_url: 'https://github.com/testuser', type: 'User', site_admin: false }, headers };
  }

  // Repository routes
  const repoMatch = path.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    const fullName = `${owner}/${repo}`;
    const subPath = repoMatch[3] || '';
    const repository = storage.getRepository(owner, repo);
    
    if (!repository && method !== 'POST') {
      return { status: 404, body: { message: 'Not Found' }, headers };
    }

    // GET /api/v3/repos/:owner/:repo
    if (method === 'GET' && !subPath) {
      return { status: 200, body: repository, headers };
    }

    // POST /api/v3/user/repos - create repo
    if (method === 'POST' && path === '/api/v3/user/repos') {
      const { name, description, private: private_ = false } = body as { name: string; description?: string; private?: boolean };
      if (!name) return { status: 422, body: { message: 'Validation Failed', errors: [{ resource: 'Repository', field: 'name', code: 'missing_field' }] }, headers };
      try {
        const newRepo = storage.createRepository('testuser', name, description ?? null, private_);
        return { status: 201, body: newRepo, headers };
      } catch (e) {
        return { status: 422, body: { message: 'Validation Failed', errors: [{ resource: 'Repository', field: 'name', code: 'already_exists' }] }, headers };
      }
    }

    // GET /api/v3/repos/:owner/:repo/branches
    if (method === 'GET' && subPath === 'branches') {
      const branches = storage.listBranches(fullName);
      const page = parseInt(query.get('page') || '1', 10);
      const perPage = Math.min(parseInt(query.get('per_page') || '30', 10), 100);
      const start = (page - 1) * perPage;
      const paginated = branches.slice(start, start + perPage);
      headers.link = parseLinkHeader(`${baseUrl}/api/v3/repos/${fullName}/branches`, page, perPage, branches.length);
      return { status: 200, body: paginated, headers };
    }

    // GET /api/v3/repos/:owner/:repo/branches/:branch
    if (method === 'GET' && subPath.startsWith('branches/')) {
      const branchName = subPath.slice(9);
      const branch = storage.getBranch(fullName, branchName);
      if (!branch) return { status: 404, body: { message: 'Not Found' }, headers };
      return { status: 200, body: branch, headers };
    }

    // GET /api/v3/repos/:owner/:repo/commits
    if (method === 'GET' && subPath === 'commits') {
      const sha = query.get('sha');
      // Simplified: return empty array for now
      return { status: 200, body: [], headers };
    }

    // GET /api/v3/repos/:owner/:repo/commits/:sha
    if (method === 'GET' && subPath.startsWith('commits/')) {
      const sha = subPath.slice(8);
      const commit = storage.getCommit(fullName, sha);
      if (!commit) return { status: 404, body: { message: 'Not Found' }, headers };
      return { status: 200, body: commit, headers };
    }

    // GET /api/v3/repos/:owner/:repo/contents/:path
    if (method === 'GET' && subPath.startsWith('contents/')) {
      const contentPath = '/' + decodeURIComponent(subPath.slice(9));
      const ref = query.get('ref');
      const content = storage.getContent(fullName, contentPath);
      if (!content) return { status: 404, body: { message: 'Not Found' }, headers };
      return { status: 200, body: content, headers };
    }

    // PUT /api/v3/repos/:owner/:repo/contents/:path - create/update file
    if (method === 'PUT' && subPath.startsWith('contents/')) {
      const contentPath = '/' + decodeURIComponent(subPath.slice(9));
      const { message, content: fileContent, branch, sha } = body as { message: string; content: string; branch?: string; sha?: string };
      if (!message || !fileContent) {
        return { status: 422, body: { message: 'Validation Failed' }, headers };
      }
      const decoded = Buffer.from(fileContent, 'base64');
      const blobSha = storage.putGitObject(fullName, 'blob', decoded);
      const newContent: Content = {
        type: 'file',
        name: contentPath.split('/').pop() || '',
        path: contentPath,
        sha: blobSha,
        size: decoded.length,
        url: `${baseUrl}/api/v3/repos/${fullName}/contents${contentPath}`,
        htmlUrl: `https://github.com/${fullName}/blob/${branch || 'main'}${contentPath}`,
        gitUrl: `${baseUrl}/api/v3/repos/${fullName}/git/blobs/${blobSha}`,
        downloadUrl: `https://raw.githubusercontent.com/${fullName}/${branch || 'main'}${contentPath}`,
        content: fileContent,
        encoding: 'base64',
      };
      storage.setContent(fullName, contentPath, newContent);
      return { status: 200, body: { content: newContent, commit: { sha: storage.generateSHA1() } }, headers };
    }

    // Issues
    if (method === 'GET' && subPath === 'issues') {
      const state = (query.get('state') as 'open' | 'closed' | 'all') || 'open';
      const issues = storage.listIssues(fullName, state);
      const page = parseInt(query.get('page') || '1', 10);
      const perPage = Math.min(parseInt(query.get('per_page') || '30', 10), 100);
      const start = (page - 1) * perPage;
      const paginated = issues.slice(start, start + perPage);
      headers.link = parseLinkHeader(`${baseUrl}/api/v3/repos/${fullName}/issues`, page, perPage, issues.length);
      return { status: 200, body: paginated, headers };
    }

    if (method === 'POST' && subPath === 'issues') {
      const { title, body: issueBody, labels, assignees } = body as { title: string; body?: string; labels?: string[]; assignees?: string[] };
      if (!title) return { status: 422, body: { message: 'Validation Failed' }, headers };
      const issue = storage.createIssue(fullName, title, issueBody ?? null, labels ?? [], assignees ?? []);
      return { status: 201, body: issue, headers };
    }

    if (method === 'GET' && subPath.startsWith('issues/')) {
      const issueNumber = parseInt(subPath.slice(7), 10);
      const issue = storage.getIssue(fullName, issueNumber);
      if (!issue) return { status: 404, body: { message: 'Not Found' }, headers };
      return { status: 200, body: issue, headers };
    }

    if (method === 'PATCH' && subPath.startsWith('issues/')) {
      const issueNumber = parseInt(subPath.slice(7), 10);
      const issue = storage.updateIssue(fullName, issueNumber, body as Partial<Issue>);
      if (!issue) return { status: 404, body: { message: 'Not Found' }, headers };
      return { status: 200, body: issue, headers };
    }

    // Issue comments
    if (method === 'GET' && subPath.startsWith('issues/') && subPath.endsWith('/comments')) {
      const issueNumber = parseInt(subPath.slice(7, -10), 10);
      const comments = storage.listComments(fullName, issueNumber);
      return { status: 200, body: comments, headers };
    }

    if (method === 'POST' && subPath.startsWith('issues/') && subPath.endsWith('/comments')) {
      const issueNumber = parseInt(subPath.slice(7, -10), 10);
      const { body: commentBody } = body as { body: string };
      if (!commentBody) return { status: 422, body: { message: 'Validation Failed' }, headers };
      const comment = storage.createComment(fullName, issueNumber, commentBody);
      return { status: 201, body: comment, headers };
    }

    // Labels
    if (method === 'GET' && subPath === 'labels') {
      const labels = storage.listLabels(fullName);
      return { status: 200, body: labels, headers };
    }

    // Pull requests
    if (method === 'GET' && subPath === 'pulls') {
      const state = (query.get('state') as 'open' | 'closed' | 'all') || 'open';
      const prs = storage.listPullRequests(fullName, state);
      const page = parseInt(query.get('page') || '1', 10);
      const perPage = Math.min(parseInt(query.get('per_page') || '30', 10), 100);
      const start = (page - 1) * perPage;
      const paginated = prs.slice(start, start + perPage);
      headers.link = parseLinkHeader(`${baseUrl}/api/v3/repos/${fullName}/pulls`, page, perPage, prs.length);
      return { status: 200, body: paginated, headers };
    }

    if (method === 'POST' && subPath === 'pulls') {
      const { title, body: prBody, head, base } = body as { title: string; body?: string; head: string; base: string };
      if (!title || !head || !base) return { status: 422, body: { message: 'Validation Failed' }, headers };
      const pr = storage.createPullRequest(fullName, title, prBody ?? null, head, base);
      return { status: 201, body: pr, headers };
    }

    if (method === 'GET' && subPath.startsWith('pulls/')) {
      const prNumber = parseInt(subPath.slice(6), 10);
      const pr = storage.getPullRequest(fullName, prNumber);
      if (!pr) return { status: 404, body: { message: 'Not Found' }, headers };
      return { status: 200, body: pr, headers };
    }

    // Git refs
    if (method === 'GET' && subPath === 'git/refs') {
      const refs = storage.listRefs(fullName);
      return { status: 200, body: refs.map(r => ({ ref: r.name, node_id: '', url: `${baseUrl}/api/v3/repos/${fullName}/git/refs/${r.name}`, object: { sha: r.target, type: r.type === 'branch' ? 'commit' : 'tag', url: `${baseUrl}/api/v3/repos/${fullName}/git/${r.type === 'branch' ? 'commits' : 'tags'}/${r.target}` })), headers };
    }

    if (method === 'POST' && subPath === 'git/refs') {
      const { ref, sha } = body as { ref: string; sha: string };
      if (!ref || !sha) return { status: 422, body: { message: 'Validation Failed' }, headers };
      const refName = ref.replace(/^refs\//, '');
      const type = refName.startsWith('heads/') ? 'branch' : refName.startsWith('tags/') ? 'tag' : 'branch';
      storage.setRef(fullName, refName, { name: refName, target: sha, type });
      return { status: 201, body: { ref: refName, node_id: '', url: `${baseUrl}/api/v3/repos/${fullName}/git/refs/${refName}`, object: { sha, type: type === 'branch' ? 'commit' : 'tag', url: '' } }, headers };
    }
  }

  // User repos
  if (method === 'GET' && path === '/api/v3/user/repos') {
    const repos = storage.listRepositories('testuser');
    const page = parseInt(query.get('page') || '1', 10);
    const perPage = Math.min(parseInt(query.get('per_page') || '30', 10), 100);
    const start = (page - 1) * perPage;
    const paginated = repos.slice(start, start + perPage);
    headers.link = parseLinkHeader(`${baseUrl}/api/v3/user/repos`, page, perPage, repos.length);
    return { status: 200, body: paginated, headers };
  }

  // GitHub API root already handled above

  return { status: 404, body: { message: 'Not Found' }, headers };
}
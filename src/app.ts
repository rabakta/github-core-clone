// Main HTTP server - handles all routes: git smart HTTP, REST v3, GraphQL v4, MCP, health

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { storage } from './storage.ts';
import { handleRestRequest } from './rest-api.ts';
import { handleGraphQLRequest } from './graphql.ts';
import { handleMCPRequest } from './mcp.ts';
import { 
  buildInfoRefs, 
  parsePktLines, 
  writePktLine, 
  writeFlushPkt,
  ZERO_OID,
  GIT_CAPABILITIES,
} from './git-protocol.ts';

const JSON_TYPE = 'application/json; charset=utf-8';

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(status, { 'content-type': JSON_TYPE, 'content-length': Buffer.byteLength(text), ...extraHeaders });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve(text ? JSON.parse(text) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

function getAuth(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  return auth ?? null;
}

function getBaseUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost';
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  return `${proto}://${host}`;
}

function pathOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
  } catch {
    return '/';
  }
}

async function handleGitSmartHTTP(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = pathOf(req);
  const method = req.method ?? 'GET';
  
  // Match /<owner>/<repo>.git/...
  const gitMatch = path.match(/^\/([^/]+)\/([^/]+)\.git\/(.+)$/);
  if (!gitMatch) return false;
  
  const [, owner, repo, gitPath] = gitMatch;
  const fullName = `${owner}/${repo}`;
  const repository = storage.getRepository(owner, repo);
  
  if (!repository) {
    sendText(res, 404, 'Not Found', 'text/plain');
    return true;
  }

  const service = gitPath.startsWith('info/refs') ? 
    (new URL(req.url ?? '/', `http://${req.headers.host}`).searchParams.get('service') as 'git-upload-pack' | 'git-receive-pack') : null;

  if (method === 'GET' && gitPath === 'info/refs' && service) {
    const output = buildInfoRefs(fullName, service);
    sendText(res, 200, output, `application/x-${service}-advertisement`, { 'cache-control': 'no-cache' });
    return true;
  }

  if (method === 'POST' && (gitPath === 'git-upload-pack' || gitPath === 'git-receive-pack')) {
    const body = await parseBody(req) as Buffer;
    if (!body) {
      sendText(res, 400, 'Bad Request', 'text/plain');
      return true;
    }

    const lines = parsePktLines(body);
    // Simplified: just respond with a basic pack response
    // Full implementation would parse want/have and send pack data
    const response = Buffer.concat([
      writePktLine('NAK'),
      writeFlushPkt(),
      // Minimal pack with just the zero OID
      Buffer.from('PACK\x00\x00\x00\x02\x00\x00\x00\x01', 'ascii'),
      Buffer.from('0000000000000000000000000000000000000000', 'hex'), // dummy object
      Buffer.alloc(20).fill(0), // checksum placeholder
    ]);
    sendText(res, 200, response.toString('binary'), `application/x-${gitPath}-result`, { 'cache-control': 'no-cache' });
    return true;
  }

  return true;
}

export function createApp(): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = pathOf(req);
    const method = req.method ?? 'GET';
    const auth = getAuth(req);
    const baseUrl = getBaseUrl(req);

    // Health check - no auth required
    if (method === 'GET' && path === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    // Git smart HTTP
    if (await handleGitSmartHTTP(req, res)) {
      return;
    }

    // MCP - streamable HTTP
    if (method === 'POST' && path === '/mcp') {
      const body = await parseBody(req);
      const result = handleMCPRequest(body);
      sendJson(res, result.status, result.body);
      return;
    }

    // GraphQL
    if (method === 'POST' && path === '/api/graphql') {
      const body = await parseBody(req);
      const result = handleGraphQLRequest(body);
      sendJson(res, result.status, result.body);
      return;
    }

    // REST v3 API
    if (path.startsWith('/api/v3')) {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const query = url.searchParams;
      const body = await parseBody(req);
      const result = handleRestRequest(method, path, query, body, auth, baseUrl);
      sendJson(res, result.status, result.body, result.headers);
      return;
    }

    // API root
    if (method === 'GET' && (path === '/api/v3' || path === '/api/v3/')) {
      sendJson(res, 200, { current_user_url: '/api/v3/user', rate_limit_url: '/api/v3/rate_limit' }, { 'x-oauth-scopes': 'repo, read:org' });
      return;
    }

    // 404 for everything else
    sendJson(res, 404, { message: 'Not Found' });
  });
}
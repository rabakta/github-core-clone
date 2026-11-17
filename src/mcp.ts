// MCP (Model Context Protocol) implementation over streamable HTTP

import type { Repository, Issue, PullRequest, UserIdentity, Label } from './types.ts';
import { storage } from './storage.ts';

interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const MCP_TOOLS: MCPTool[] = [
  {
    name: 'create_repository',
    description: 'Create a new repository',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        private: { type: 'boolean', description: 'Whether the repository is private' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_repository',
    description: 'Get repository details',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_repositories',
    description: 'List repositories for a user',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'create_issue',
    description: 'Create a new issue',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply' },
        assignees: { type: 'array', items: { type: 'string' }, description: 'Assignees' },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'get_issue',
    description: 'Get issue details',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        number: { type: 'number', description: 'Issue number' },
      },
      required: ['owner', 'repo', 'number'],
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a new pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR body' },
        head: { type: 'string', description: 'Head branch' },
        base: { type: 'string', description: 'Base branch' },
      },
      required: ['owner', 'repo', 'title', 'head', 'base'],
    },
  },
  {
    name: 'list_pull_requests',
    description: 'List pull requests in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR state' },
      },
      required: ['owner', 'repo'],
    },
  },
];

async function handleMCPToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'create_repository': {
      const { name: repoName, description, private: isPrivate = false } = args as { name: string; description?: string; private?: boolean };
      const repo = storage.createRepository('testuser', repoName, description ?? null, isPrivate);
      return { content: [{ type: 'text', text: JSON.stringify(repo, null, 2) }] };
    }
    case 'get_repository': {
      const { owner, repo } = args as { owner: string; repo: string };
      const repository = storage.getRepository(owner, repo);
      if (!repository) throw new Error('Repository not found');
      return { content: [{ type: 'text', text: JSON.stringify(repository, null, 2) }] };
    }
    case 'list_repositories': {
      const { owner } = args as { owner?: string };
      const repos = storage.listRepositories(owner);
      return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
    }
    case 'create_issue': {
      const { owner, repo, title, body, labels = [], assignees = [] } = args as { owner: string; repo: string; title: string; body?: string; labels?: string[]; assignees?: string[] };
      const issue = storage.createIssue(`${owner}/${repo}`, title, body ?? null, labels, assignees);
      return { content: [{ type: 'text', text: JSON.stringify(issue, null, 2) }] };
    }
    case 'get_issue': {
      const { owner, repo, number } = args as { owner: string; repo: string; number: number };
      const issue = storage.getIssue(`${owner}/${repo}`, number);
      if (!issue) throw new Error('Issue not found');
      return { content: [{ type: 'text', text: JSON.stringify(issue, null, 2) }] };
    }
    case 'list_issues': {
      const { owner, repo, state = 'open' } = args as { owner: string; repo: string; state?: 'open' | 'closed' | 'all' };
      const issues = storage.listIssues(`${owner}/${repo}`, state);
      return { content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }] };
    }
    case 'create_pull_request': {
      const { owner, repo, title, body, head, base } = args as { owner: string; repo: string; title: string; body?: string; head: string; base: string };
      const pr = storage.createPullRequest(`${owner}/${repo}`, title, body ?? null, head, base);
      return { content: [{ type: 'text', text: JSON.stringify(pr, null, 2) }] };
    }
    case 'list_pull_requests': {
      const { owner, repo, state = 'open' } = args as { owner: string; repo: string; state?: 'open' | 'closed' | 'all' };
      const prs = storage.listPullRequests(`${owner}/${repo}`, state);
      return { content: [{ type: 'text', text: JSON.stringify(prs, null, 2) }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function handleMCPRequest(body: unknown): { status: number; body: unknown } {
  if (!body || typeof body !== 'object') {
    return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } } };
  }

  const msg = body as MCPMessage;
  
  // Handle batch requests
  if (Array.isArray(msg)) {
    const results = await Promise.all(msg.map(m => handleMCPRequest(m)));
    return { status: 200, body: results.map(r => r.body) };
  }

  const id = msg.id ?? null;

  // Initialize
  if (msg.method === 'initialize') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: { name: 'github-forge', version: '1.0.0' },
        },
      },
    };
  }

  // Tools/list
  if (msg.method === 'tools/list') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS },
      },
    };
  }

  // Tools/call
  if (msg.method === 'tools/call') {
    const params = msg.params as { name: string; arguments?: Record<string, unknown> } | undefined;
    if (!params?.name) {
      return { status: 400, body: { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } } };
    }
    try {
      const result = await handleMCPToolCall(params.name, params.arguments ?? {});
      return { status: 200, body: { jsonrpc: '2.0', id, result } };
    } catch (e) {
      return { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } } };
    }
  }

  // Resources/list
  if (msg.method === 'resources/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { resources: [] } } };
  }

  // Prompts/list
  if (msg.method === 'prompts/list') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: { prompts: [] } } };
  }

  // Notifications/initialized
  if (msg.method === 'notifications/initialized') {
    return { status: 200, body: { jsonrpc: '2.0', id: null, result: {} } };
  }

  return {
    status: 404,
    body: { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } },
  };
}
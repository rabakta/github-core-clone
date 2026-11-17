// In-memory storage with optional /tmp persistence for trial runs

import type { Repository, Issue, Label, Comment, PullRequest, Branch, Commit, Content, TreeEntry, UserIdentity, Ref, GitObject, SHA1, GitObjectType } from './types.ts';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const STORAGE_DIR = process.env.MAKEFUN_STORAGE_DIR ?? '/tmp/github-forge';
const STORAGE_FILE = join(STORAGE_DIR, 'store.json');

function ensureStorageDir(): void {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function loadFromDisk(): StoredData | null {
  try {
    if (existsSync(STORAGE_FILE)) {
      const data = readFileSync(STORAGE_FILE, 'utf-8');
      return JSON.parse(data) as StoredData;
    }
  } catch {
    // Ignore load errors, start fresh
  }
  return null;
}

function saveToDisk(data: StoredData): void {
  try {
    ensureStorageDir();
    writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Ignore save errors
  }
}

interface StoredData {
  repositories: Map<string, Repository>;
  issues: Map<string, Map<number, Issue>>;
  labels: Map<string, Map<number, Label>>;
  comments: Map<string, Map<number, Map<number, Comment>>>;
  pullRequests: Map<string, Map<number, PullRequest>>;
  branches: Map<string, Map<string, Branch>>;
  commits: Map<string, Map<string, Commit>>;
  contents: Map<string, Map<string, Content>>;
  refs: Map<string, Map<string, Ref>>;
  gitObjects: Map<string, Map<string, GitObject>>;
  users: Map<string, UserIdentity>;
  repoCounter: number;
  issueCounter: Map<string, number>;
  prCounter: Map<string, number>;
  labelCounter: Map<string, number>;
  commentCounter: Map<string, Map<number, number>>;
}

function createEmptyStorage(): StoredData {
  return {
    repositories: new Map(),
    issues: new Map(),
    labels: new Map(),
    comments: new Map(),
    pullRequests: new Map(),
    branches: new Map(),
    commits: new Map(),
    contents: new Map(),
    refs: new Map(),
    gitObjects: new Map(),
    users: new Map(),
    repoCounter: 0,
    issueCounter: new Map(),
    prCounter: new Map(),
    labelCounter: new Map(),
    commentCounter: new Map(),
  };
}

function serializeMap<K, V>(map: Map<K, V>): [K, V][] {
  return Array.from(map.entries());
}

function deserializeMap<K, V>(entries: [K, V][]): Map<K, V> {
  return new Map(entries);
}

function serializeNestedMap<K1, K2, V>(map: Map<K1, Map<K2, V>>): [K1, [K2, V][]][] {
  return Array.from(map.entries()).map(([k, v]) => [k, Array.from(v.entries())]);
}

function deserializeNestedMap<K1, K2, V>(entries: [K1, [K2, V][]][]): Map<K1, Map<K2, V>> {
  const result = new Map<K1, Map<K2, V>>();
  for (const [k, v] of entries) {
    result.set(k, new Map(v));
  }
  return result;
}

function storageToJson(storage: StoredData): object {
  return {
    repositories: serializeMap(storage.repositories),
    issues: serializeNestedMap(storage.issues),
    labels: serializeNestedMap(storage.labels),
    comments: serializeNestedMap(storage.comments),
    pullRequests: serializeNestedMap(storage.pullRequests),
    branches: serializeNestedMap(storage.branches),
    commits: serializeNestedMap(storage.commits),
    contents: serializeNestedMap(storage.contents),
    refs: serializeNestedMap(storage.refs),
    gitObjects: serializeNestedMap(storage.gitObjects),
    users: serializeMap(storage.users),
    repoCounter: storage.repoCounter,
    issueCounter: serializeMap(storage.issueCounter),
    prCounter: serializeMap(storage.prCounter),
    labelCounter: serializeMap(storage.labelCounter),
    commentCounter: serializeNestedMap(storage.commentCounter),
  };
}

function jsonToStorage(obj: any): StoredData {
  const storage = createEmptyStorage();
  storage.repositories = deserializeMap(obj.repositories ?? []);
  storage.issues = deserializeNestedMap(obj.issues ?? []);
  storage.labels = deserializeNestedMap(obj.labels ?? []);
  storage.comments = deserializeNestedMap(obj.comments ?? []);
  storage.pullRequests = deserializeNestedMap(obj.pullRequests ?? []);
  storage.branches = deserializeNestedMap(obj.branches ?? []);
  storage.commits = deserializeNestedMap(obj.commits ?? []);
  storage.contents = deserializeNestedMap(obj.contents ?? []);
  storage.refs = deserializeNestedMap(obj.refs ?? []);
  storage.gitObjects = deserializeNestedMap(obj.gitObjects ?? []);
  storage.users = deserializeMap(obj.users ?? []);
  storage.repoCounter = obj.repoCounter ?? 0;
  storage.issueCounter = deserializeMap(obj.issueCounter ?? []);
  storage.prCounter = deserializeMap(obj.prCounter ?? []);
  storage.labelCounter = deserializeMap(obj.labelCounter ?? []);
  storage.commentCounter = deserializeNestedMap(obj.commentCounter ?? []);
  return storage;
}

class Storage {
  private data: StoredData;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const loaded = loadFromDisk();
    this.data = loaded ?? createEmptyStorage();
    // Seed default user
    if (this.data.users.size === 0) {
      const defaultUser: UserIdentity = {
        name: 'Test User',
        email: 'test@example.com',
        login: 'testuser',
      };
      this.data.users.set('testuser', defaultUser);
    }
  }

  markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 1000);
  }

  flush(): void {
    if (this.dirty) {
      saveToDisk(this.data);
      this.dirty = false;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  // Repository operations
  createRepository(owner: string, name: string, description: string | null, private_: boolean): Repository {
    const fullName = `${owner}/${name}`;
    if (this.data.repositories.has(fullName)) {
      throw new Error('Repository already exists');
    }
    this.data.repoCounter += 1;
    const now = new Date().toISOString();
    const repo: Repository = {
      id: this.data.repoCounter,
      name,
      fullName,
      owner: this.getOrCreateUser(owner),
      private: private_,
      description,
      defaultBranch: 'main',
      createdAt: now,
      updatedAt: now,
      pushedAt: null,
      htmlUrl: `https://github.com/${fullName}`,
      cloneUrl: `https://github.com/${fullName}.git`,
      sshUrl: `git@github.com:${fullName}.git`,
      gitUrl: `git://github.com/${fullName}.git`,
      size: 0,
      stargazersCount: 0,
      watchersCount: 0,
      forksCount: 0,
      openIssuesCount: 0,
      hasIssues: true,
      hasProjects: true,
      hasWiki: true,
      hasPages: false,
      hasDownloads: true,
      archived: false,
      disabled: false,
      visibility: private_ ? 'private' : 'public',
    };
    this.data.repositories.set(fullName, repo);
    this.data.issues.set(fullName, new Map());
    this.data.labels.set(fullName, new Map());
    this.data.comments.set(fullName, new Map());
    this.data.pullRequests.set(fullName, new Map());
    this.data.branches.set(fullName, new Map());
    this.data.commits.set(fullName, new Map());
    this.data.contents.set(fullName, new Map());
    this.data.refs.set(fullName, new Map());
    this.data.gitObjects.set(fullName, new Map());
    this.data.issueCounter.set(fullName, 0);
    this.data.prCounter.set(fullName, 0);
    this.data.labelCounter.set(fullName, 0);
    this.data.commentCounter.set(fullName, new Map());
    this.markDirty();
    return repo;
  }

  getRepository(owner: string, name: string): Repository | undefined {
    return this.data.repositories.get(`${owner}/${name}`);
  }

  getRepositoryById(id: number): Repository | undefined {
    for (const repo of this.data.repositories.values()) {
      if (repo.id === id) return repo;
    }
    return undefined;
  }

  listRepositories(owner?: string): Repository[] {
    const repos = Array.from(this.data.repositories.values());
    if (owner) {
      return repos.filter(r => r.owner.login === owner);
    }
    return repos;
  }

  updateRepository(fullName: string, updates: Partial<Repository>): Repository | undefined {
    const repo = this.data.repositories.get(fullName);
    if (!repo) return undefined;
    const updated = { ...repo, ...updates, updatedAt: new Date().toISOString() };
    this.data.repositories.set(fullName, updated);
    this.markDirty();
    return updated;
  }

  deleteRepository(fullName: string): boolean {
    const deleted = this.data.repositories.delete(fullName);
    if (deleted) {
      this.data.issues.delete(fullName);
      this.data.labels.delete(fullName);
      this.data.comments.delete(fullName);
      this.data.pullRequests.delete(fullName);
      this.data.branches.delete(fullName);
      this.data.commits.delete(fullName);
      this.data.contents.delete(fullName);
      this.data.refs.delete(fullName);
      this.data.gitObjects.delete(fullName);
      this.data.issueCounter.delete(fullName);
      this.data.prCounter.delete(fullName);
      this.data.labelCounter.delete(fullName);
      this.data.commentCounter.delete(fullName);
      this.markDirty();
    }
    return deleted;
  }

  // User operations
  getOrCreateUser(login: string): UserIdentity {
    let user = this.data.users.get(login);
    if (!user) {
      user = { name: login, email: `${login}@example.com`, login };
      this.data.users.set(login, user);
      this.markDirty();
    }
    return user;
  }

  getUser(login: string): UserIdentity | undefined {
    return this.data.users.get(login);
  }

  // Git object storage
  putGitObject(fullName: string, type: GitObjectType, data: Buffer): SHA1 {
    const hash = createHash('sha1');
    const header = `${type} ${data.length}\0`;
    hash.update(header);
    hash.update(data);
    const sha = hash.digest('hex');
    const repoObjects = this.data.gitObjects.get(fullName);
    if (repoObjects) {
      repoObjects.set(sha, { type, data });
    }
    return sha;
  }

  getGitObject(fullName: string, sha: SHA1): GitObject | undefined {
    return this.data.gitObjects.get(fullName)?.get(sha);
  }

  // Ref operations
  getRef(fullName: string, refName: string): Ref | undefined {
    return this.data.refs.get(fullName)?.get(refName);
  }

  setRef(fullName: string, refName: string, ref: Ref): void {
    const repoRefs = this.data.refs.get(fullName);
    if (repoRefs) {
      repoRefs.set(refName, ref);
      this.markDirty();
    }
  }

  deleteRef(fullName: string, refName: string): boolean {
    const deleted = this.data.refs.get(fullName)?.delete(refName);
    if (deleted) this.markDirty();
    return !!deleted;
  }

  listRefs(fullName: string, prefix?: string): Ref[] {
    const repoRefs = this.data.refs.get(fullName);
    if (!repoRefs) return [];
    const refs = Array.from(repoRefs.values());
    if (prefix) {
      return refs.filter(r => r.name.startsWith(prefix));
    }
    return refs;
  }

  // Branch operations
  getBranch(fullName: string, branchName: string): Branch | undefined {
    return this.data.branches.get(fullName)?.get(branchName);
  }

  setBranch(fullName: string, branchName: string, branch: Branch): void {
    const repoBranches = this.data.branches.get(fullName);
    if (repoBranches) {
      repoBranches.set(branchName, branch);
      this.markDirty();
    }
  }

  listBranches(fullName: string): Branch[] {
    return Array.from(this.data.branches.get(fullName)?.values() ?? []);
  }

  // Commit operations
  getCommit(fullName: string, sha: SHA1): Commit | undefined {
    return this.data.commits.get(fullName)?.get(sha);
  }

  setCommit(fullName: string, sha: SHA1, commit: Commit): void {
    const repoCommits = this.data.commits.get(fullName);
    if (repoCommits) {
      repoCommits.set(sha, commit);
      this.markDirty();
    }
  }

  // Content operations
  getContent(fullName: string, path: string): Content | undefined {
    return this.data.contents.get(fullName)?.get(path);
  }

  setContent(fullName: string, path: string, content: Content): void {
    const repoContents = this.data.contents.get(fullName);
    if (repoContents) {
      repoContents.set(path, content);
      this.markDirty();
    }
  }

  listContents(fullName: string, path: string): Content[] {
    const repoContents = this.data.contents.get(fullName);
    if (!repoContents) return [];
    const prefix = path === '/' ? '' : path.replace(/\/$/, '') + '/';
    return Array.from(repoContents.values())
      .filter(c => c.path.startsWith(prefix) && c.path !== path)
      .filter(c => {
        const rest = c.path.slice(prefix.length);
        return !rest.includes('/');
      });
  }

  // Issue operations
  createIssue(fullName: string, title: string, body: string | null, labels: string[], assignees: string[]): Issue {
    const counter = (this.data.issueCounter.get(fullName) ?? 0) + 1;
    this.data.issueCounter.set(fullName, counter);
    const now = new Date().toISOString();
    const issue: Issue = {
      id: counter,
      number: counter,
      title,
      body,
      state: 'open',
      user: this.getOrCreateUser('testuser'), // Would be auth user in real impl
      labels: labels.map(name => this.getOrCreateLabel(fullName, name)),
      assignees: assignees.map(login => this.getOrCreateUser(login)),
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      comments: 0,
      repositoryUrl: `https://api.github.com/repos/${fullName}`,
      htmlUrl: `https://github.com/${fullName}/issues/${counter}`,
    };
    this.data.issues.get(fullName)?.set(counter, issue);
    const repo = this.data.repositories.get(fullName);
    if (repo) {
      repo.openIssuesCount += 1;
      this.data.repositories.set(fullName, repo);
    }
    this.markDirty();
    return issue;
  }

  getIssue(fullName: string, number: number): Issue | undefined {
    return this.data.issues.get(fullName)?.get(number);
  }

  updateIssue(fullName: string, number: number, updates: Partial<Issue>): Issue | undefined {
    const issue = this.data.issues.get(fullName)?.get(number);
    if (!issue) return undefined;
    const updated = { ...issue, ...updates, updatedAt: new Date().toISOString() };
    this.data.issues.get(fullName)?.set(number, updated);
    if (updates.state && updates.state !== issue.state) {
      const repo = this.data.repositories.get(fullName);
      if (repo) {
        repo.openIssuesCount += updates.state === 'open' ? 1 : -1;
        this.data.repositories.set(fullName, repo);
      }
    }
    this.markDirty();
    return updated;
  }

  listIssues(fullName: string, state?: 'open' | 'closed' | 'all'): Issue[] {
    const issues = Array.from(this.data.issues.get(fullName)?.values() ?? []);
    if (state && state !== 'all') {
      return issues.filter(i => i.state === state);
    }
    return issues;
  }

  // Label operations
  getOrCreateLabel(fullName: string, name: string): Label {
    const repoLabels = this.data.labels.get(fullName);
    if (!repoLabels) throw new Error('Repository not found');
    let label = Array.from(repoLabels.values()).find(l => l.name === name);
    if (!label) {
      const counter = (this.data.labelCounter.get(fullName) ?? 0) + 1;
      this.data.labelCounter.set(fullName, counter);
      const colors = ['d73a4a', '0075ca', '5319e7', 'fef2c0', 'b60205', 'fbca04', '0e8a16', 'c2e0c6', 'f9d0c4', 'bfd4f2'];
      label = {
        id: counter,
        name,
        color: colors[counter % colors.length],
        description: null,
        default: counter <= 8,
      };
      repoLabels.set(counter, label);
      this.markDirty();
    }
    return label;
  }

  getLabel(fullName: string, name: string): Label | undefined {
    return Array.from(this.data.labels.get(fullName)?.values() ?? []).find(l => l.name === name);
  }

  listLabels(fullName: string): Label[] {
    return Array.from(this.data.labels.get(fullName)?.values() ?? []);
  }

  // Comment operations
  createComment(fullName: string, issueNumber: number, body: string): Comment {
    const issueComments = this.data.comments.get(fullName)?.get(issueNumber) ?? new Map();
    this.data.comments.get(fullName)?.set(issueNumber, issueComments);
    const counter = (this.data.commentCounter.get(fullName)?.get(issueNumber) ?? 0) + 1;
    this.data.commentCounter.get(fullName)?.set(issueNumber, counter);
    const now = new Date().toISOString();
    const comment: Comment = {
      id: counter,
      body,
      user: this.getOrCreateUser('testuser'),
      createdAt: now,
      updatedAt: now,
      htmlUrl: `https://github.com/${fullName}/issues/${issueNumber}#issuecomment-${counter}`,
    };
    issueComments.set(counter, comment);
    const issue = this.data.issues.get(fullName)?.get(issueNumber);
    if (issue) {
      issue.comments += 1;
      issue.updatedAt = now;
      this.data.issues.get(fullName)?.set(issueNumber, issue);
    }
    this.markDirty();
    return comment;
  }

  listComments(fullName: string, issueNumber: number): Comment[] {
    return Array.from(this.data.comments.get(fullName)?.get(issueNumber)?.values() ?? []);
  }

  // Pull Request operations
  createPullRequest(fullName: string, title: string, body: string | null, head: string, base: string): PullRequest {
    const counter = (this.data.prCounter.get(fullName) ?? 0) + 1;
    this.data.prCounter.set(fullName, counter);
    const now = new Date().toISOString();
    const repo = this.data.repositories.get(fullName)!;
    const pr: PullRequest = {
      id: counter,
      number: counter,
      title,
      body,
      state: 'open',
      user: this.getOrCreateUser('testuser'),
      head: { ref: head, sha: '0000000000000000000000000000000000000000', repo },
      base: { ref: base, sha: '0000000000000000000000000000000000000000', repo },
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      mergedAt: null,
      mergeCommitSha: null,
      draft: false,
      htmlUrl: `https://github.com/${fullName}/pull/${counter}`,
      diffUrl: `https://github.com/${fullName}/pull/${counter}.diff`,
      patchUrl: `https://github.com/${fullName}/pull/${counter}.patch`,
      mergeable: true,
      merged: false,
      mergeableState: 'clean',
    };
    this.data.pullRequests.get(fullName)?.set(counter, pr);
    this.markDirty();
    return pr;
  }

  getPullRequest(fullName: string, number: number): PullRequest | undefined {
    return this.data.pullRequests.get(fullName)?.get(number);
  }

  listPullRequests(fullName: string, state?: 'open' | 'closed' | 'all'): PullRequest[] {
    const prs = Array.from(this.data.pullRequests.get(fullName)?.values() ?? []);
    if (state && state !== 'all') {
      return prs.filter(p => p.state === state);
    }
    return prs;
  }

  // Utility
  generateSHA1(): SHA1 {
    return Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}

export const storage = new Storage();

// Graceful shutdown
process.on('SIGTERM', () => storage.flush());
process.on('SIGINT', () => storage.flush());
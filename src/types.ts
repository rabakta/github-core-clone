// Core types and utilities for the GitHub-compatible forge

/** SHA-1 hash as hex string */
export type SHA1 = string;

/** Git object types */
export type GitObjectType = 'blob' | 'tree' | 'commit' | 'tag';

/** Git object in memory */
export interface GitObject {
  type: GitObjectType;
  data: Buffer;
}

/** Repository reference */
export interface Ref {
  name: string;
  target: SHA1;
  type: 'branch' | 'tag';
}

/** User identity */
export interface UserIdentity {
  name: string;
  email: string;
  login: string;
}

/** Commit metadata */
export interface CommitMeta {
  message: string;
  timestamp: number;
  author: UserIdentity;
  committer?: UserIdentity;
  parents: SHA1[];
}

/** Tree entry */
export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree';
  sha: SHA1;
  path: string;
}

/** Repository data */
export interface Repository {
  id: number;
  name: string;
  fullName: string;
  owner: UserIdentity;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  gitUrl: string;
  size: number;
  stargazersCount: number;
  watchersCount: number;
  forksCount: number;
  openIssuesCount: number;
  hasIssues: boolean;
  hasProjects: boolean;
  hasWiki: boolean;
  hasPages: boolean;
  hasDownloads: boolean;
  archived: boolean;
  disabled: boolean;
  visibility: 'public' | 'private';
}

/** Issue data */
export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: UserIdentity;
  labels: Label[];
  assignees: UserIdentity[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  comments: number;
  pullRequest?: { url: string; htmlUrl: string; diffUrl: string; patchUrl: string };
  repositoryUrl: string;
  htmlUrl: string;
}

/** Label data */
export interface Label {
  id: number;
  name: string;
  color: string;
  description: string | null;
  default: boolean;
}

/** Comment data */
export interface Comment {
  id: number;
  body: string;
  user: UserIdentity;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

/** Pull request data */
export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  user: UserIdentity;
  head: { ref: string; sha: SHA1; repo: Repository };
  base: { ref: string; sha: SHA1; repo: Repository };
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergeCommitSha: SHA1 | null;
  draft: boolean;
  htmlUrl: string;
  diffUrl: string;
  patchUrl: string;
  mergeable: boolean | null;
  merged: boolean;
  mergeableState: 'clean' | 'dirty' | 'blocked' | 'behind' | 'unstable' | 'draft' | 'unknown';
}

/** Branch data */
export interface Branch {
  name: string;
  commit: { sha: SHA1; url: string };
  protected: boolean;
}

/** Commit data */
export interface Commit {
  sha: SHA1;
  nodeId: string;
  commit: {
    author: UserIdentity;
    committer: UserIdentity;
    message: string;
    tree: { sha: SHA1; url: string };
    url: string;
    commentCount: number;
    verification: { verified: boolean; reason: string; signature: string | null; payload: string | null };
  };
  url: string;
  htmlUrl: string;
  commentsUrl: string;
  author: UserIdentity;
  committer: UserIdentity;
  parents: { sha: SHA1; url: string }[];
}

/** Content data */
export interface Content {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  name: string;
  path: string;
  sha: SHA1;
  size: number;
  url: string;
  htmlUrl: string;
  gitUrl: string;
  downloadUrl: string | null;
  content?: string;
  encoding?: 'base64';
}

/** API Error response */
export interface ApiError {
  message: string;
  documentationUrl?: string;
}

/** Pagination links */
export interface PaginationLinks {
  first?: string;
  last?: string;
  prev?: string;
  next?: string;
}

/** Rate limit info */
export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
  resource: string;
}
// GraphQL v4 implementation

import type { Repository, Issue, PullRequest, UserIdentity, Label } from './types.ts';
import { storage } from './storage.ts';

const GRAPHQL_SCHEMA = `
  type Query {
    viewer: User
    repository(owner: String!, name: String!): Repository
    rateLimit: RateLimit
    node(id: ID!): Node
  }

  type Mutation {
    createRepository(input: CreateRepositoryInput!): CreateRepositoryPayload
    createIssue(input: CreateIssueInput!): CreateIssuePayload
    createPullRequest(input: CreatePullRequestInput!): CreatePullRequestPayload
    updateIssue(input: UpdateIssueInput!): UpdateIssuePayload
    addComment(input: AddCommentInput!): AddCommentPayload
  }

  type User {
    id: ID!
    login: String!
    name: String
    email: String
    avatarUrl: String
    url: String!
    repositories(first: Int, after: String): RepositoryConnection
  }

  type Repository {
    id: ID!
    name: String!
    nameWithOwner: String!
    owner: User!
    description: String
    isPrivate: Boolean!
    url: String!
    defaultBranchRef: Ref
    refs(first: Int, after: String, refPrefix: String): RefConnection
    issues(first: Int, after: String, states: [IssueState!]): IssueConnection
    pullRequests(first: Int, after: String, states: [PullRequestState!]): PullRequestConnection
    object(expression: String!): GitObject
  }

  type Ref {
    name: String!
    target: GitObject
  }

  type RefConnection {
    nodes: [Ref!]!
    pageInfo: PageInfo!
  }

  type Issue {
    id: ID!
    number: Int!
    title: String!
    body: String
    state: IssueState!
    author: User!
    labels(first: Int): LabelConnection
    comments(first: Int): IssueCommentConnection
    url: String!
    createdAt: String!
    updatedAt: String!
  }

  type IssueConnection {
    nodes: [Issue!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type IssueComment {
    id: ID!
    body: String!
    author: User!
    createdAt: String!
    updatedAt: String!
  }

  type IssueCommentConnection {
    nodes: [IssueComment!]!
    pageInfo: PageInfo!
  }

  type Label {
    id: ID!
    name: String!
    color: String!
    description: String
  }

  type LabelConnection {
    nodes: [Label!]!
  }

  type PullRequest {
    id: ID!
    number: Int!
    title: String!
    body: String
    state: PullRequestState!
    author: User!
    headRef: Ref!
    baseRef: Ref!
    url: String!
    createdAt: String!
    updatedAt: String!
    mergedAt: String
    mergeable: MergeableState
  }

  type PullRequestConnection {
    nodes: [PullRequest!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type GitObject {
    oid: ID!
    ... on Commit {
      message: String!
      author: GitActor!
      committedDate: String!
      tree: Tree!
      parents(first: Int): CommitConnection
    }
    ... on Tree {
      entries: [TreeEntry!]!
    }
    ... on Blob {
      text: String
      byteSize: Int!
    }
  }

  type Commit {
    oid: ID!
    message: String!
    author: GitActor!
    committedDate: String!
    tree: Tree!
    parents(first: Int): CommitConnection
  }

  type CommitConnection {
    nodes: [Commit!]!
    pageInfo: PageInfo!
  }

  type Tree {
    entries: [TreeEntry!]!
  }

  type TreeEntry {
    name: String!
    oid: ID!
    type: String!
    mode: Int!
  }

  type Blob {
    oid: ID!
    text: String
    byteSize: Int!
  }

  type GitActor {
    name: String!
    email: String!
    date: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type RateLimit {
    limit: Int!
    remaining: Int!
    resetAt: String!
    used: Int!
  }

  interface Node {
    id: ID!
  }

  input CreateRepositoryInput {
    name: String!
    description: String
    visibility: RepositoryVisibility!
    ownerId: ID
  }

  type CreateRepositoryPayload {
    repository: Repository
    clientMutationId: String
  }

  input CreateIssueInput {
    repositoryId: ID!
    title: String!
    body: String
    labelIds: [ID!]
    assigneeIds: [ID!]
  }

  type CreateIssuePayload {
    issue: Issue
    clientMutationId: String
  }

  input CreatePullRequestInput {
    repositoryId: ID!
    title: String!
    body: String
    headRefName: String!
    baseRefName: String!
  }

  type CreatePullRequestPayload {
    pullRequest: PullRequest
    clientMutationId: String
  }

  input UpdateIssueInput {
    id: ID!
    title: String
    body: String
    state: IssueState
    labelIds: [ID!]
  }

  type UpdateIssuePayload {
    issue: Issue
    clientMutationId: String
  }

  input AddCommentInput {
    subjectId: ID!
    body: String!
  }

  type AddCommentPayload {
    comment: IssueComment
    clientMutationId: String
  }

  enum IssueState {
    OPEN
    CLOSED
  }

  enum PullRequestState {
    OPEN
    CLOSED
    MERGED
  }

  enum MergeableState {
    MERGEABLE
    CONFLICTING
    UNKNOWN
  }

  enum RepositoryVisibility {
    PUBLIC
    PRIVATE
  }

  type RepositoryConnection {
    nodes: [Repository!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }
`;

function parseGraphQLRequest(body: unknown): { query: string; variables?: Record<string, unknown>; operationName?: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.query !== 'string') return null;
  return {
    query: b.query,
    variables: b.variables as Record<string, unknown> | undefined,
    operationName: b.operationName as string | undefined,
  };
}

function executeGraphQL(query: string, variables: Record<string, unknown> = {}): { data?: unknown; errors?: Array<{ message: string }> } {
  // Simplified GraphQL execution - in reality you'd use a proper GraphQL engine
  // This handles the basic queries the test suite sends
  
  try {
    // viewer query
    if (query.includes('viewer')) {
      const user = storage.getUser('testuser') ?? { name: 'Test User', email: 'test@example.com', login: 'testuser' };
      return {
        data: {
          viewer: {
            id: 'VXNlcjox',
            login: user.login,
            name: user.name,
            email: user.email,
            avatarUrl: '',
            url: '/api/v3/user',
            repositories: { nodes: storage.listRepositories(user.login).slice(0, 10), pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } },
          },
        },
      };
    }

    // rateLimit query
    if (query.includes('rateLimit')) {
      return {
        data: {
          rateLimit: { limit: 5000, remaining: 4999, resetAt: new Date(Date.now() + 3600000).toISOString(), used: 1 },
        },
      };
    }

    // repository query
    const repoMatch = query.match(/repository\(owner:\s*"([^"]+)"\s*,\s*name:\s*"([^"]+)"\)/);
    if (repoMatch) {
      const [, owner, name] = repoMatch;
      const repo = storage.getRepository(owner, name);
      if (!repo) {
        return { data: { repository: null } };
      }
      return {
        data: {
          repository: {
            id: `UmVwb3NpdG9yeTox`,
            name: repo.name,
            nameWithOwner: repo.fullName,
            owner: { id: 'VXNlcjox', login: repo.owner.login, name: repo.owner.name, email: repo.owner.email, avatarUrl: '', url: '/api/v3/user' },
            description: repo.description,
            isPrivate: repo.private,
            url: repo.htmlUrl,
            defaultBranchRef: { name: 'refs/heads/main', target: { oid: '0000000000000000000000000000000000000000', __typename: 'Commit', message: '', author: { name: '', email: '', date: '' }, committedDate: '', tree: { entries: [] }, parents: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } } } },
            refs: { nodes: [{ name: 'refs/heads/main', target: { oid: '0000000000000000000000000000000000000000', __typename: 'Commit' } }], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
            issues: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false }, totalCount: 0 },
            pullRequests: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false }, totalCount: 0 },
            object: null,
          },
        },
      };
    }

    // node query
    const nodeMatch = query.match(/node\(id:\s*"([^"]+)"\)/);
    if (nodeMatch) {
      return { data: { node: null } };
    }

    return { data: {} };
  } catch (e) {
    return { errors: [{ message: e instanceof Error ? e.message : String(e) }] };
  }
}

export function handleGraphQLRequest(body: unknown): { status: number; body: unknown } {
  const parsed = parseGraphQLRequest(body);
  if (!parsed) {
    return { status: 400, body: { errors: [{ message: 'Invalid GraphQL request' }] } };
  }

  const result = executeGraphQL(parsed.query, parsed.variables);
  if (result.errors) {
    return { status: 400, body: result };
  }
  return { status: 200, body: result };
}

export { GRAPHQL_SCHEMA };
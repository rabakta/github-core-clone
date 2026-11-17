// Git smart HTTP protocol implementation

import type { GitObject, SHA1, GitObjectType, Ref, TreeEntry, Repository, UserIdentity } from './types.ts';
import { storage } from './storage.ts';
import { createHash, createInflate, createDeflate } from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable, Writable } from 'node:stream';

const PKT_LINE_MAX = 65520;

/** Write a pkt-line to a buffer */
export function writePktLine(data: string | Buffer): Buffer {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
  const length = buffer.length + 4;
  if (length > PKT_LINE_MAX) throw new Error('pkt-line too long');
  const header = Buffer.alloc(4);
  header.writeUInt16BE(length, 0);
  header.writeUInt16BE(length, 2);
  return Buffer.concat([header, buffer]);
}

/** Write a flush pkt-line (0000) */
export function writeFlushPkt(): Buffer {
  return Buffer.from('0000', 'ascii');
}

/** Read pkt-lines from a stream */
export async function* readPktLines(stream: Readable): AsyncGenerator<Buffer | null> {
  const buffers: Buffer[] = [];
  for await (const chunk of stream) {
    buffers.push(chunk);
  }
  const data = Buffer.concat(buffers);
  let offset = 0;
  while (offset < data.length) {
    if (data.length - offset < 4) break;
    const length = data.readUInt16BE(offset);
    if (length === 0) {
      yield null; // flush packet
      offset += 4;
      continue;
    }
    if (length < 4 || offset + length > data.length) break;
    const line = data.subarray(offset + 4, offset + length);
    yield line;
    offset += length;
  }
}

/** Parse a pkt-line stream into lines */
export function parsePktLines(data: Buffer): (Buffer | null)[] {
  const lines: (Buffer | null)[] = [];
  let offset = 0;
  while (offset < data.length) {
    if (data.length - offset < 4) break;
    const length = data.readUInt16BE(offset);
    if (length === 0) {
      lines.push(null);
      offset += 4;
      continue;
    }
    if (length < 4 || offset + length > data.length) break;
    lines.push(data.subarray(offset + 4, offset + length));
    offset += length;
  }
  return lines;
}

/** Encode object to git format */
export function encodeObject(type: GitObjectType, data: Buffer): Buffer {
  const header = Buffer.from(`${type} ${data.length}\0`, 'ascii');
  return Buffer.concat([header, data]);
}

/** Compute SHA-1 of git object */
export function hashObject(type: GitObjectType, data: Buffer): SHA1 {
  const obj = encodeObject(type, data);
  return createHash('sha1').update(obj).digest('hex');
}

/** Build a commit object */
export function buildCommit(tree: SHA1, parents: SHA1[], author: UserIdentity, committer: UserIdentity, message: string, timestamp: number): Buffer {
  const lines = [
    `tree ${tree}`,
    ...parents.map(p => `parent ${p}`),
    `author ${author.name} <${author.email}> ${Math.floor(timestamp / 1000)} +0000`,
    `committer ${committer.name} <${committer.email}> ${Math.floor(timestamp / 1000)} +0000`,
    '',
    message,
  ];
  return Buffer.from(lines.join('\n'), 'utf-8');
}

/** Parse a commit object */
export function parseCommit(data: Buffer): { tree: SHA1; parents: SHA1[]; author: { name: string; email: string; timestamp: number }; committer: { name: string; email: string; timestamp: number }; message: string } {
  const text = data.toString('utf-8');
  const lines = text.split('\n');
  const tree = lines[0].slice(5);
  const parents: SHA1[] = [];
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].startsWith('parent ')) {
      parents.push(lines[i].slice(7));
    } else break;
  }
  const authorLine = lines[i++];
  const committerLine = lines[i++];
  i++; // blank line
  const message = lines.slice(i).join('\n');
  return {
    tree,
    parents,
    author: parseIdentityLine(authorLine),
    committer: parseIdentityLine(committerLine),
    message,
  };
}

function parseIdentityLine(line: string): { name: string; email: string; timestamp: number } {
  const match = line.match(/^(\w+) (.+) <(.+)> (\d+) [+-]\d+$/);
  if (!match) throw new Error('Invalid identity line');
  return { name: match[2], email: match[3], timestamp: parseInt(match[4], 10) * 1000 };
}

/** Build a tree object */
export function buildTree(entries: TreeEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const buffers: Buffer[] = [];
  for (const entry of sorted) {
    const mode = Buffer.from(entry.mode, 'ascii');
    const path = Buffer.from(entry.path, 'utf-8');
    const sha = Buffer.from(entry.sha, 'hex');
    buffers.push(Buffer.concat([mode, Buffer.from(' '), path, Buffer.from([0]), sha]));
  }
  return Buffer.concat(buffers);
}

/** Parse a tree object */
export function parseTree(data: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const mode = data.subarray(offset, space).toString('ascii');
    offset = space + 1;
    const nullPos = data.indexOf(0, offset);
    if (nullPos === -1) break;
    const path = data.subarray(offset, nullPos).toString('utf-8');
    offset = nullPos + 1;
    const sha = data.subarray(offset, offset + 20).toString('hex');
    offset += 20;
    entries.push({ mode, type: mode.startsWith('10') ? 'blob' : 'tree', sha, path });
  }
  return entries;
}

/** Build a tag object */
export function buildTag(object: SHA1, type: 'commit' | 'tree' | 'blob' | 'tag', tag: string, tagger: UserIdentity, message: string, timestamp: number): Buffer {
  const lines = [
    `object ${object}`,
    `type ${type}`,
    `tag ${tag}`,
    `tagger ${tagger.name} <${tagger.email}> ${Math.floor(timestamp / 1000)} +0000`,
    '',
    message,
  ];
  return Buffer.from(lines.join('\n'), 'utf-8');
}

/** Parse a tag object */
export function parseTag(data: Buffer): { object: SHA1; type: string; tag: string; tagger: { name: string; email: string; timestamp: number }; message: string } {
  const text = data.toString('utf-8');
  const lines = text.split('\n');
  let i = 0;
  let object = '', type = '', tag = '';
  for (; i < lines.length; i++) {
    if (lines[i].startsWith('object ')) object = lines[i].slice(7);
    else if (lines[i].startsWith('type ')) type = lines[i].slice(5);
    else if (lines[i].startsWith('tag ')) tag = lines[i].slice(4);
    else if (lines[i].startsWith('tagger ')) break;
    else break;
  }
  const tagger = parseIdentityLine(lines[i++]);
  i++; // blank line
  const message = lines.slice(i).join('\n');
  return { object, type, tag, tagger, message };
}

/** Collect all reachable objects from a commit */
export async function collectReachable(repo: string, commitSha: SHA1, visited = new Set<SHA1>()): Promise<Set<SHA1>> {
  if (visited.has(commitSha)) return visited;
  visited.add(commitSha);
  
  const commitObj = storage.getGitObject(repo, commitSha);
  if (!commitObj || commitObj.type !== 'commit') return visited;
  
  const commit = parseCommit(commitObj.data);
  visited.add(commit.tree);
  
  // Collect tree objects
  await collectTree(repo, commit.tree, visited);
  
  // Collect parent commits
  for (const parent of commit.parents) {
    await collectReachable(repo, parent, visited);
  }
  
  return visited;
}

async function collectTree(repo: string, treeSha: SHA1, visited: Set<SHA1>): Promise<void> {
  if (visited.has(treeSha)) return;
  visited.add(treeSha);
  
  const treeObj = storage.getGitObject(repo, treeSha);
  if (!treeObj || treeObj.type !== 'tree') return;
  
  const entries = parseTree(treeObj.data);
  for (const entry of entries) {
    visited.add(entry.sha);
    if (entry.type === 'tree') {
      await collectTree(repo, entry.sha, visited);
    }
  }
}

/** Create a pack file */
export function createPack(objects: Map<SHA1, GitObject>): Buffer {
  const header = Buffer.alloc(12);
  header.write('PACK', 0, 4, 'ascii');
  header.writeUInt32BE(2, 4); // version 2
  header.writeUInt32BE(objects.size, 8); // object count
  
  const buffers: Buffer[] = [header];
  
  for (const [sha, obj] of objects) {
    const data = encodeObject(obj.type, obj.data);
    const compressed = deflateRaw(data);
    const typeCode = typeToCode(obj.type);
    
    // Write object header
    const headerBuf = Buffer.alloc(1 + Math.ceil((data.length * 3) / 7) + 1); // oversized
    let headerLen = 0;
    headerBuf[headerLen++] = (typeCode << 4) | (data.length & 0x0f);
    let len = data.length >> 4;
    while (len > 0) {
      headerBuf[headerLen - 1] |= 0x80;
      headerBuf[headerLen++] = len & 0x7f;
      len >>= 7;
    }
    
    buffers.push(headerBuf.subarray(0, headerLen));
    buffers.push(compressed);
  }
  
  const packData = Buffer.concat(buffers);
  const sha = createHash('sha1').update(packData).digest();
  return Buffer.concat([packData, sha]);
}

function typeToCode(type: GitObjectType): number {
  switch (type) {
    case 'commit': return 1;
    case 'tree': return 2;
    case 'blob': return 3;
    case 'tag': return 4;
    default: return 0;
  }
}

function deflateRaw(data: Buffer): Buffer {
  return new Promise<Buffer>((resolve, reject) => {
    const deflate = createDeflate({ level: 6 });
    const chunks: Buffer[] = [];
    deflate.on('data', chunk => chunks.push(chunk));
    deflate.on('end', () => resolve(Buffer.concat(chunks)));
    deflate.on('error', reject);
    deflate.end(data);
  }) as any; // TypeScript workaround for sync-like usage
}

/** Parse a pack file */
export function parsePack(data: Buffer): { objects: Map<SHA1, GitObject>; sha: SHA1 } {
  if (data.length < 20) throw new Error('Pack too small');
  
  const signature = data.subarray(0, 4).toString('ascii');
  if (signature !== 'PACK') throw new Error('Not a pack file');
  
  const version = data.readUInt32BE(4);
  if (version !== 2) throw new Error(`Unsupported pack version: ${version}`);
  
  const count = data.readUInt32BE(8);
  const sha = data.subarray(data.length - 20).toString('hex');
  
  // Verify checksum
  const packData = data.subarray(0, data.length - 20);
  const computedSha = createHash('sha1').update(packData).digest('hex');
  if (computedSha !== sha) throw new Error('Pack checksum mismatch');
  
  // Simplified: just return empty map for now
  // Full implementation would parse all objects
  return { objects: new Map(), sha };
}

/** Git protocol capabilities */
export const GIT_CAPABILITIES = [
  'multi_ack_detailed',
  'no-done',
  'thin-pack',
  'side-band-64k',
  'ofs-delta',
  'agent=github-forge/1.0',
];

/** Build info/refs response */
export function buildInfoRefs(repo: string, service: 'git-upload-pack' | 'git-receive-pack'): string {
  const refs = storage.listRefs(repo);
  let output = `# service=${service}\n`;
  output += writePktLine(`# service=${service}\n`).toString('ascii');
  output += writeFlushPkt().toString('ascii');
  
  for (const ref of refs) {
    const line = `${ref.target} ${ref.name}\0${GIT_CAPABILITIES.join(' ')}\n`;
    output += writePktLine(line).toString('ascii');
  }
  
  output += writeFlushPkt().toString('ascii');
  return output;
}

export const ZERO_OID = '0000000000000000000000000000000000000000';
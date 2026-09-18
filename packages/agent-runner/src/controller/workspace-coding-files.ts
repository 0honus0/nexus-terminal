import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { applyPatch, parsePatch, type StructuredPatch } from 'diff';

const WORK_LOGICAL_ROOT = '/workspace/work';
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 64 * 1024;
const MAX_READ_LINES = 1_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_CONTEXT_LINES = 5;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_BYTES = 16 * 1024 * 1024;
const MAX_SEARCH_LINE_BYTES = 4 * 1024;
const MAX_PATCH_FILES = 16;
const MAX_PATCH_BYTES = 30 * 1024;

export interface RunnerWorkspaceFileReadRequest {
  path: string;
  startLine?: number;
  endLine?: number;
  offsetBytes?: number;
  maxBytes?: number;
}

export interface RunnerWorkspaceFileReadResult {
  path: string;
  sha256: string;
  sizeBytes: number;
  content: string;
  startLine: number | null;
  endLine: number | null;
  offsetBytes: number | null;
  contentBytes: number;
  truncated: boolean;
}

export interface RunnerWorkspaceSearchRequest {
  query: string;
  path: string;
  glob?: string;
  maxResults: number;
  contextLines: number;
  maxOutputBytes: number;
}

export interface RunnerWorkspaceSearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  before: string[];
  after: string[];
}

export interface RunnerWorkspaceSearchResult {
  query: string;
  path: string;
  engine: 'rg' | 'fallback';
  matches: RunnerWorkspaceSearchMatch[];
  truncated: boolean;
  scannedFiles: number;
  scannedBytes: number;
}

export interface RunnerWorkspacePatchExpectedFile {
  path: string;
  sha256: string;
}

export interface RunnerWorkspaceApplyPatchRequest {
  patch: string;
  expectedFiles: RunnerWorkspacePatchExpectedFile[];
  dryRun?: boolean;
}

export interface RunnerWorkspacePatchChange {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  beforeBytes: number;
  afterBytes: number;
  additions: number;
  deletions: number;
}

export interface RunnerWorkspaceApplyPatchResult {
  changes: RunnerWorkspacePatchChange[];
  applied: boolean;
}

const normalizeLogicalPath = (value: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 4096) {
    throw new Error('WORKSPACE_PATH_INVALID');
  }
  const trimmed = value.trim();
  const logical = path.posix.normalize(trimmed.startsWith('/') ? trimmed : `${WORK_LOGICAL_ROOT}/${trimmed}`);
  if (logical !== WORK_LOGICAL_ROOT && !logical.startsWith(WORK_LOGICAL_ROOT + '/')) {
    throw new Error('WORKSPACE_PATH_FORBIDDEN');
  }
  return logical.replace(/\/$/, '') || WORK_LOGICAL_ROOT;
};

const hostPathFor = (workRoot: string, logical: string): string => {
  const relative = logical === WORK_LOGICAL_ROOT ? '' : logical.slice((WORK_LOGICAL_ROOT + '/').length);
  return path.join(workRoot, ...relative.split('/').filter(Boolean));
};

const assertRoot = (workRoot: string): string => {
  if (!path.isAbsolute(workRoot) || workRoot.includes('\0')) throw new Error('WORKSPACE_PATH_INVALID');
  const root = path.resolve(workRoot);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  return root;
};

const assertNoSymlink = (root: string, target: string, allowMissing = false): void => {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      if (allowMissing) continue;
      throw new Error('WORKSPACE_NOT_FOUND');
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  }
};

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

const decodeUtf8 = (value: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new Error('WORKSPACE_FILE_NOT_TEXT');
  }
};

const utf8Prefix = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
};

const openRegularFile = (root: string, logical: string): { raw: Buffer; stat: fs.Stats; hostPath: string } => {
  const hostPath = hostPathFor(root, logical);
  assertNoSymlink(root, hostPath, false);
  const handle = fs.openSync(hostPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) throw new Error('WORKSPACE_FILE_INVALID');
    if (stat.size > MAX_SOURCE_FILE_BYTES) throw new Error('WORKSPACE_FILE_TOO_LARGE');
    return { raw: fs.readFileSync(handle), stat, hostPath };
  } finally {
    fs.closeSync(handle);
  }
};

const positiveInteger = (value: number | undefined, fallback: number, max: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > max) throw new Error('VALIDATION_FAILED');
  return resolved;
};

export const readWorkspaceFile = (
  workRoot: string,
  request: RunnerWorkspaceFileReadRequest,
): RunnerWorkspaceFileReadResult => {
  const root = assertRoot(workRoot);
  const logical = normalizeLogicalPath(request.path);
  const { raw } = openRegularFile(root, logical);
  const digest = sha256(raw);
  const maxBytes = positiveInteger(request.maxBytes, Math.min(MAX_READ_BYTES, Math.max(1, raw.byteLength)), MAX_READ_BYTES);
  const hasByteRange = request.offsetBytes !== undefined;
  const hasLineRange = request.startLine !== undefined || request.endLine !== undefined;
  if (hasByteRange && hasLineRange) throw new Error('VALIDATION_FAILED');

  if (hasByteRange) {
    const offsetBytes = request.offsetBytes!;
    if (!Number.isSafeInteger(offsetBytes) || offsetBytes < 0 || offsetBytes > raw.byteLength) {
      throw new Error('VALIDATION_FAILED');
    }
    if (offsetBytes < raw.byteLength && (raw[offsetBytes]! & 0xc0) === 0x80) {
      throw new Error('WORKSPACE_BYTE_RANGE_INVALID');
    }
    const decoded = decodeUtf8(raw.subarray(offsetBytes));
    const content = utf8Prefix(decoded, maxBytes);
    const contentBytes = Buffer.byteLength(content, 'utf8');
    return {
      path: logical,
      sha256: digest,
      sizeBytes: raw.byteLength,
      content,
      startLine: null,
      endLine: null,
      offsetBytes,
      contentBytes,
      truncated: offsetBytes + contentBytes < raw.byteLength,
    };
  }

  const decoded = decodeUtf8(raw);
  const lines = decoded.split('\n');
  const startLine = positiveInteger(request.startLine, 1, Math.max(1, lines.length));
  const endLine = positiveInteger(
    request.endLine,
    Math.min(lines.length, startLine + 199),
    Math.max(1, lines.length),
  );
  if (endLine < startLine || endLine - startLine + 1 > MAX_READ_LINES) throw new Error('VALIDATION_FAILED');
  const selected = lines.slice(startLine - 1, endLine).join('\n');
  const content = utf8Prefix(selected, maxBytes);
  const contentBytes = Buffer.byteLength(content, 'utf8');
  return {
    path: logical,
    sha256: digest,
    sizeBytes: raw.byteLength,
    content,
    startLine,
    endLine,
    offsetBytes: null,
    contentBytes,
    truncated: contentBytes < Buffer.byteLength(selected, 'utf8') || endLine < lines.length,
  };
};

const clippedLine = (value: string): string => utf8Prefix(value.replace(/\r?\n$/, ''), MAX_SEARCH_LINE_BYTES);

interface SearchEvent {
  type: 'match' | 'context';
  path: string;
  line: number;
  column: number;
  text: string;
}

const boundedMatches = (
  events: SearchEvent[],
  maxResults: number,
  contextLines: number,
  maxOutputBytes: number,
): { matches: RunnerWorkspaceSearchMatch[]; truncated: boolean } => {
  const matchEvents = events.filter((event) => event.type === 'match');
  const matches: RunnerWorkspaceSearchMatch[] = [];
  let bytes = 2;
  let truncated = matchEvents.length > maxResults;
  for (const event of matchEvents) {
    if (matches.length >= maxResults) break;
    const contexts = events.filter(
      (candidate) =>
        candidate.type === 'context' &&
        candidate.path === event.path &&
        Math.abs(candidate.line - event.line) <= contextLines,
    );
    const candidate: RunnerWorkspaceSearchMatch = {
      path: event.path,
      line: event.line,
      column: event.column,
      text: clippedLine(event.text),
      before: contexts
        .filter((candidate) => candidate.line < event.line)
        .sort((left, right) => left.line - right.line)
        .map((candidate) => clippedLine(candidate.text)),
      after: contexts
        .filter((candidate) => candidate.line > event.line)
        .sort((left, right) => left.line - right.line)
        .map((candidate) => clippedLine(candidate.text)),
    };
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8') + 1;
    if (bytes + candidateBytes > maxOutputBytes) {
      truncated = true;
      break;
    }
    matches.push(candidate);
    bytes += candidateBytes;
  }
  return { matches, truncated };
};

const logicalFromHost = (root: string, hostPath: string): string => {
  const relative = path.relative(root, hostPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  return relative ? `${WORK_LOGICAL_ROOT}/${relative.split(path.sep).join('/')}` : WORK_LOGICAL_ROOT;
};

const searchWithRipgrep = (
  root: string,
  logical: string,
  request: RunnerWorkspaceSearchRequest,
): RunnerWorkspaceSearchResult | null => {
  const probe = spawnSync('rg', ['--version'], { encoding: 'utf8', timeout: 500, maxBuffer: 4096 });
  if (probe.error || probe.status !== 0) return null;
  const target = hostPathFor(root, logical);
  assertNoSymlink(root, target, false);
  const maxBuffer = Math.max(64 * 1024, Math.min(2 * 1024 * 1024, request.maxOutputBytes * 8));
  const args = [
    '--json',
    '--no-messages',
    '--max-filesize',
    String(MAX_SOURCE_FILE_BYTES),
    '--context',
    String(request.contextLines),
    ...(request.glob ? ['--glob', request.glob] : []),
    '--',
    request.query,
    target,
  ];
  const result = spawnSync('rg', args, { encoding: 'utf8', timeout: 5_000, maxBuffer });
  if (result.status !== 0 && result.status !== 1 && !result.error) throw new Error('WORKSPACE_SEARCH_INVALID');
  const events: SearchEvent[] = [];
  const seenFiles = new Set<string>();
  for (const line of String(result.stdout ?? '').split('\n')) {
    if (!line) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type !== 'match' && parsed?.type !== 'context') continue;
    const hostPath = parsed?.data?.path?.text;
    const lineNumber = parsed?.data?.line_number;
    const text = parsed?.data?.lines?.text;
    if (typeof hostPath !== 'string' || !Number.isSafeInteger(lineNumber) || typeof text !== 'string') continue;
    const logicalPath = logicalFromHost(root, hostPath);
    seenFiles.add(logicalPath);
    const submatchStart = parsed.type === 'match' ? parsed?.data?.submatches?.[0]?.start : 0;
    events.push({
      type: parsed.type,
      path: logicalPath,
      line: lineNumber,
      column: Number.isSafeInteger(submatchStart) ? Number(submatchStart) + 1 : 1,
      text,
    });
  }
  const bounded = boundedMatches(events, request.maxResults, request.contextLines, request.maxOutputBytes);
  return {
    query: request.query,
    path: logical,
    engine: 'rg',
    matches: bounded.matches,
    truncated: bounded.truncated || Boolean(result.error),
    scannedFiles: seenFiles.size,
    scannedBytes: 0,
  };
};

const compileSearch = (query: string): RegExp => {
  if (!query || Buffer.byteLength(query, 'utf8') > 1024) throw new Error('VALIDATION_FAILED');
  try {
    return new RegExp(query, 'u');
  } catch {
    throw new Error('WORKSPACE_SEARCH_INVALID');
  }
};

const fallbackSearch = (
  root: string,
  logical: string,
  request: RunnerWorkspaceSearchRequest,
): RunnerWorkspaceSearchResult => {
  const expression = compileSearch(request.query);
  const target = hostPathFor(root, logical);
  assertNoSymlink(root, target, false);
  const files: string[] = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  if (stat.isFile()) files.push(target);
  else if (!stat.isDirectory()) throw new Error('WORKSPACE_PATH_INVALID');
  else {
    const stack = [target];
    while (stack.length && files.length < MAX_SEARCH_FILES) {
      const directory = stack.pop()!;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) stack.push(candidate);
        else if (entry.isFile()) files.push(candidate);
        if (files.length >= MAX_SEARCH_FILES) {
          truncated = true;
          break;
        }
      }
    }
  }

  const events: SearchEvent[] = [];
  let matchCount = 0;
  outer: for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (
      request.glob &&
      !path.matchesGlob(relative, request.glob) &&
      !path.matchesGlob(path.basename(relative), request.glob)
    ) {
      continue;
    }
    const fileStat = fs.lstatSync(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_SOURCE_FILE_BYTES) continue;
    if (scannedBytes + fileStat.size > MAX_SEARCH_BYTES) {
      truncated = true;
      break;
    }
    const raw = fs.readFileSync(file);
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      continue;
    }
    scannedFiles += 1;
    scannedBytes += raw.byteLength;
    const lines = decoded.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const match = expression.exec(lines[index]!);
      if (!match) continue;
      matchCount += 1;
      const logicalPath = logicalFromHost(root, file);
      for (
        let offset = Math.max(0, index - request.contextLines);
        offset <= Math.min(lines.length - 1, index + request.contextLines);
        offset += 1
      ) {
        events.push({
          type: offset === index ? 'match' : 'context',
          path: logicalPath,
          line: offset + 1,
          column: offset === index ? match.index + 1 : 1,
          text: lines[offset]!,
        });
      }
      if (matchCount >= request.maxResults + 1) {
        truncated = true;
        break outer;
      }
    }
  }
  const bounded = boundedMatches(events, request.maxResults, request.contextLines, request.maxOutputBytes);
  return {
    query: request.query,
    path: logical,
    engine: 'fallback',
    matches: bounded.matches,
    truncated: truncated || bounded.truncated,
    scannedFiles,
    scannedBytes,
  };
};

export const searchWorkspace = (
  workRoot: string,
  request: RunnerWorkspaceSearchRequest,
): RunnerWorkspaceSearchResult => {
  const root = assertRoot(workRoot);
  if (
    !Number.isSafeInteger(request.maxResults) ||
    request.maxResults < 1 ||
    request.maxResults > MAX_SEARCH_RESULTS ||
    !Number.isSafeInteger(request.contextLines) ||
    request.contextLines < 0 ||
    request.contextLines > MAX_SEARCH_CONTEXT_LINES ||
    !Number.isSafeInteger(request.maxOutputBytes) ||
    request.maxOutputBytes < 1024 ||
    request.maxOutputBytes > 256 * 1024 ||
    (request.glob !== undefined && (typeof request.glob !== 'string' || !request.glob || request.glob.length > 512))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  compileSearch(request.query);
  const logical = normalizeLogicalPath(request.path);
  return searchWithRipgrep(root, logical, request) ?? fallbackSearch(root, logical, request);
};

const normalizePatchFileName = (value: string | undefined): string => {
  if (!value || value === '/dev/null') throw new Error('WORKSPACE_PATCH_UNSUPPORTED');
  const unprefixed = value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value;
  return normalizeLogicalPath(unprefixed);
};

const sourceLinesAtDeclaredLocation = (source: string, patchSpec: StructuredPatch): boolean => {
  const sourceLines = source.split('\n');
  for (const hunk of patchSpec.hunks) {
    const expected = hunk.lines
      .filter((line) => line.startsWith(' ') || line.startsWith('-'))
      .map((line) => line.slice(1));
    const actual = sourceLines.slice(
      Math.max(0, hunk.oldStart - 1),
      Math.max(0, hunk.oldStart - 1) + expected.length,
    );
    if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) return false;
  }
  return true;
};

export const applyWorkspacePatch = (
  workRoot: string,
  request: RunnerWorkspaceApplyPatchRequest,
): RunnerWorkspaceApplyPatchResult => {
  const root = assertRoot(workRoot);
  if (
    typeof request.patch !== 'string' ||
    !request.patch ||
    Buffer.byteLength(request.patch, 'utf8') > MAX_PATCH_BYTES ||
    !Array.isArray(request.expectedFiles) ||
    request.expectedFiles.length < 1 ||
    request.expectedFiles.length > MAX_PATCH_FILES
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const expected = new Map<string, string>();
  for (const item of request.expectedFiles) {
    const logical = normalizeLogicalPath(item.path);
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || expected.has(logical)) throw new Error('VALIDATION_FAILED');
    expected.set(logical, item.sha256);
  }
  let patches: StructuredPatch[];
  try {
    patches = parsePatch(request.patch);
  } catch {
    throw new Error('WORKSPACE_PATCH_INVALID');
  }
  if (!patches.length || patches.length > MAX_PATCH_FILES) throw new Error('WORKSPACE_PATCH_INVALID');

  const prepared: Array<{
    logical: string;
    hostPath: string;
    before: Buffer;
    after: Buffer;
    mode: number;
    change: RunnerWorkspacePatchChange;
  }> = [];
  const patchPaths = new Set<string>();
  for (const patchSpec of patches) {
    if (
      patchSpec.isBinary ||
      patchSpec.isCreate ||
      patchSpec.isDelete ||
      patchSpec.isRename ||
      patchSpec.isCopy ||
      patchSpec.hunks.length < 1
    ) {
      throw new Error('WORKSPACE_PATCH_UNSUPPORTED');
    }
    const oldLogical = normalizePatchFileName(patchSpec.oldFileName);
    const newLogical = normalizePatchFileName(patchSpec.newFileName);
    if (oldLogical !== newLogical || patchPaths.has(oldLogical)) throw new Error('WORKSPACE_PATCH_UNSUPPORTED');
    patchPaths.add(oldLogical);
    const expectedHash = expected.get(oldLogical);
    if (!expectedHash) throw new Error('WORKSPACE_PATCH_PRECONDITION_MISSING');
    const opened = openRegularFile(root, oldLogical);
    const beforeSha256 = sha256(opened.raw);
    if (beforeSha256 !== expectedHash) throw new Error('WORKSPACE_FILE_HASH_CONFLICT');
    const source = decodeUtf8(opened.raw);
    if (!sourceLinesAtDeclaredLocation(source, patchSpec)) throw new Error('WORKSPACE_PATCH_CONTEXT_MISMATCH');
    const patched = applyPatch(source, patchSpec, { fuzzFactor: 0, autoConvertLineEndings: false });
    if (patched === false) throw new Error('WORKSPACE_PATCH_CONTEXT_MISMATCH');
    const after = Buffer.from(patched, 'utf8');
    if (after.byteLength > MAX_SOURCE_FILE_BYTES) throw new Error('WORKSPACE_FILE_TOO_LARGE');
    let additions = 0;
    let deletions = 0;
    for (const hunk of patchSpec.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) additions += 1;
        else if (line.startsWith('-')) deletions += 1;
      }
    }
    prepared.push({
      logical: oldLogical,
      hostPath: opened.hostPath,
      before: opened.raw,
      after,
      mode: opened.stat.mode & 0o777,
      change: {
        path: oldLogical,
        beforeSha256,
        afterSha256: sha256(after),
        beforeBytes: opened.raw.byteLength,
        afterBytes: after.byteLength,
        additions,
        deletions,
      },
    });
  }
  if (patchPaths.size !== expected.size) throw new Error('WORKSPACE_PATCH_PRECONDITION_MISMATCH');

  for (const item of prepared) {
    const current = openRegularFile(root, item.logical).raw;
    if (sha256(current) !== item.change.beforeSha256) throw new Error('WORKSPACE_FILE_HASH_CONFLICT');
  }

  if (request.dryRun) return { changes: prepared.map((item) => item.change), applied: false };

  const temporaries: Array<{ temporary: string; target: string }> = [];
  try {
    for (const item of prepared) {
      const temporary = `${item.hostPath}.nexus-patch-${randomUUID()}`;
      const handle = fs.openSync(temporary, 'wx', item.mode || 0o600);
      try {
        fs.writeFileSync(handle, item.after);
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      temporaries.push({ temporary, target: item.hostPath });
    }
    for (const item of temporaries) fs.renameSync(item.temporary, item.target);
  } finally {
    for (const item of temporaries) fs.rmSync(item.temporary, { force: true });
  }

  return { changes: prepared.map((item) => item.change), applied: true };
};

export const WORKSPACE_CODING_LIMITS = {
  logicalRoot: WORK_LOGICAL_ROOT,
  maxSourceFileBytes: MAX_SOURCE_FILE_BYTES,
  maxReadBytes: MAX_READ_BYTES,
  maxReadLines: MAX_READ_LINES,
  maxSearchResults: MAX_SEARCH_RESULTS,
  maxSearchContextLines: MAX_SEARCH_CONTEXT_LINES,
  maxSearchFiles: MAX_SEARCH_FILES,
  maxSearchBytes: MAX_SEARCH_BYTES,
  maxPatchFiles: MAX_PATCH_FILES,
  maxPatchBytes: MAX_PATCH_BYTES,
} as const;

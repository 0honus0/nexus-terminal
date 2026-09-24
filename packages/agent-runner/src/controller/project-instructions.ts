import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const WORK_LOGICAL_ROOT = '/workspace/work';
const MAX_TARGET_DIRECTORIES = 8;
const MAX_INSTRUCTION_FILES = 16;
const MAX_OMISSION_DETAILS = 32;
const MAX_SOURCE_FILE_BYTES = 64 * 1024;
const MAX_CONTENT_BYTES_PER_FILE = 16 * 1024;
const MAX_CONTENT_BYTES_TOTAL = 64 * 1024;

export interface RunnerProjectInstruction {
  path: string;
  scopePath: string;
  projectRoot: string;
  hash: string;
  content: string;
  sourceBytes: number;
  contentBytes: number;
  truncated: boolean;
  provenance: 'workspace';
}

export interface RunnerProjectInstructionOmission {
  path: string;
  reason: 'source_too_large' | 'invalid_utf8' | 'total_budget' | 'too_many_files';
}

export interface RunnerProjectInstructionProjection {
  targetDirectories: string[];
  instructions: RunnerProjectInstruction[];
  omitted: RunnerProjectInstructionOmission[];
}

const normalizeLogicalDirectory = (value: string): string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0') || value.length > 4096) {
    throw new Error('WORKSPACE_PATH_INVALID');
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== WORK_LOGICAL_ROOT && !normalized.startsWith(WORK_LOGICAL_ROOT + '/')) {
    throw new Error('WORKSPACE_PATH_FORBIDDEN');
  }
  return normalized.replace(/\/$/, '') || WORK_LOGICAL_ROOT;
};

const hostPathFor = (workRoot: string, logical: string): string => {
  const relative = logical === WORK_LOGICAL_ROOT ? '' : logical.slice((WORK_LOGICAL_ROOT + '/').length);
  return path.join(workRoot, ...relative.split('/').filter(Boolean));
};

const assertNoSymlinkPath = (workRoot: string, target: string, allowMissing = true): void => {
  const rootStat = fs.lstatSync(workRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  const relative = path.relative(workRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  let current = workRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      if (allowMissing) continue;
      throw new Error('WORKSPACE_NOT_FOUND');
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  }
};

const logicalAncestors = (directory: string): string[] => {
  const parts = directory.slice(WORK_LOGICAL_ROOT.length).split('/').filter(Boolean);
  const result = [WORK_LOGICAL_ROOT];
  let current = WORK_LOGICAL_ROOT;
  for (const part of parts) {
    current = current + '/' + part;
    result.push(current);
  }
  return result;
};

const markerExists = (workRoot: string, directory: string): boolean => {
  const marker = path.join(hostPathFor(workRoot, directory), '.git');
  if (!fs.existsSync(marker)) return false;
  assertNoSymlinkPath(workRoot, marker, false);
  const stat = fs.lstatSync(marker);
  if (stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  return stat.isDirectory() || stat.isFile();
};

const projectRootFor = (workRoot: string, targetDirectory: string): string => {
  const ancestors = logicalAncestors(targetDirectory);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const candidate = ancestors[index]!;
    if (markerExists(workRoot, candidate)) return candidate;
  }
  return WORK_LOGICAL_ROOT;
};

const utf8Prefix = (value: string, maxBytes: number): string => {
  if (maxBytes <= 0) return '';
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

const readInstruction = (
  workRoot: string,
  logicalDirectory: string,
  projectRoot: string,
  remainingBytes: number,
): RunnerProjectInstruction | RunnerProjectInstructionOmission | null => {
  const logicalPath = logicalDirectory + '/AGENTS.md';
  const file = path.join(hostPathFor(workRoot, logicalDirectory), 'AGENTS.md');
  if (!fs.existsSync(file)) return null;
  assertNoSymlinkPath(workRoot, file, false);
  const handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_SOURCE_FILE_BYTES) return { path: logicalPath, reason: 'source_too_large' };
    const raw = fs.readFileSync(handle);
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      return { path: logicalPath, reason: 'invalid_utf8' };
    }
    if (remainingBytes <= 0) return { path: logicalPath, reason: 'total_budget' };
    const contentBudget = Math.min(MAX_CONTENT_BYTES_PER_FILE, remainingBytes);
    const content = utf8Prefix(decoded, contentBudget);
    const contentBytes = Buffer.byteLength(content, 'utf8');
    return {
      path: logicalPath,
      scopePath: logicalDirectory,
      projectRoot,
      hash: createHash('sha256').update(raw).digest('hex'),
      content,
      sourceBytes: stat.size,
      contentBytes,
      truncated: contentBytes < stat.size,
      provenance: 'workspace',
    };
  } finally {
    fs.closeSync(handle);
  }
};

const depth = (logical: string): number => logical.split('/').filter(Boolean).length;

export const resolveProjectInstructions = (
  workRoot: string,
  targetDirectories: readonly string[],
): RunnerProjectInstructionProjection => {
  if (!path.isAbsolute(workRoot) || workRoot.includes('\0')) throw new Error('WORKSPACE_PATH_INVALID');
  const resolvedRoot = path.resolve(workRoot);
  if (!fs.existsSync(resolvedRoot)) throw new Error('WORKSPACE_NOT_FOUND');
  assertNoSymlinkPath(resolvedRoot, resolvedRoot, false);

  const requestedTargets = targetDirectories.length ? targetDirectories : [WORK_LOGICAL_ROOT];
  const normalizedTargets = [...new Set(requestedTargets.map(normalizeLogicalDirectory))];
  if (normalizedTargets.length > MAX_TARGET_DIRECTORIES) throw new Error('VALIDATION_FAILED');

  const instructionScopes = new Map<string, string>();
  for (const target of normalizedTargets) {
    const targetHost = hostPathFor(resolvedRoot, target);
    assertNoSymlinkPath(resolvedRoot, targetHost, true);
    const projectRoot = projectRootFor(resolvedRoot, target);
    const chain = logicalAncestors(target);
    const start = chain.indexOf(projectRoot);
    for (const directory of chain.slice(Math.max(0, start))) {
      if (!instructionScopes.has(directory)) instructionScopes.set(directory, projectRoot);
    }
  }

  const orderedScopes = [...instructionScopes.entries()].sort(
    ([left], [right]) => depth(left) - depth(right) || left.localeCompare(right),
  );
  const instructions: RunnerProjectInstruction[] = [];
  const omitted: RunnerProjectInstructionOmission[] = [];
  const recordOmission = (item: RunnerProjectInstructionOmission): void => {
    if (omitted.length < MAX_OMISSION_DETAILS) omitted.push(item);
  };
  let remainingBytes = MAX_CONTENT_BYTES_TOTAL;
  for (const [directory, projectRoot] of orderedScopes) {
    if (instructions.length >= MAX_INSTRUCTION_FILES) {
      const candidate = directory + '/AGENTS.md';
      if (fs.existsSync(path.join(hostPathFor(resolvedRoot, directory), 'AGENTS.md'))) {
        recordOmission({ path: candidate, reason: 'too_many_files' });
      }
      continue;
    }
    const item = readInstruction(resolvedRoot, directory, projectRoot, remainingBytes);
    if (!item) continue;
    if ('reason' in item) {
      recordOmission(item);
      continue;
    }
    instructions.push(item);
    remainingBytes = Math.max(0, remainingBytes - item.contentBytes);
  }

  return {
    targetDirectories: normalizedTargets,
    instructions,
    omitted,
  };
};

export const PROJECT_INSTRUCTION_LIMITS = {
  logicalRoot: WORK_LOGICAL_ROOT,
  maxTargetDirectories: MAX_TARGET_DIRECTORIES,
  maxInstructionFiles: MAX_INSTRUCTION_FILES,
  maxOmissionDetails: MAX_OMISSION_DETAILS,
  maxSourceFileBytes: MAX_SOURCE_FILE_BYTES,
  maxContentBytesPerFile: MAX_CONTENT_BYTES_PER_FILE,
  maxContentBytesTotal: MAX_CONTENT_BYTES_TOTAL,
} as const;

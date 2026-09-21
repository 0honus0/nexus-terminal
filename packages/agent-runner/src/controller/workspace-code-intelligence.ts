import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { API, Project, Snapshot } from 'typescript/unstable/sync';
import type { Node, SourceFile } from 'typescript/unstable/ast';

const WORK_LOGICAL_ROOT = '/workspace/work';
const MAX_INDEX_FILES = 512;
const MAX_WATCHED_CONFIGS = 32;
const MAX_INDEX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_REPO_MAP_FILES = 64;
const MAX_REPO_MAP_SYMBOLS = 160;
const MAX_CODE_INTEL_RESULTS = 100;
const MAX_REPO_MAP_OUTPUT_BYTES = 16 * 1024;
const MAX_CODE_INTEL_OUTPUT_BYTES = 64 * 1024;
const CACHE_LIMIT = 8;

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/i;
const CONFIG_NAMES = new Set(['tsconfig.json', 'jsconfig.json']);
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

export interface RunnerWorkspaceRepoMapRequest {
  path: string;
  query?: string;
  maxFiles: number;
  maxSymbols: number;
  maxOutputBytes: number;
}

export interface RunnerWorkspaceRepoMapSymbol {
  name: string;
  kind: string;
  line: number;
  column: number;
  signature: string;
}

export interface RunnerWorkspaceRepoMapFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  imports: string[];
  symbols: RunnerWorkspaceRepoMapSymbol[];
}

export interface RunnerWorkspaceRepoMapResult {
  engine: 'typescript-native';
  path: string;
  query: string | null;
  revision: string;
  indexedFiles: number;
  indexedBytes: number;
  cacheHits: number;
  cacheMisses: number;
  files: RunnerWorkspaceRepoMapFile[];
  truncated: boolean;
  fallback: {
    searchTool: 'file_search';
    readTool: 'file_read';
    unsupportedLanguages: true;
  };
}

export type RunnerWorkspaceCodeIntelAction = 'symbols' | 'definition' | 'references' | 'diagnostics';

export interface RunnerWorkspaceCodeIntelRequest {
  action: RunnerWorkspaceCodeIntelAction;
  path: string;
  line?: number;
  column?: number;
  maxResults: number;
  maxOutputBytes: number;
}

export interface RunnerWorkspaceCodeIntelLocation {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  name?: string;
  kind?: string;
  signature?: string;
}

export interface RunnerWorkspaceCodeIntelDiagnostic {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  code: number;
  category: string;
  text: string;
}

export interface RunnerWorkspaceCodeIntelResult {
  action: RunnerWorkspaceCodeIntelAction;
  path: string;
  engine: 'typescript-native' | 'fallback';
  supported: boolean;
  revision: string | null;
  sha256: string | null;
  results: Array<RunnerWorkspaceRepoMapSymbol | RunnerWorkspaceCodeIntelLocation | RunnerWorkspaceCodeIntelDiagnostic>;
  truncated: boolean;
  fallback: null | {
    reason: 'LANGUAGE_UNSUPPORTED' | 'FILE_NOT_INDEXED';
    searchTool: 'file_search';
    readTool: 'file_read';
  };
}

interface IndexedFile {
  logical: string;
  hostPath: string;
  sha256: string;
  sizeBytes: number;
  content: string;
}

interface ScanResult {
  files: Map<string, IndexedFile>;
  configs: Map<string, string>;
  revision: string;
  indexedBytes: number;
  truncated: boolean;
}

interface CacheEntry {
  key: string;
  root: string;
  api: API;
  snapshot: Snapshot;
  files: Map<string, IndexedFile>;
  configs: Map<string, string>;
  revision: string;
  indexedBytes: number;
  scanTruncated: boolean;
  cacheHits: number;
  cacheMisses: number;
  touchedAt: number;
}

let syncApiPromise: Promise<typeof import('typescript/unstable/sync')> | null = null;
let astPromise: Promise<typeof import('typescript/unstable/ast')> | null = null;

const nativeSync = () => (syncApiPromise ??= import('typescript/unstable/sync'));
const nativeAst = () => (astPromise ??= import('typescript/unstable/ast'));

const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');

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

const assertRoot = (workRoot: string): string => {
  if (!path.isAbsolute(workRoot) || workRoot.includes('\0')) throw new Error('WORKSPACE_PATH_INVALID');
  const root = path.resolve(workRoot);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  return root;
};

const hostPathFor = (root: string, logical: string): string => {
  const relative = logical === WORK_LOGICAL_ROOT ? '' : logical.slice((WORK_LOGICAL_ROOT + '/').length);
  return path.join(root, ...relative.split('/').filter(Boolean));
};

const logicalFromHost = (root: string, hostPath: string): string => {
  const relative = path.relative(root, hostPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  return relative ? `${WORK_LOGICAL_ROOT}/${relative.split(path.sep).join('/')}` : WORK_LOGICAL_ROOT;
};

const assertNoSymlink = (root: string, target: string): void => {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) throw new Error('WORKSPACE_NOT_FOUND');
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
  }
};

const decodeUtf8 = (raw: Buffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new Error('WORKSPACE_FILE_NOT_TEXT');
  }
};

const validateRequestBounds = (value: number, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('VALIDATION_FAILED');
  return value;
};

const scanWorkspace = (workRoot: string): ScanResult => {
  const root = assertRoot(workRoot);
  const files = new Map<string, IndexedFile>();
  const configs = new Map<string, string>();
  const stack = [root];
  let indexedBytes = 0;
  let truncated = false;

  while (stack.length && files.size < MAX_INDEX_FILES) {
    const directory = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(candidate);
        continue;
      }
      if (!entry.isFile()) continue;
      if (CONFIG_NAMES.has(entry.name) && configs.size < MAX_WATCHED_CONFIGS) {
        const stat = fs.lstatSync(candidate);
        if (stat.size <= 512 * 1024) {
          const raw = fs.readFileSync(candidate);
          configs.set(candidate, sha256(raw));
        }
        continue;
      }
      if (!SOURCE_EXTENSION.test(entry.name)) continue;
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INDEX_FILE_BYTES) continue;
      if (indexedBytes + stat.size > MAX_INDEX_BYTES) {
        truncated = true;
        continue;
      }
      const raw = fs.readFileSync(candidate);
      const content = decodeUtf8(raw);
      const logical = logicalFromHost(root, candidate);
      files.set(candidate, {
        logical,
        hostPath: candidate,
        sha256: sha256(raw),
        sizeBytes: raw.byteLength,
        content,
      });
      indexedBytes += raw.byteLength;
      if (files.size >= MAX_INDEX_FILES) {
        truncated = true;
        break;
      }
    }
  }
  if (stack.length) truncated = true;
  const revision = sha256(
    JSON.stringify([
      ...[...files.values()]
        .map((file) => [file.logical, file.sha256] as const)
        .sort((left, right) => left[0].localeCompare(right[0])),
      ...[...configs.entries()]
        .map(([file, digest]) => [`config:${logicalFromHost(root, file)}`, digest] as const)
        .sort((left, right) => left[0].localeCompare(right[0])),
    ]),
  );
  return { files, configs, revision, indexedBytes, truncated };
};

const diffKeys = (before: Map<string, unknown>, after: Map<string, unknown>) => ({
  created: [...after.keys()].filter((key) => !before.has(key)),
  deleted: [...before.keys()].filter((key) => !after.has(key)),
  retained: [...after.keys()].filter((key) => before.has(key)),
});

const positionFor = (sourceFile: SourceFile, line: number, column: number): number => {
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
    throw new Error('VALIDATION_FAILED');
  }
  try {
    return sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);
  } catch {
    throw new Error('VALIDATION_FAILED');
  }
};

const locationForNode = (
  root: string,
  node: Node,
  extra?: Pick<RunnerWorkspaceCodeIntelLocation, 'name' | 'kind' | 'signature'>,
): RunnerWorkspaceCodeIntelLocation | null => {
  const sourceFile = node.getSourceFile();
  const hostPath = path.resolve(sourceFile.fileName);
  const relative = path.relative(root, hostPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    path: logicalFromHost(root, hostPath),
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
    ...extra,
  };
};

const normalizedSignature = (value: string): string => utf8Prefix(value.replace(/\s+/g, ' ').trim(), 320);

const sourceImports = (sourceFile: SourceFile): string[] =>
  sourceFile.imports
    .map((node) => node.getText(sourceFile))
    .map((value) => utf8Prefix(value, 256))
    .slice(0, 32);

const namedNode = (node: Node): { name?: Node } => node as Node & { name?: Node };

const collectSymbols = async (
  project: Project,
  sourceFile: SourceFile,
  maxSymbols: number,
): Promise<RunnerWorkspaceRepoMapSymbol[]> => {
  const ast = await nativeAst();
  const results: RunnerWorkspaceRepoMapSymbol[] = [];
  const add = (node: Node, kind: string): void => {
    if (results.length >= maxSymbols) return;
    const candidate = namedNode(node).name;
    if (!candidate) return;
    const rawName = candidate.getText(sourceFile);
    if (!rawName) return;
    const start = sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile));
    results.push({
      name: utf8Prefix(rawName, 160),
      kind,
      line: start.line + 1,
      column: start.character + 1,
      signature: normalizedSignature(project.emitter.printNode(node)),
    });
  };

  const visitMember = (node: Node): void => {
    if (
      node.kind === ast.SyntaxKind.MethodDeclaration ||
      node.kind === ast.SyntaxKind.MethodSignature ||
      node.kind === ast.SyntaxKind.PropertyDeclaration ||
      node.kind === ast.SyntaxKind.PropertySignature ||
      node.kind === ast.SyntaxKind.GetAccessor ||
      node.kind === ast.SyntaxKind.SetAccessor
    ) {
      add(node, ast.formatSyntaxKind(node.kind));
    }
  };

  for (const statement of sourceFile.statements) {
    if (results.length >= maxSymbols) break;
    if (
      ast.isFunctionDeclaration(statement) ||
      ast.isClassDeclaration(statement) ||
      ast.isInterfaceDeclaration(statement) ||
      ast.isTypeAliasDeclaration(statement) ||
      ast.isEnumDeclaration(statement) ||
      ast.isModuleDeclaration(statement)
    ) {
      add(statement, ast.formatSyntaxKind(statement.kind));
      if (ast.isClassDeclaration(statement) || ast.isInterfaceDeclaration(statement)) {
        for (const member of statement.members) {
          if (results.length >= maxSymbols) break;
          visitMember(member);
        }
      }
      continue;
    }
    if (ast.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (results.length >= maxSymbols) break;
        add(declaration, 'VariableDeclaration');
      }
    }
  }
  return results;
};

const queryTerms = (query: string | undefined): string[] =>
  (query ?? '')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_$./-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 16);

const relevance = (file: RunnerWorkspaceRepoMapFile, terms: string[]): number => {
  if (!terms.length) return 0;
  const pathText = file.path.toLocaleLowerCase();
  const importText = file.imports.join(' ').toLocaleLowerCase();
  const symbolText = file.symbols
    .map((symbol) => `${symbol.name} ${symbol.signature}`)
    .join(' ')
    .toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (pathText.includes(term)) score += 8;
    if (symbolText.includes(term)) score += 5;
    if (importText.includes(term)) score += 2;
  }
  return score;
};

const boundedJsonArray = <T>(values: T[], maxOutputBytes: number): { values: T[]; truncated: boolean } => {
  const output: T[] = [];
  let bytes = 2;
  let truncated = false;
  for (const value of values) {
    const candidateBytes = Buffer.byteLength(JSON.stringify(value), 'utf8') + 1;
    if (bytes + candidateBytes > maxOutputBytes) {
      truncated = true;
      break;
    }
    output.push(value);
    bytes += candidateBytes;
  }
  return { values: output, truncated: truncated || output.length < values.length };
};

export class WorkspaceCodeIntelligence {
  private readonly caches = new Map<string, CacheEntry>();

  async repoMap(
    cacheKey: string,
    workRoot: string,
    request: RunnerWorkspaceRepoMapRequest,
  ): Promise<RunnerWorkspaceRepoMapResult> {
    validateRequestBounds(request.maxFiles, 1, MAX_REPO_MAP_FILES);
    validateRequestBounds(request.maxSymbols, 1, MAX_REPO_MAP_SYMBOLS);
    validateRequestBounds(request.maxOutputBytes, 1024, MAX_REPO_MAP_OUTPUT_BYTES);
    if (
      request.query !== undefined &&
      (typeof request.query !== 'string' || Buffer.byteLength(request.query, 'utf8') > 1024)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const root = assertRoot(workRoot);
    const logicalScope = normalizeLogicalPath(request.path);
    const scopeHost = hostPathFor(root, logicalScope);
    assertNoSymlink(root, scopeHost);
    const scopeStat = fs.lstatSync(scopeHost);
    if (!scopeStat.isDirectory() && !scopeStat.isFile()) throw new Error('WORKSPACE_PATH_INVALID');

    const entry = await this.refresh(cacheKey, root);
    const terms = queryTerms(request.query);
    const candidates: Array<{ file: RunnerWorkspaceRepoMapFile; score: number }> = [];
    let symbolBudget = request.maxSymbols;

    for (const indexed of [...entry.files.values()].sort((left, right) => left.logical.localeCompare(right.logical))) {
      const relative = path.relative(scopeHost, indexed.hostPath);
      const inside = indexed.hostPath === scopeHost || (!relative.startsWith('..') && !path.isAbsolute(relative));
      if (!inside) continue;
      const project = entry.snapshot.getDefaultProjectForFile(indexed.hostPath);
      if (!project) continue;
      const sourceFile = project.program.getSourceFile(indexed.hostPath);
      if (!sourceFile) continue;
      const symbols = symbolBudget > 0 ? await collectSymbols(project, sourceFile, symbolBudget) : [];
      symbolBudget = Math.max(0, symbolBudget - symbols.length);
      const file: RunnerWorkspaceRepoMapFile = {
        path: indexed.logical,
        sha256: indexed.sha256,
        sizeBytes: indexed.sizeBytes,
        imports: sourceImports(sourceFile),
        symbols,
      };
      candidates.push({ file, score: relevance(file, terms) });
      if (symbolBudget <= 0 && candidates.length >= request.maxFiles) break;
    }

    candidates.sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path));
    const selected = candidates.slice(0, request.maxFiles).map((candidate) => candidate.file);
    const bounded = boundedJsonArray(selected, request.maxOutputBytes);
    return {
      engine: 'typescript-native',
      path: logicalScope,
      query: request.query?.trim() || null,
      revision: entry.revision,
      indexedFiles: entry.files.size,
      indexedBytes: entry.indexedBytes,
      cacheHits: entry.cacheHits,
      cacheMisses: entry.cacheMisses,
      files: bounded.values,
      truncated: entry.scanTruncated || candidates.length > request.maxFiles || bounded.truncated,
      fallback: {
        searchTool: 'file_search',
        readTool: 'file_read',
        unsupportedLanguages: true,
      },
    };
  }

  async codeIntel(
    cacheKey: string,
    workRoot: string,
    request: RunnerWorkspaceCodeIntelRequest,
  ): Promise<RunnerWorkspaceCodeIntelResult> {
    if (!['symbols', 'definition', 'references', 'diagnostics'].includes(request.action)) {
      throw new Error('VALIDATION_FAILED');
    }
    validateRequestBounds(request.maxResults, 1, MAX_CODE_INTEL_RESULTS);
    validateRequestBounds(request.maxOutputBytes, 1024, MAX_CODE_INTEL_OUTPUT_BYTES);
    const root = assertRoot(workRoot);
    const logical = normalizeLogicalPath(request.path);
    const hostPath = hostPathFor(root, logical);
    assertNoSymlink(root, hostPath);
    const stat = fs.lstatSync(hostPath);
    if (!stat.isFile()) throw new Error('WORKSPACE_FILE_INVALID');

    if (!SOURCE_EXTENSION.test(hostPath)) {
      return {
        action: request.action,
        path: logical,
        engine: 'fallback',
        supported: false,
        revision: null,
        sha256: sha256(fs.readFileSync(hostPath)),
        results: [],
        truncated: false,
        fallback: {
          reason: 'LANGUAGE_UNSUPPORTED',
          searchTool: 'file_search',
          readTool: 'file_read',
        },
      };
    }

    const entry = await this.refresh(cacheKey, root);
    const indexed = entry.files.get(hostPath);
    if (!indexed) {
      return {
        action: request.action,
        path: logical,
        engine: 'fallback',
        supported: false,
        revision: entry.revision,
        sha256: stat.size <= MAX_INDEX_FILE_BYTES ? sha256(fs.readFileSync(hostPath)) : null,
        results: [],
        truncated: entry.files.size >= MAX_INDEX_FILES,
        fallback: {
          reason: 'FILE_NOT_INDEXED',
          searchTool: 'file_search',
          readTool: 'file_read',
        },
      };
    }

    const project = entry.snapshot.getDefaultProjectForFile(hostPath);
    const sourceFile = project?.program.getSourceFile(hostPath);
    if (!project || !sourceFile) {
      return {
        action: request.action,
        path: logical,
        engine: 'fallback',
        supported: false,
        revision: entry.revision,
        sha256: indexed.sha256,
        results: [],
        truncated: false,
        fallback: {
          reason: 'FILE_NOT_INDEXED',
          searchTool: 'file_search',
          readTool: 'file_read',
        },
      };
    }

    let results: Array<
      RunnerWorkspaceRepoMapSymbol | RunnerWorkspaceCodeIntelLocation | RunnerWorkspaceCodeIntelDiagnostic
    > = [];
    if (request.action === 'symbols') {
      results = await collectSymbols(project, sourceFile, request.maxResults);
    } else if (request.action === 'diagnostics') {
      const sync = await nativeSync();
      const diagnostics = [
        ...project.program.getSyntacticDiagnostics(hostPath),
        ...project.program.getSemanticDiagnostics(hostPath),
        ...project.program.getSuggestionDiagnostics(hostPath),
      ];
      results = diagnostics.slice(0, request.maxResults).map((diagnostic) => {
        const diagnosticFile =
          diagnostic.fileName && project.program.getSourceFile(diagnostic.fileName)
            ? project.program.getSourceFile(diagnostic.fileName)!
            : sourceFile;
        const start = diagnosticFile.getLineAndCharacterOfPosition(Math.max(0, diagnostic.pos));
        const end = diagnosticFile.getLineAndCharacterOfPosition(Math.max(diagnostic.pos, diagnostic.end));
        return {
          path: logicalFromHost(root, diagnosticFile.fileName),
          line: start.line + 1,
          column: start.character + 1,
          endLine: end.line + 1,
          endColumn: end.character + 1,
          code: diagnostic.code,
          category: String(sync.DiagnosticCategory[diagnostic.category] ?? diagnostic.category),
          text: utf8Prefix(diagnostic.text, 1024),
        } satisfies RunnerWorkspaceCodeIntelDiagnostic;
      });
    } else {
      const line = request.line;
      const column = request.column;
      if (line === undefined || column === undefined) throw new Error('VALIDATION_FAILED');
      const position = positionFor(sourceFile, line, column);
      const sync = await nativeSync();
      const queriedSymbol = project.checker.getSymbolAtPosition(hostPath, position);
      if (queriedSymbol) {
        if (request.action === 'definition') {
          let definitionSymbol = queriedSymbol;
          if ((definitionSymbol.flags & sync.SymbolFlags.Alias) !== 0) {
            const aliased = project.checker.getAliasedSymbol(definitionSymbol);
            if (!project.checker.isUnknownSymbol(aliased)) definitionSymbol = aliased;
          }
          const ast = await nativeAst();
          results = (definitionSymbol.declarations ?? [])
            .map((handle) => handle.resolve(project))
            .filter((node): node is Node => node !== undefined)
            .map((node) =>
              locationForNode(root, node, {
                name: String(definitionSymbol.name),
                kind: ast.formatSyntaxKind(node.kind),
                signature: normalizedSignature(project.emitter.printNode(node)),
              }),
            )
            .filter((value): value is RunnerWorkspaceCodeIntelLocation => value !== null)
            .slice(0, request.maxResults);
        } else {
          const ast = await nativeAst();
          const token = ast.getTokenAtPosition(sourceFile, position);
          const refs: RunnerWorkspaceCodeIntelLocation[] = [];
          const seen = new Set<string>();
          for (const referenced of project.checker.getReferencedSymbolsForNode(token, position)) {
            const handles = [referenced.definition, ...referenced.references];
            for (const handle of handles) {
              const node = handle.resolve(project);
              if (!node) continue;
              const location = locationForNode(root, node, {
                ...(referenced.symbol ? { name: String(referenced.symbol.name) } : {}),
              });
              if (!location) continue;
              const key = `${location.path}:${location.line}:${location.column}:${location.endLine}:${location.endColumn}`;
              if (seen.has(key)) continue;
              seen.add(key);
              refs.push(location);
              if (refs.length >= request.maxResults) break;
            }
            if (refs.length >= request.maxResults) break;
          }
          results = refs;
        }
      }
    }

    const bounded = boundedJsonArray(results, request.maxOutputBytes);
    return {
      action: request.action,
      path: logical,
      engine: 'typescript-native',
      supported: true,
      revision: entry.revision,
      sha256: indexed.sha256,
      results: bounded.values,
      truncated: bounded.truncated || results.length > request.maxResults,
      fallback: null,
    };
  }

  dispose(cacheKey?: string): void {
    if (cacheKey !== undefined) {
      const entry = this.caches.get(cacheKey);
      if (!entry) return;
      entry.snapshot.dispose();
      entry.api.close();
      this.caches.delete(cacheKey);
      return;
    }
    for (const entry of this.caches.values()) {
      entry.snapshot.dispose();
      entry.api.close();
    }
    this.caches.clear();
  }

  private async refresh(cacheKey: string, root: string): Promise<CacheEntry> {
    const scanned = scanWorkspace(root);
    const current = this.caches.get(cacheKey);
    if (current && current.root === root && current.revision === scanned.revision) {
      current.cacheHits += 1;
      current.touchedAt = Date.now();
      return current;
    }

    const sync = await nativeSync();
    if (!current || current.root !== root) {
      if (current) this.dispose(cacheKey);
      const api = new sync.API({ cwd: root });
      const snapshot = api.updateSnapshot({ openFiles: [...scanned.files.keys()] });
      const created: CacheEntry = {
        key: cacheKey,
        root,
        api,
        snapshot,
        files: scanned.files,
        configs: scanned.configs,
        revision: scanned.revision,
        indexedBytes: scanned.indexedBytes,
        scanTruncated: scanned.truncated,
        cacheHits: 0,
        cacheMisses: 1,
        touchedAt: Date.now(),
      };
      this.caches.set(cacheKey, created);
      this.trimCache();
      return created;
    }

    const fileDiff = diffKeys(current.files, scanned.files);
    const configDiff = diffKeys(current.configs, scanned.configs);
    const changed = [
      ...fileDiff.retained.filter((file) => current.files.get(file)!.sha256 !== scanned.files.get(file)!.sha256),
      ...configDiff.retained.filter((file) => current.configs.get(file) !== scanned.configs.get(file)),
    ];
    const next = current.api.updateSnapshot({
      openFiles: fileDiff.created,
      closeFiles: fileDiff.deleted,
      fileChanges: {
        created: [...fileDiff.created, ...configDiff.created],
        deleted: [...fileDiff.deleted, ...configDiff.deleted],
        changed,
      },
    });
    current.snapshot.dispose();
    current.snapshot = next;
    current.files = scanned.files;
    current.configs = scanned.configs;
    current.revision = scanned.revision;
    current.indexedBytes = scanned.indexedBytes;
    current.scanTruncated = scanned.truncated;
    current.cacheMisses += 1;
    current.touchedAt = Date.now();
    return current;
  }

  private trimCache(): void {
    if (this.caches.size <= CACHE_LIMIT) return;
    const oldest = [...this.caches.values()].sort((left, right) => left.touchedAt - right.touchedAt)[0];
    if (oldest) this.dispose(oldest.key);
  }
}

export const WORKSPACE_CODE_INTELLIGENCE_LIMITS = {
  logicalRoot: WORK_LOGICAL_ROOT,
  maxIndexFiles: MAX_INDEX_FILES,
  maxIndexFileBytes: MAX_INDEX_FILE_BYTES,
  maxIndexBytes: MAX_INDEX_BYTES,
  maxRepoMapFiles: MAX_REPO_MAP_FILES,
  maxRepoMapSymbols: MAX_REPO_MAP_SYMBOLS,
  maxRepoMapOutputBytes: MAX_REPO_MAP_OUTPUT_BYTES,
  maxCodeIntelResults: MAX_CODE_INTEL_RESULTS,
  maxCodeIntelOutputBytes: MAX_CODE_INTEL_OUTPUT_BYTES,
} as const;

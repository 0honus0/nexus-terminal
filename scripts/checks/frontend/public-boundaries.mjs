import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.resolve(root, 'packages/frontend/src');
const extensions = new Set(['.ts', '.tsx', '.vue']);
const foundationPublicModules = new Set(['ui', 'browser', 'interaction', 'async']);

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (extensions.has(path.extname(entry.name))) files.push(child);
  }
  return files;
};

const moduleOwner = (absolutePath) => {
  const relative = path.relative(sourceRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [kind, name] = relative.split(path.sep);
  if (
    !name ||
    (kind !== 'features' &&
      kind !== 'runtimes' &&
      kind !== 'shared' &&
      !(kind === 'foundation' && foundationPublicModules.has(name)))
  )
    return null;
  return { kind, name };
};

const resolveSourceImport = (sourceFile, specifier) => {
  let base;
  if (specifier.startsWith('@/')) base = path.join(sourceRoot, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(sourceFile), specifier);
  else return null;

  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.vue`, path.join(base, 'index.ts')];
  return candidates;
};

const exists = async (candidate) => {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
};

const importPattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
const publicTypeReexportPattern = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs;
const publicTypeStarReexportPattern = /export\s+(?:type\s+)?\*\s+from\s*['"]([^'"]+)['"]/g;
const exportedTypeDeclarationPattern = /^export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const MAX_SFC_LINES = 3000;
const MAX_SFC_SCRIPT_LINES = 2000;
const MAX_INLINE_STYLE_LINES = 400;
const findings = [];
const featureCouplingFindings = [];
const internalBoundaryFindings = [];
const sfcSizeFindings = [];
const workspaceTransportFindings = [];
const files = await walk(sourceRoot);

for (const sourceFile of files) {
  const text = await readFile(sourceFile, 'utf8');
  if (path.extname(sourceFile) === '.vue') {
    const totalLines = text.split('\n').length;
    const scriptLines = text.match(/<script[^>]*>([\s\S]*?)<\/script>/u)?.[1]?.split('\n').length ?? 0;
    const inlineStyleLines = [...text.matchAll(/<style(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/style>/gu)].reduce(
      (largest, style) => Math.max(largest, style[1]?.split('\n').length ?? 0),
      0,
    );
    if (totalLines > MAX_SFC_LINES)
      sfcSizeFindings.push({
        file: path.relative(root, sourceFile),
        section: 'file',
        lines: totalLines,
        limit: MAX_SFC_LINES,
      });
    if (scriptLines > MAX_SFC_SCRIPT_LINES)
      sfcSizeFindings.push({
        file: path.relative(root, sourceFile),
        section: 'script',
        lines: scriptLines,
        limit: MAX_SFC_SCRIPT_LINES,
      });
    if (inlineStyleLines > MAX_INLINE_STYLE_LINES)
      sfcSizeFindings.push({
        file: path.relative(root, sourceFile),
        section: 'inline style',
        lines: inlineStyleLines,
        limit: MAX_INLINE_STYLE_LINES,
      });
  }
  const sourceOwner = moduleOwner(sourceFile);
  importPattern.lastIndex = 0;
  let match;
  while ((match = importPattern.exec(text))) {
    const specifier = match[1];
    if (
      sourceOwner?.kind === 'runtimes' &&
      sourceOwner.name === 'workspace' &&
      specifier === '@/client/http' &&
      !path.relative(sourceRoot, sourceFile).split(path.sep).includes('adapters')
    ) {
      workspaceTransportFindings.push({
        file: path.relative(root, sourceFile),
        line: text.slice(0, match.index).split('\n').length,
      });
    }
    const candidates = resolveSourceImport(sourceFile, specifier);
    if (!candidates) continue;

    let targetFile = null;
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        targetFile = candidate;
        break;
      }
    }
    if (!targetFile) continue;

    const targetOwner = moduleOwner(targetFile);
    if (!targetOwner) continue;
    if (sourceOwner?.name === targetOwner.name && ['agent', 'workspace'].includes(sourceOwner.name)) {
      const sourceRelative = path.relative(path.join(sourceRoot, sourceOwner.kind, sourceOwner.name), sourceFile);
      const targetRelative = path.relative(path.join(sourceRoot, targetOwner.kind, targetOwner.name), targetFile);
      const sourceArea = sourceRelative.split(path.sep)[0];
      const targetArea = targetRelative.split(path.sep)[0];
      const forbidden =
        sourceOwner.name === 'agent'
          ? {
              api: new Set(['ai', 'files', 'host', 'plugin-sdk', 'runtime', 'settings']),
              common: new Set(['ai', 'api', 'files', 'host', 'plugin-sdk', 'runtime', 'settings']),
              events: new Set(['ai', 'api', 'files', 'host', 'plugin-sdk', 'runtime', 'settings']),
              runtime: new Set(['ai', 'files', 'host', 'plugin-sdk', 'settings']),
              settings: new Set(['ai', 'files', 'host', 'plugin-sdk', 'runtime']),
            }[sourceArea]
          : {
              adapters: new Set(['components', 'session', 'state', 'views']),
              focus: new Set(['adapters', 'components', 'session', 'state', 'views']),
              layout: new Set(['adapters', 'components', 'session', 'state', 'views']),
              model: new Set(['adapters', 'components', 'session', 'state', 'views']),
              ports: new Set(['adapters', 'components', 'focus', 'layout', 'session', 'state', 'views']),
              protocol: new Set(['adapters', 'components', 'session', 'state', 'views']),
              session: new Set(['components', 'focus', 'layout', 'state', 'views']),
              components: new Set(['views']),
            }[sourceArea];
      if (forbidden?.has(targetArea)) {
        internalBoundaryFindings.push({
          file: path.relative(root, sourceFile),
          line: text.slice(0, match.index).split('\n').length,
          owner: sourceOwner.name,
          sourceArea,
          targetArea,
        });
      }
    }
    if (sourceOwner?.kind === 'features' && targetOwner.kind === 'features' && sourceOwner.name !== targetOwner.name) {
      featureCouplingFindings.push({
        file: path.relative(root, sourceFile),
        line: text.slice(0, match.index).split('\n').length,
        sourceFeature: sourceOwner.name,
        targetFeature: targetOwner.name,
      });
    }
    if (sourceOwner && sourceOwner.kind === targetOwner.kind && sourceOwner.name === targetOwner.name) {
      continue;
    }

    const expectedPublicEntry = path.join(
      sourceRoot,
      targetOwner.kind,
      targetOwner.name,
      targetOwner.kind === 'foundation' ? 'index.ts' : 'public.ts',
    );
    if (path.resolve(targetFile) === expectedPublicEntry) continue;

    const line = text.slice(0, match.index).split('\n').length;
    findings.push({
      file: path.relative(root, sourceFile),
      line,
      specifier,
      target: path.relative(root, targetFile),
      expected: path.relative(root, expectedPublicEntry),
    });
  }
}

const resolvePublicContractSource = async (publicFile, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(publicFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
};

const isPublicContractSource = (publicFile, sourceFile) => {
  if (path.extname(sourceFile) !== '.ts') return false;
  const relative = path.relative(path.dirname(publicFile), sourceFile);
  const parts = relative.split(path.sep);
  return relative === 'public-types.ts' || (parts.length === 2 && parts[0] === 'contracts');
};

const publicContractFindings = [];
const publicFiles = files.filter((file) => path.basename(file) === 'public.ts');

for (const publicFile of publicFiles) {
  const text = await readFile(publicFile, 'utf8');
  const typeExportsBySource = new Map();
  const starTypeExports = new Set();

  publicTypeStarReexportPattern.lastIndex = 0;
  let starMatch;
  while ((starMatch = publicTypeStarReexportPattern.exec(text))) {
    const source = await resolvePublicContractSource(publicFile, starMatch[1]);
    if (source) starTypeExports.add(source);
  }

  publicTypeReexportPattern.lastIndex = 0;
  let exportMatch;
  while ((exportMatch = publicTypeReexportPattern.exec(text))) {
    const source = await resolvePublicContractSource(publicFile, exportMatch[2]);
    if (!source) continue;
    const names = typeExportsBySource.get(source) ?? new Set();
    for (const item of exportMatch[1].split(',')) {
      const sourceName = item
        .trim()
        .replace(/^type\s+/u, '')
        .split(/\s+as\s+/u)[0]
        ?.trim();
      if (sourceName) names.add(sourceName);
    }
    typeExportsBySource.set(source, names);
  }

  for (const contractSource of files.filter((file) => isPublicContractSource(publicFile, file))) {
    if (starTypeExports.has(contractSource)) continue;
    const publicNames = typeExportsBySource.get(contractSource) ?? new Set();
    const contractText = await readFile(contractSource, 'utf8');
    exportedTypeDeclarationPattern.lastIndex = 0;
    let declarationMatch;
    while ((declarationMatch = exportedTypeDeclarationPattern.exec(contractText))) {
      const typeName = declarationMatch[1];
      if (publicNames.has(typeName)) continue;
      publicContractFindings.push({
        publicFile: path.relative(root, publicFile),
        contractSource: path.relative(root, contractSource),
        typeName,
      });
    }
  }
}

if (
  findings.length ||
  featureCouplingFindings.length ||
  internalBoundaryFindings.length ||
  sfcSizeFindings.length ||
  publicContractFindings.length ||
  workspaceTransportFindings.length
) {
  console.error('Frontend public API boundary guard failed:');
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} imports ${finding.target} via "${finding.specifier}". Cross-module imports must use ${finding.expected}.`,
    );
  }
  for (const finding of featureCouplingFindings) {
    console.error(
      `- ${finding.file}:${finding.line} couples feature "${finding.sourceFeature}" to feature "${finding.targetFeature}". Compose cross-feature capabilities in the application layer.`,
    );
  }
  for (const finding of internalBoundaryFindings) {
    console.error(
      `- ${finding.file}:${finding.line} reverses the ${finding.owner} subsystem boundary (${finding.sourceArea} -> ${finding.targetArea}). Move orchestration toward the host/view composition layer.`,
    );
  }
  for (const finding of sfcSizeFindings) {
    console.error(
      `- ${finding.file} has ${finding.lines} ${finding.section} lines (limit ${finding.limit}). Extract controller, state, or presentation code.`,
    );
  }
  for (const finding of publicContractFindings) {
    console.error(
      `- ${finding.publicFile} exposes types from ${finding.contractSource} but omits exported type ${finding.typeName}. Public contract source files must be re-exported completely.`,
    );
  }
  for (const finding of workspaceTransportFindings) {
    console.error(
      `- ${finding.file}:${finding.line} imports the HTTP client directly. Workspace transport access belongs in an adapter.`,
    );
  }
  process.exit(1);
}

console.log(
  `Frontend public API boundary guard passed (${files.length} frontend source files and ${publicFiles.length} public entrypoints inspected).`,
);

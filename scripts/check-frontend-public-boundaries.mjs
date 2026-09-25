import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.resolve(root, 'packages/frontend/src');
const extensions = new Set(['.ts', '.tsx', '.vue']);

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
  if (!name || (kind !== 'features' && kind !== 'runtimes')) return null;
  return { kind, name };
};

const resolveSourceImport = (sourceFile, specifier) => {
  let base;
  if (specifier.startsWith('@/')) base = path.join(sourceRoot, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(sourceFile), specifier);
  else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.vue`,
    path.join(base, 'index.ts'),
  ];
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
const publicTypeReexportPattern = /export\s+type\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs;
const publicTypeStarReexportPattern = /export\s+type\s+\*\s+from\s*['"]([^'"]+)['"]/g;
const exportedTypeDeclarationPattern =
  /^export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const findings = [];
const files = await walk(sourceRoot);

for (const sourceFile of files) {
  const text = await readFile(sourceFile, 'utf8');
  const sourceOwner = moduleOwner(sourceFile);
  importPattern.lastIndex = 0;
  let match;
  while ((match = importPattern.exec(text))) {
    const specifier = match[1];
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
    if (
      sourceOwner &&
      sourceOwner.kind === targetOwner.kind &&
      sourceOwner.name === targetOwner.name
    ) {
      continue;
    }

    const expectedPublicEntry = path.join(
      sourceRoot,
      targetOwner.kind,
      targetOwner.name,
      'public.ts',
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
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
};

const publicContractFindings = [];
const publicFiles = files.filter((file) => path.basename(file) === 'public.ts');

for (const publicFile of publicFiles) {
  const text = await readFile(publicFile, 'utf8');
  const typeExportsBySpecifier = new Map();
  const starTypeExports = new Set();

  publicTypeStarReexportPattern.lastIndex = 0;
  let starMatch;
  while ((starMatch = publicTypeStarReexportPattern.exec(text))) {
    starTypeExports.add(starMatch[1]);
  }

  publicTypeReexportPattern.lastIndex = 0;
  let exportMatch;
  while ((exportMatch = publicTypeReexportPattern.exec(text))) {
    const specifier = exportMatch[2];
    const names = typeExportsBySpecifier.get(specifier) ?? new Set();
    for (const item of exportMatch[1].split(',')) {
      const sourceName = item.trim().split(/\s+as\s+/u)[0]?.trim();
      if (sourceName) names.add(sourceName);
    }
    typeExportsBySpecifier.set(specifier, names);
  }

  for (const [specifier, publicNames] of typeExportsBySpecifier) {
    if (starTypeExports.has(specifier)) continue;
    const contractSource = await resolvePublicContractSource(publicFile, specifier);
    if (!contractSource) continue;

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

if (findings.length || publicContractFindings.length) {
  console.error('Frontend public API boundary guard failed:');
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} imports ${finding.target} via "${finding.specifier}". Cross-feature/runtime imports must use ${finding.expected}.`,
    );
  }
  for (const finding of publicContractFindings) {
    console.error(
      `- ${finding.publicFile} exposes types from ${finding.contractSource} but omits exported type ${finding.typeName}. Public contract source files must be re-exported completely.`,
    );
  }
  process.exit(1);
}

console.log(
  `Frontend public API boundary guard passed (${files.length} frontend source files and ${publicFiles.length} public entrypoints inspected).`,
);

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const extensions = new Set(['.ts', '.tsx', '.vue']);

const walk = async (relative) => {
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (extensions.has(path.extname(entry.name))) files.push(child);
  }
  return files;
};

const frontendFiles = await walk('packages/frontend/src');

const scopedFiles = [
  ...(await walk('packages/frontend/src/features')).filter((file) => file.split(path.sep).includes('api')),
  ...(await walk('packages/backend/src/interfaces/http')),
  ...(await walk('packages/backend/src/interfaces/websocket')),
];

const agentWsFiles = (await walk('packages/backend/src/interfaces/websocket')).filter((file) =>
  path.basename(file).startsWith('agent'),
);

const findings = [];

const declarationPattern = /^(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_]*Dto)\b/gm;
const dtoAliasPattern =
  /(?:^export\s+type\s+[A-Za-z0-9_]+\s*=\s*[A-Za-z0-9_]+Dto\s*;|\b[A-Za-z0-9_]+Dto\s+as\s+[A-Za-z0-9_]+\b)/gm;
const wsProtocolDeclarationPattern =
  /^(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_]*(?:Wire|Inbound|Outbound)[A-Za-z0-9_]*|[A-Za-z0-9_]+(?:Message|Request|Response|Envelope))\b/gm;

const inspect = async (file, patterns) => {
  const text = await readFile(path.join(root, file), 'utf8');
  for (const [rule, pattern] of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ file, line, rule, match: match[0].trim() });
    }
  }
};

for (const file of scopedFiles) {
  await inspect(file, [
    [
      'network adapters must import canonical *Dto types from packages/protocol instead of declaring local DTOs',
      declarationPattern,
    ],
    ['compatibility aliases that rename canonical *Dto types are forbidden in network adapters', dtoAliasPattern],
  ]);
}

for (const file of frontendFiles) {
  await inspect(file, [
    ['frontend code must use canonical *Dto names directly instead of DTO compatibility aliases', dtoAliasPattern],
  ]);
}

for (const file of agentWsFiles) {
  await inspect(file, [
    [
      'Agent WebSocket protocol message/request/response declarations belong in packages/protocol',
      wsProtocolDeclarationPattern,
    ],
  ]);
}

if (findings.length) {
  console.error('Transport contract architecture guard failed:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.match}`);
  }
  process.exit(1);
}

console.log(
  `Transport contract architecture guard passed (${scopedFiles.length} network adapter files, ${frontendFiles.length} frontend files, ${agentWsFiles.length} Agent WS files).`,
);

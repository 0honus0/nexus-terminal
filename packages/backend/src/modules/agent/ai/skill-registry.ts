import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Scope } from '../agent.types';
import { AGENT_CAPABILITIES, type AgentCapability } from '../host/app.types';
import type { PluginSkillSourcePort } from '../host/plugin-skill-source.port';

const MAX_SKILL_BODY_BYTES = 12 * 1024;
const OPERATIONS_APP_ID = 'nexus.operations';

export interface SkillMetadata {
  id: string;
  version: string;
  hash: string;
  description: string;
  requiredCapabilities: AgentCapability[];
  trust: 'builtin' | 'signed-plugin';
}

export interface SkillBody extends SkillMetadata {
  body: string;
}

interface IndexedSkill extends SkillMetadata {
  source: string;
  bodyOffset: number;
  content?: string;
}

const allowedCapabilities = new Set<string>(AGENT_CAPABILITIES);

const parseSkill = (
  content: string,
  source: string,
  trust: SkillMetadata['trust'],
  expectedHash?: string,
): IndexedSkill => {
  if (!content.startsWith('---\n')) throw new Error(`Invalid Skill frontmatter: ${source}`);
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`Invalid Skill frontmatter: ${source}`);
  const header = content.slice(4, end);
  const fields = new Map<string, string>();
  for (const line of header.split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const id = fields.get('id') ?? '';
  const version = fields.get('version') ?? '';
  const description = fields.get('description') ?? '';
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version) || !description) {
    throw new Error(`Invalid Skill metadata: ${source}`);
  }
  const requiredCapabilities = (fields.get('requiredCapabilities') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (requiredCapabilities.some((capability) => !allowedCapabilities.has(capability))) {
    throw new Error(`Invalid Skill capability: ${source}`);
  }
  const bodyOffset = end + '\n---\n'.length;
  const body = content.slice(bodyOffset);
  if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BODY_BYTES) throw new Error(`Skill body too large: ${source}`);
  const hash = createHash('sha256').update(content, 'utf8').digest('hex');
  if (expectedHash && hash !== expectedHash) throw new Error('PLUGIN_SKILL_CHANGED');
  return {
    id,
    version,
    description,
    requiredCapabilities: requiredCapabilities as AgentCapability[],
    trust,
    hash,
    source,
    bodyOffset,
    ...(trust === 'signed-plugin' ? { content } : {}),
  };
};

export class SkillRegistry {
  private indexPromise: Promise<Map<string, IndexedSkill>> | null = null;

  constructor(
    private readonly pluginSkills?: PluginSkillSourcePort,
    private readonly root = path.resolve(__dirname, '../apps/operations/skills'),
  ) {}

  async search(scope: Scope, query: string): Promise<SkillMetadata[]> {
    const needle = query.trim().toLowerCase();
    const index = scope.appId === OPERATIONS_APP_ID ? await this.index() : await this.pluginIndex(scope);
    return [...index.values()]
      .filter((skill) => !needle || `${skill.id} ${skill.description}`.toLowerCase().includes(needle))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ source: _source, bodyOffset: _bodyOffset, content: _content, ...metadata }) => metadata);
  }

  async load(scope: Scope, id: string, version: string): Promise<SkillBody> {
    const index = scope.appId === OPERATIONS_APP_ID ? await this.index() : await this.pluginIndex(scope);
    const skill = index.get(id);
    if (!skill || skill.version !== version) throw new Error('NOT_FOUND');
    const content = skill.content ?? (await fs.readFile(skill.source, 'utf8'));
    const actualHash = createHash('sha256').update(content, 'utf8').digest('hex');
    if (actualHash !== skill.hash) {
      if (skill.trust === 'builtin') this.indexPromise = null;
      throw new Error(skill.trust === 'builtin' ? 'SKILL_CHANGED' : 'PLUGIN_SKILL_CHANGED');
    }
    const body = content.slice(skill.bodyOffset);
    if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BODY_BYTES) throw new Error('SKILL_BODY_TOO_LARGE');
    const { source: _source, bodyOffset: _bodyOffset, content: _content, ...metadata } = skill;
    return { ...metadata, body };
  }

  private index(): Promise<Map<string, IndexedSkill>> {
    this.indexPromise ??= this.buildIndex();
    return this.indexPromise;
  }

  private async pluginIndex(scope: Scope): Promise<Map<string, IndexedSkill>> {
    const index = new Map<string, IndexedSkill>();
    const bundle = await this.pluginSkills?.load(scope);
    if (!bundle) return index;
    const declared = new Set(bundle.capabilities);
    for (const document of bundle.documents) {
      const skill = parseSkill(document.content, document.path, 'signed-plugin', document.sha256);
      if (skill.requiredCapabilities.some((capability) => !declared.has(capability))) {
        throw new Error('PLUGIN_SKILL_CAPABILITY_UNDECLARED');
      }
      if (index.has(skill.id)) throw new Error(`Duplicate signed Skill id: ${skill.id}`);
      index.set(skill.id, skill);
    }
    return index;
  }

  private async buildIndex(): Promise<Map<string, IndexedSkill>> {
    const rootReal = await fs.realpath(this.root);
    const entries = await fs.readdir(rootReal, { withFileTypes: true });
    const index = new Map<string, IndexedSkill>();
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const skillDirectory = path.join(rootReal, entry.name);
      const skillFile = path.join(skillDirectory, 'SKILL.md');
      let stat;
      try {
        stat = await fs.lstat(skillFile);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const realFile = await fs.realpath(skillFile);
      if (!realFile.startsWith(`${rootReal}${path.sep}`)) throw new Error('SKILL_PATH_ESCAPE');
      const content = await fs.readFile(realFile, 'utf8');
      const skill = parseSkill(content, realFile, 'builtin');
      if (index.has(skill.id)) throw new Error(`Duplicate builtin Skill id: ${skill.id}`);
      index.set(skill.id, skill);
    }
    return index;
  }
}

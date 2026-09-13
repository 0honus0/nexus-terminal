import { createHash } from 'node:crypto';
import type { Scope } from '../agent.types';
import { AGENT_CAPABILITIES, type AgentCapability } from '../host/app.types';
import type { PluginSkillSourcePort } from '../host/plugin-skill-source.port';

const MAX_SKILL_BODY_BYTES = 12 * 1024;
const MAX_SKILL_NAME_BYTES = 128;
const MAX_SKILL_DESCRIPTION_BYTES = 1024;

export interface SkillMetadata {
  id: string;
  name: string;
  version: string;
  hash: string;
  description: string;
  requiredCapabilities: AgentCapability[];
  trust: 'signed-plugin';
}

export interface SkillBody extends SkillMetadata {
  body: string;
}

interface IndexedSkill extends SkillMetadata {
  source: string;
  bodyOffset: number;
  content: string;
}

const allowedCapabilities = new Set<string>(AGENT_CAPABILITIES);

const parseSkill = (content: string, source: string, expectedHash: string): IndexedSkill => {
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
  const name = fields.get('name') ?? '';
  const version = fields.get('version') ?? '';
  const description = fields.get('description') ?? '';
  if (
    !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(id) ||
    !name ||
    Buffer.byteLength(name, 'utf8') > MAX_SKILL_NAME_BYTES ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !description ||
    Buffer.byteLength(description, 'utf8') > MAX_SKILL_DESCRIPTION_BYTES
  ) {
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
  if (hash !== expectedHash) throw new Error('PLUGIN_SKILL_CHANGED');
  return {
    id,
    name,
    version,
    description,
    requiredCapabilities: requiredCapabilities as AgentCapability[],
    trust: 'signed-plugin',
    hash,
    source,
    bodyOffset,
    content,
  };
};

export class SkillRegistry {
  constructor(private readonly pluginSkills?: PluginSkillSourcePort) {}

  async list(scope: Scope): Promise<SkillMetadata[]> {
    const index = await this.pluginIndex(scope);
    return [...index.values()]
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(({ source: _source, bodyOffset: _bodyOffset, content: _content, ...metadata }) => metadata);
  }

  async load(scope: Scope, id: string, version: string): Promise<SkillBody> {
    const index = await this.pluginIndex(scope);
    const skill = index.get(id);
    if (!skill || skill.version !== version) throw new Error('NOT_FOUND');
    const actualHash = createHash('sha256').update(skill.content, 'utf8').digest('hex');
    if (actualHash !== skill.hash) throw new Error('PLUGIN_SKILL_CHANGED');
    const body = skill.content.slice(skill.bodyOffset);
    if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BODY_BYTES) throw new Error('SKILL_BODY_TOO_LARGE');
    const { source: _source, bodyOffset: _bodyOffset, content: _content, ...metadata } = skill;
    return { ...metadata, body };
  }

  private async pluginIndex(scope: Scope): Promise<Map<string, IndexedSkill>> {
    const index = new Map<string, IndexedSkill>();
    const bundle = await this.pluginSkills?.load(scope);
    if (!bundle) return index;
    const declared = new Set(bundle.capabilities);
    for (const document of bundle.documents) {
      const skill = parseSkill(document.content, document.path, document.sha256);
      if (skill.requiredCapabilities.some((capability) => !declared.has(capability))) {
        throw new Error('PLUGIN_SKILL_CAPABILITY_UNDECLARED');
      }
      if (index.has(skill.id)) throw new Error(`Duplicate signed Skill id: ${skill.id}`);
      index.set(skill.id, skill);
    }
    return index;
  }
}

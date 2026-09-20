import { createHash } from 'node:crypto';
import { lexicalIndexTokens, lexicalQueryTerms, normalizeLexicalSource } from '../../../platform/search/lexical-search';
import type { Scope } from '../agent.types';
import type { PluginSkillBundle, PluginSkillSourcePort } from '../host/plugin-skill-source.port';

const MAX_SKILL_BODY_BYTES = 12 * 1024;
const MAX_SKILL_NAME_BYTES = 128;
const MAX_SKILL_DESCRIPTION_BYTES = 1024;
const MAX_STANDARD_SKILL_NAME_LENGTH = 64;
const MAX_FRONTMATTER_FIELDS = 32;
const MAX_FRONTMATTER_METADATA_FIELDS = 64;
const MAX_FRONTMATTER_VALUE_BYTES = 4 * 1024;

export const DIRECT_SKILL_METADATA_LIMIT = 8;
export const CONTEXT_SKILL_MATCH_LIMIT = 6;
export const MAX_SKILL_SEARCH_RESULTS = 8;

export interface SkillMetadata {
  id: string;
  name: string;
  version: string;
  hash: string;
  description: string;
  trust: 'signed-plugin';
}

export interface SkillBody extends SkillMetadata {
  body: string;
}

export interface SkillDisclosure {
  mode: 'direct' | 'search';
  total: number;
  metadata: SkillMetadata[];
}

interface IndexedSkill extends SkillMetadata {
  source: string;
  bodyOffset: number;
  content: string;
}

interface SkillIndex {
  byId: Map<string, IndexedSkill>;
  postings: Map<string, Set<string>>;
}

interface ParsedFrontmatter {
  fields: Map<string, string>;
  metadata: Map<string, string>;
}

const STANDARD_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;

const parseScalar = (raw: string, source: string): string => {
  const value = raw.trim();
  if (Buffer.byteLength(value, 'utf8') > MAX_FRONTMATTER_VALUE_BYTES) {
    throw new Error(`Invalid Skill frontmatter: ${source}`);
  }
  if (value.startsWith('"') || value.endsWith('"')) {
    if (!(value.startsWith('"') && value.endsWith('"'))) throw new Error(`Invalid Skill frontmatter: ${source}`);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== 'string') throw new Error('invalid');
      return parsed;
    } catch {
      throw new Error(`Invalid Skill frontmatter: ${source}`);
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'"))) throw new Error(`Invalid Skill frontmatter: ${source}`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
};

const blockScalar = (
  lines: readonly string[],
  start: number,
  marker: string,
  source: string,
): { value: string; next: number } => {
  const collected: string[] = [];
  let next = start;
  while (next < lines.length) {
    const line = lines[next]!;
    if (!line.trim()) {
      collected.push('');
      next += 1;
      continue;
    }
    const indentation = /^\s+/.exec(line)?.[0].length ?? 0;
    if (indentation === 0) break;
    collected.push(line);
    next += 1;
  }
  const nonEmpty = collected.filter((line) => line.trim());
  const indentation = nonEmpty.length
    ? Math.min(...nonEmpty.map((line) => /^\s+/.exec(line)?.[0].length ?? 0))
    : 0;
  const normalized = collected.map((line) => (line ? line.slice(Math.min(indentation, line.length)) : ''));
  const folded = marker.startsWith('>')
    ? normalized
        .join('\n')
        .replace(/([^\n])\n(?=[^\n])/g, '$1 ')
        .replace(/\n{3,}/g, '\n\n')
    : normalized.join('\n');
  const value = marker.endsWith('-') ? folded.replace(/\n+$/g, '') : folded;
  if (Buffer.byteLength(value, 'utf8') > MAX_FRONTMATTER_VALUE_BYTES) {
    throw new Error(`Invalid Skill frontmatter: ${source}`);
  }
  return { value, next };
};

const parseFrontmatter = (header: string, source: string): ParsedFrontmatter => {
  const fields = new Map<string, string>();
  const metadata = new Map<string, string>();
  const lines = header.split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim() || line.trimStart().startsWith('#')) {
      index += 1;
      continue;
    }
    if (/^\s/.test(line)) throw new Error(`Invalid Skill frontmatter: ${source}`);
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!match) throw new Error(`Invalid Skill frontmatter: ${source}`);
    const key = match[1]!;
    const rawValue = match[2] ?? '';
    if (fields.has(key) || (key === 'metadata' && metadata.size > 0)) {
      throw new Error(`Invalid Skill frontmatter: ${source}`);
    }
    if (fields.size >= MAX_FRONTMATTER_FIELDS) throw new Error(`Invalid Skill frontmatter: ${source}`);

    if (key === 'metadata' && rawValue.trim() === '') {
      index += 1;
      while (index < lines.length) {
        const metadataLine = lines[index]!;
        if (!metadataLine.trim()) {
          index += 1;
          continue;
        }
        if (!/^\s/.test(metadataLine)) break;
        const item = /^\s+([A-Za-z0-9_.-]+):(?:\s*(.*))?$/.exec(metadataLine);
        if (!item || metadata.size >= MAX_FRONTMATTER_METADATA_FIELDS) {
          throw new Error(`Invalid Skill frontmatter: ${source}`);
        }
        const metadataKey = item[1]!;
        if (metadata.has(metadataKey)) throw new Error(`Invalid Skill frontmatter: ${source}`);
        metadata.set(metadataKey, parseScalar(item[2] ?? '', source));
        index += 1;
      }
      fields.set(key, '');
      continue;
    }

    if (/^[>|][+-]?$/.test(rawValue.trim())) {
      const block = blockScalar(lines, index + 1, rawValue.trim(), source);
      fields.set(key, block.value);
      index = block.next;
      continue;
    }

    fields.set(key, parseScalar(rawValue, source));
    index += 1;
  }
  return { fields, metadata };
};

const metadataFrom = (skill: IndexedSkill): SkillMetadata => {
  const { source: _source, bodyOffset: _bodyOffset, content: _content, ...metadata } = skill;
  return metadata;
};

const standardSkillId = (appId: string, name: string): string => {
  const id = `${appId}.${name}`;
  if (!SKILL_ID.test(id)) throw new Error('PLUGIN_SKILL_ID_INVALID');
  return id;
};

const parseSkill = (
  content: string,
  source: string,
  expectedHash: string,
  bundle: Pick<PluginSkillBundle, 'appId' | 'version'>,
): IndexedSkill => {
  if (!content.startsWith('---\n')) throw new Error(`Invalid Skill frontmatter: ${source}`);
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`Invalid Skill frontmatter: ${source}`);
  const { fields } = parseFrontmatter(content.slice(4, end), source);
  const allowedFields = new Set([
    'name',
    'description',
    'license',
    'compatibility',
    'metadata',
    'allowed-tools',
  ]);
  if ([...fields.keys()].some((key) => !allowedFields.has(key))) {
    throw new Error(`Invalid Skill metadata: ${source}`);
  }

  const name = fields.get('name') ?? '';
  const description = fields.get('description') ?? '';
  const pathParts = source.split('/');
  const parentDirectory = pathParts.length >= 2 ? pathParts.at(-2) : null;
  if (
    !name ||
    name.length > MAX_STANDARD_SKILL_NAME_LENGTH ||
    !STANDARD_SKILL_NAME.test(name) ||
    parentDirectory !== name ||
    Buffer.byteLength(name, 'utf8') > MAX_SKILL_NAME_BYTES ||
    !description ||
    Buffer.byteLength(description, 'utf8') > MAX_SKILL_DESCRIPTION_BYTES
  ) {
    throw new Error(`Invalid Skill metadata: ${source}`);
  }

  const id = standardSkillId(bundle.appId, name);
  if (!SKILL_ID.test(id)) throw new Error(`Invalid Skill metadata: ${source}`);
  const bodyOffset = end + '\n---\n'.length;
  const body = content.slice(bodyOffset);
  if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BODY_BYTES) throw new Error(`Skill body too large: ${source}`);
  const hash = createHash('sha256').update(content, 'utf8').digest('hex');
  if (hash !== expectedHash) throw new Error('PLUGIN_SKILL_CHANGED');
  return {
    id,
    name,
    version: bundle.version,
    description,
    trust: 'signed-plugin',
    hash,
    source,
    bodyOffset,
    content,
  };
};

const rankSearch = (index: SkillIndex, query: string, limit: number): SkillMetadata[] => {
  const queryTerms = lexicalQueryTerms(query, 64);
  if (queryTerms.length === 0) return [];
  const queryTokens = [...new Set(queryTerms.flatMap((term) => lexicalIndexTokens(term)))];
  if (queryTokens.length === 0) return [];

  const tokenHits = new Map<string, number>();
  for (const token of queryTokens) {
    for (const id of index.postings.get(token) ?? []) tokenHits.set(id, (tokenHits.get(id) ?? 0) + 1);
  }
  const candidateLimit = Math.min(32, Math.max(12, limit * 4));
  const candidates = [...tokenHits.entries()]
    .sort(([leftId, leftHits], [rightId, rightHits]) => rightHits - leftHits || leftId.localeCompare(rightId))
    .slice(0, candidateLimit)
    .map(([id, hits]) => {
      const skill = index.byId.get(id)!;
      const searchable = normalizeLexicalSource(`${skill.id} ${skill.name} ${skill.description}`);
      const normalizedName = normalizeLexicalSource(skill.name);
      const matchedTerms = queryTerms.reduce((count, term) => count + (searchable.includes(term) ? 1 : 0), 0);
      const exactName = queryTerms.some((term) => normalizedName === term) ? 1 : 0;
      const prefixName = queryTerms.some((term) => normalizedName.startsWith(term)) ? 1 : 0;
      return {
        skill,
        matchedTerms,
        score:
          matchedTerms / Math.max(1, queryTerms.length) * 8 +
          hits / Math.max(1, queryTokens.length) * 2 +
          exactName * 4 +
          prefixName,
      };
    })
    .filter((candidate) => candidate.matchedTerms > 0)
    .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));

  return candidates.slice(0, limit).map(({ skill }) => metadataFrom(skill));
};

export class SkillRegistry {
  constructor(private readonly pluginSkills?: PluginSkillSourcePort) {}

  async list(scope: Scope): Promise<SkillMetadata[]> {
    const index = await this.pluginIndex(scope);
    return [...index.byId.values()]
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(metadataFrom);
  }

  async disclose(scope: Scope, query: string): Promise<SkillDisclosure> {
    const index = await this.pluginIndex(scope);
    const total = index.byId.size;
    if (total <= DIRECT_SKILL_METADATA_LIMIT) {
      return {
        mode: 'direct',
        total,
        metadata: [...index.byId.values()]
          .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
          .map(metadataFrom),
      };
    }
    return {
      mode: 'search',
      total,
      metadata: rankSearch(index, query, CONTEXT_SKILL_MATCH_LIMIT),
    };
  }

  async search(scope: Scope, query: string, limit = MAX_SKILL_SEARCH_RESULTS): Promise<SkillMetadata[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SKILL_SEARCH_RESULTS) {
      throw new Error('VALIDATION_FAILED');
    }
    if (!query.trim() || Buffer.byteLength(query, 'utf8') > 2048) throw new Error('VALIDATION_FAILED');
    return rankSearch(await this.pluginIndex(scope), query, limit);
  }

  async load(scope: Scope, id: string, version: string): Promise<SkillBody> {
    const index = await this.pluginIndex(scope);
    const skill = index.byId.get(id);
    if (!skill || skill.version !== version) throw new Error('NOT_FOUND');
    const actualHash = createHash('sha256').update(skill.content, 'utf8').digest('hex');
    if (actualHash !== skill.hash) throw new Error('PLUGIN_SKILL_CHANGED');
    const body = skill.content.slice(skill.bodyOffset);
    if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BODY_BYTES) throw new Error('SKILL_BODY_TOO_LARGE');
    return { ...metadataFrom(skill), body };
  }

  private async pluginIndex(scope: Scope): Promise<SkillIndex> {
    const byId = new Map<string, IndexedSkill>();
    const postings = new Map<string, Set<string>>();
    const bundle = await this.pluginSkills?.load(scope);
    if (!bundle) return { byId, postings };
    for (const document of bundle.documents) {
      const skill = parseSkill(document.content, document.path, document.sha256, bundle);
      if (byId.has(skill.id)) throw new Error(`Duplicate signed Skill id: ${skill.id}`);
      byId.set(skill.id, skill);
      for (const token of lexicalIndexTokens(`${skill.id} ${skill.name} ${skill.description}`)) {
        let ids = postings.get(token);
        if (!ids) {
          ids = new Set<string>();
          postings.set(token, ids);
        }
        ids.add(skill.id);
      }
    }
    return { byId, postings };
  }
}

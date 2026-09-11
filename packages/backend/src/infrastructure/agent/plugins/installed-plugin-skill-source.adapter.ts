import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { AgentAppManifest } from '../../../modules/agent/host/app.types';
import type { PluginSkillBundle, PluginSkillSourcePort } from '../../../modules/agent/host/plugin-skill-source.port';
import type { Scope } from '../../../modules/agent/agent.types';

const MAX_SKILL_FILES = 64;
const MAX_SKILL_BYTES = 12 * 1024;
const MAX_FILE_LIST_BYTES = 1024 * 1024;

const safeSegment = (value: string): string => {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) throw new Error('PLUGIN_PACKAGE_REF_INVALID');
  return value;
};

const safeRelative = (value: string): string => {
  if (!/^skills\/[A-Za-z0-9_.-]+\/SKILL\.md$/.test(value)) throw new Error('PLUGIN_SKILL_PATH_INVALID');
  return value;
};

export class InstalledPluginSkillSourceAdapter implements PluginSkillSourcePort {
  constructor(
    private readonly db: RelationalDatabase,
    private readonly dataDirectory: string,
  ) {}

  async load(scope: Scope): Promise<PluginSkillBundle | null> {
    const installation = await this.db.queryOne<{ version: string; status: string }>(
      `SELECT version,status FROM agent_plugin_installations WHERE user_id=? AND app_id=?`,
      [scope.userId, scope.appId],
    );
    if (!installation || installation.status !== 'installed') return null;
    const plugin = await this.db.queryOne<{
      package_hash: string;
      manifest_json: string;
      skill_files_json: string;
      status: string;
    }>(
      `SELECT package_hash,manifest_json,skill_files_json,status FROM agent_plugin_versions WHERE app_id=? AND version=?`,
      [scope.appId, installation.version],
    );
    if (!plugin || plugin.status !== 'installed') return null;
    const skillFiles = JSON.parse(plugin.skill_files_json) as unknown;
    if (
      !Array.isArray(skillFiles) ||
      skillFiles.length > MAX_SKILL_FILES ||
      skillFiles.some((item) => typeof item !== 'string')
    ) {
      throw new Error('PLUGIN_SKILL_INDEX_INVALID');
    }
    const manifest = JSON.parse(plugin.manifest_json) as AgentAppManifest;
    const root = path.join(
      this.dataDirectory,
      'agent',
      'plugins',
      safeSegment(scope.appId),
      'versions',
      safeSegment(installation.version),
    );
    const marker = fs.readFileSync(path.join(root, '.nexus-package-hash'), 'utf8').trim();
    if (marker !== plugin.package_hash) throw new Error('PLUGIN_INSTALL_CORRUPT');
    const listPath = path.join(root, 'files.json');
    const listStat = fs.lstatSync(listPath);
    if (!listStat.isFile() || listStat.isSymbolicLink() || listStat.size > MAX_FILE_LIST_BYTES) {
      throw new Error('PLUGIN_FILE_LIST_INVALID');
    }
    const fileList = JSON.parse(fs.readFileSync(listPath, 'utf8')) as { files?: unknown };
    if (!Array.isArray(fileList.files)) throw new Error('PLUGIN_FILE_LIST_INVALID');
    const hashes = new Map<string, string>();
    for (const raw of fileList.files) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.path === 'string' && typeof item.sha256 === 'string') hashes.set(item.path, item.sha256);
    }
    const documents = [];
    for (const rawPath of skillFiles as string[]) {
      const relative = safeRelative(rawPath);
      const expectedHash = hashes.get(relative);
      if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('PLUGIN_SKILL_HASH_MISSING');
      const filePath = path.join(root, ...relative.split('/'));
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_BYTES)
        throw new Error('PLUGIN_SKILL_INVALID');
      const content = fs.readFileSync(filePath, 'utf8');
      const actualHash = createHash('sha256').update(content, 'utf8').digest('hex');
      if (actualHash !== expectedHash) throw new Error('PLUGIN_SKILL_CHANGED');
      documents.push({ path: relative, content, sha256: actualHash });
    }
    return {
      appId: scope.appId,
      version: installation.version,
      packageHash: plugin.package_hash,
      capabilities: [...manifest.capabilities],
      documents,
    };
  }
}

import path from 'node:path';
import type { ProjectDirectoryBinding, ProjectDirectoryPort } from '../../../modules/agent/ai/project-directory.port';
import type { ProjectInstructionSnapshot } from '../../../modules/agent/ai/project-instruction-source.port';
import type { SshFileTargetPort } from '../../../modules/agent/capabilities/ssh-file-target.port';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { Scope } from '../../../modules/agent/agent.types';

/** Conversation-scoped remote project context, never a terminal cwd or execution authority. */
export class AgentProjectDirectories implements ProjectDirectoryPort {
  constructor(
    private readonly database: RelationalDatabase,
    private readonly files: SshFileTargetPort,
    private readonly authorize: (context: ToolContext, connectionId: number) => Promise<boolean>,
  ) {}

  private async check(context: ToolContext, connectionId: number): Promise<void> {
    context.signal.throwIfAborted();
    if (Date.now() >= context.deadlineAt * 1000) throw new Error('TOOL_TIMEOUT');
    if (
      !context.threadId ||
      !context.connectionIds.includes(connectionId) ||
      !(await this.authorize(context, connectionId))
    )
      throw new Error('RESOURCE_FORBIDDEN');
    context.signal.throwIfAborted();
    if (Date.now() >= context.deadlineAt * 1000) throw new Error('TOOL_TIMEOUT');
  }

  async read(context: ToolContext, connectionId: number): Promise<ProjectDirectoryBinding | null> {
    await this.check(context, connectionId);
    const row = await this.database.queryOne<{ directory: string; configuration_hash: string }>(
      'SELECT directory, configuration_hash FROM agent_project_directories WHERE user_id=? AND app_id=? AND thread_id=? AND connection_id=?',
      [context.userId, context.appId, context.threadId!, connectionId],
    );
    return row ? { connectionId, directory: row.directory, configurationHash: row.configuration_hash } : null;
  }

  async bind(context: ToolContext, binding: ProjectDirectoryBinding): Promise<void> {
    await this.check(context, binding.connectionId);
    if (!binding.directory.startsWith('/') || binding.directory.includes('\0') || binding.directory.length > 4096)
      throw new Error('TOOL_ARGUMENTS_INVALID');
    const directory = path.posix.normalize(binding.directory);
    const stat = await this.files.stat(context, binding.connectionId, directory, binding.configurationHash);
    if (!stat.exists || stat.type !== 'directory') throw new Error('RESOURCE_FORBIDDEN');
    await this.check(context, binding.connectionId);
    await this.database.execute(
      'INSERT INTO agent_project_directories (user_id,app_id,thread_id,connection_id,directory,configuration_hash) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,app_id,thread_id,connection_id) DO UPDATE SET directory=excluded.directory,configuration_hash=excluded.configuration_hash',
      [
        context.userId,
        context.appId,
        context.threadId!,
        binding.connectionId,
        stat.resolvedPath,
        binding.configurationHash,
      ],
    );
  }

  async clear(context: ToolContext, connectionId: number): Promise<void> {
    await this.check(context, connectionId);
    await this.database.execute(
      'DELETE FROM agent_project_directories WHERE user_id=? AND app_id=? AND thread_id=? AND connection_id=?',
      [context.userId, context.appId, context.threadId!, connectionId],
    );
  }

  async clearScope(scope: Scope, threadId?: string): Promise<void> {
    await this.database.execute(
      `DELETE FROM agent_project_directories WHERE user_id=? AND app_id=?${threadId ? ' AND thread_id=?' : ''}`,
      threadId ? [scope.userId, scope.appId, threadId] : [scope.userId, scope.appId],
    );
  }

  async instructions(
    context: ToolContext,
    targetDirectories: readonly string[],
  ): Promise<ProjectInstructionSnapshot[]> {
    const result: ProjectInstructionSnapshot[] = [];
    let remaining = 64 * 1024;
    for (const connectionId of context.connectionIds) {
      if (result.length >= 16 || remaining <= 0) break;
      const exists = await this.database.queryOne<{ connection_id: number }>(
        'SELECT connection_id FROM agent_project_directories WHERE user_id=? AND app_id=? AND thread_id=? AND connection_id=?',
        [context.userId, context.appId, context.threadId, connectionId],
      );
      if (!exists) continue;
      const binding = await this.read(context, connectionId);
      if (!binding) continue;
      const scopes = new Set<string>([binding.directory]);
      for (const target of targetDirectories.slice(0, 8)) {
        const prefix = `ssh:${connectionId}:`;
        if (!target.startsWith(prefix)) continue;
        const normalized = path.posix.normalize(target.slice(prefix.length));
        if (!normalized.startsWith(binding.directory + '/')) continue;
        let current = binding.directory;
        for (const segment of normalized.slice(binding.directory.length + 1).split('/')) {
          current = path.posix.join(current, segment);
          scopes.add(current);
        }
      }
      for (const directory of [...scopes].sort(
        (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
      )) {
        if (result.length >= 16 || remaining <= 0) break;
        const stat = await this.files.stat(context, connectionId, directory, binding.configurationHash);
        if (!stat.exists) continue;
        if (stat.type !== 'directory' || stat.resolvedPath !== directory) throw new Error('RESOURCE_FORBIDDEN');
        const listing = await this.files.list(context, connectionId, directory, 500, binding.configurationHash);
        if (listing.truncated) throw new Error('PROJECT_DIRECTORY_TOO_LARGE');
        for (const entry of listing.entries
          .filter((item) => /^agents?\.md$/i.test(item.name))
          .sort((a, b) => a.name.localeCompare(b.name))) {
          if (result.length >= 16 || remaining <= 0) break;
          const filename = path.posix.join(directory, entry.name);
          const source = await this.files.stat(context, connectionId, filename, binding.configurationHash);
          if (
            source.type !== 'file' ||
            source.resolvedPath !== filename ||
            source.sizeBytes === null ||
            source.sizeBytes > 64 * 1024
          )
            continue;
          const read = await this.files.read(
            context,
            connectionId,
            filename,
            0,
            Math.min(16 * 1024, remaining),
            binding.configurationHash,
          );
          const verified = await this.files.stat(context, connectionId, filename, binding.configurationHash);
          if (verified.sha256 !== source.sha256 || verified.resolvedPath !== filename)
            throw new Error('RESOURCE_CHANGED');
          const contentBytes = Buffer.byteLength(read.content);
          result.push({
            path: filename,
            scopePath: directory,
            projectRoot: binding.directory,
            hash: source.sha256!,
            content: read.content,
            sourceBytes: source.sizeBytes,
            contentBytes,
            truncated: contentBytes < source.sizeBytes,
            provenance: 'ssh',
            connectionId,
          });
          remaining -= contentBytes;
        }
      }
    }
    return result;
  }
}

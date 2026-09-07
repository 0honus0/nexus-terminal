import type { SshKeyService } from '../ssh-keys/ssh-key.service';
import type { TagService } from '../tags/tag.service';
import type { ConnectionExportArchivePort } from './connection-export.port';
import type { ConnectionService } from './connection.service';

const escapeArgument = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || String(value).trim() === '') return '""';
  const text = String(value);
  return text.includes(' ') || text.includes('"') ? `"${text.replace(/"/g, '\\"')}"` : text;
};
const safeFileName = (value: string): string => value.replace(/[<>:"/\\|?*]/g, '_');

/** Builds the user-portable connection script without exposing persistence or ZIP details. */
export class ConnectionExportService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly tags: TagService,
    private readonly sshKeys: SshKeyService,
    private readonly archive: ConnectionExportArchivePort,
  ) {}

  async export(includeSshKeys = false): Promise<Uint8Array> {
    const [connections, tags, keys] = await Promise.all([
      this.connections.list(),
      this.tags.list(),
      this.sshKeys.listDecrypted(),
    ]);
    const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
    const keyById = new Map(keys.map((key) => [key.id, key]));
    const lines: string[] = [];
    for (const connection of connections) {
      const stored = await this.connections.getWithCredentials(connection.id);
      if (!stored) continue;
      let line = `${connection.username}@${connection.host}:${connection.port} -type ${connection.type}`;
      if (connection.name && connection.name !== `${connection.username}@${connection.host}`)
        line += ` -name ${escapeArgument(connection.name)}`;
      if (connection.type === 'SSH') {
        if (connection.authMethod === 'password' && stored.credentials.password)
          line += ` -p ${escapeArgument(stored.credentials.password)}`;
        else if (connection.authMethod === 'key' && connection.sshKeyId) {
          const key = keyById.get(connection.sshKeyId);
          if (key) {
            line += ` -k ${escapeArgument(key.name)}`;
            if (key.passphrase) line += ` -passphrase ${escapeArgument(key.passphrase)}`;
          }
        }
      } else if (stored.credentials.password) line += ` -p ${escapeArgument(stored.credentials.password)}`;
      const names = connection.tagIds.map((id) => tagNames.get(id)).filter((name): name is string => Boolean(name));
      if (names.length) line += ` -tags ${names.map(escapeArgument).join(' ')}`;
      if (connection.notes) line += ` -note ${escapeArgument(connection.notes)}`;
      lines.push(line);
    }
    const files = [{ path: 'connections.txt', text: lines.join('\n') }];
    if (includeSshKeys)
      for (const key of keys) files.push({ path: `ssh_keys/${safeFileName(key.name)}.txt`, text: key.privateKey });
    return this.archive.encode(files);
  }
}

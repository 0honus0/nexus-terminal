import type { ExecutionSession } from '../execution/execution-session';
import { isSafeDockerIdentifier } from '../execution/posix-shell';
import type { DockerCommand, DockerContainer, DockerPortInfo, DockerStats, DockerStatus } from './docker.port';
const UNAVAILABLE = ['command not found', 'permission denied', 'Cannot connect to the Docker daemon'];
const unavailable = (stderr: string) => UNAVAILABLE.some((pattern) => stderr.includes(pattern));
const parsePorts = (value: string | undefined | null): DockerPortInfo[] => {
  if (!value) return [];
  const result: DockerPortInfo[] = [];
  for (const entry of value.split(', ')) {
    const pieces = entry.split('->');
    if (pieces.length > 2) continue;
    const publicPart = pieces.length === 2 ? pieces[0]! : '';
    const privatePart = pieces.length === 2 ? pieces[1]! : pieces[0]!;
    const privateMatch = privatePart.match(/^(\d+)\/(tcp|udp|\w+)$/);
    if (!privateMatch) continue;
    const PrivatePort = Number.parseInt(privateMatch[1]!, 10);
    if (!Number.isInteger(PrivatePort)) continue;
    let IP: string | undefined, PublicPort: number | undefined;
    if (publicPart) {
      const match = publicPart.match(/^(?:([\d.:a-fA-F]+):)?(\d+)$/);
      if (match) {
        IP = match[1] || undefined;
        PublicPort = Number.parseInt(match[2]!, 10);
      }
    }
    result.push({
      ...(IP ? { IP } : {}),
      PrivatePort,
      ...(PublicPort !== undefined ? { PublicPort } : {}),
      Type: privateMatch[2]!,
    });
  }
  return result;
};
export class RemoteDockerService {
  async getStatus(session: ExecutionSession): Promise<DockerStatus> {
    if (!session.isReady) return { available: false, containers: [] };
    try {
      const version = await session.execute({
        command: "docker version --format '{{.Server.Version}}'",
        timeoutMs: 10_000,
        maxOutputBytes: 64 * 1024,
      });
      if (unavailable(version.stderr) || !version.stdout.trim()) return { available: false, containers: [] };
    } catch {
      return { available: false, containers: [] };
    }
    let containers: DockerContainer[];
    try {
      const result = await session.execute({
        command: "docker ps -a --no-trunc --format '{{json .}}'",
        timeoutMs: 15_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
      if (unavailable(result.stderr)) return { available: false, containers: [] };
      containers = (result.stdout.trim() ? result.stdout.trim().split('\n') : [])
        .map((line): DockerContainer | null => {
          try {
            const d = JSON.parse(line) as Record<string, unknown>;
            return {
              id: String(d.ID ?? ''),
              Names:
                typeof d.Names === 'string' ? d.Names.split(',') : Array.isArray(d.Names) ? d.Names.map(String) : [],
              Image: String(d.Image ?? ''),
              ImageID: String(d.ImageID ?? ''),
              Command: String(d.Command ?? ''),
              Created: typeof d.CreatedAt === 'string' || typeof d.CreatedAt === 'number' ? d.CreatedAt : 0,
              State: String(d.State ?? 'unknown'),
              Status: String(d.Status ?? ''),
              Ports: parsePorts(typeof d.Ports === 'string' ? d.Ports : null),
              Labels:
                typeof d.Labels === 'string' || (typeof d.Labels === 'object' && d.Labels !== null)
                  ? (d.Labels as Record<string, string> | string)
                  : {},
              stats: null,
            };
          } catch {
            return null;
          }
        })
        .filter((item): item is DockerContainer => item !== null);
    } catch {
      return { available: false, containers: [] };
    }
    const running = containers.filter((c) => c.State === 'running' && isSafeDockerIdentifier(c.id)).map((c) => c.id);
    if (running.length) {
      try {
        const result = await session.execute({
          command: `docker stats ${running.join(' ')} --no-stream --format '{{json .}}'`,
          timeoutMs: 15_000,
          maxOutputBytes: 4 * 1024 * 1024,
        });
        const stats = new Map<string, DockerStats>();
        for (const line of result.stdout.trim() ? result.stdout.trim().split('\n') : []) {
          try {
            const parsed = JSON.parse(line) as DockerStats;
            if (parsed.ID) stats.set(parsed.ID, parsed);
          } catch {}
        }
        for (const c of containers) c.stats = stats.get(c.id) || stats.get(c.id.slice(0, 12)) || null;
      } catch {}
    }
    return { available: true, containers };
  }
  async executeCommand(session: ExecutionSession, containerId: string, command: DockerCommand): Promise<void> {
    if (!session.isReady) throw new Error('SSH connection not active.');
    if (!isSafeDockerIdentifier(containerId)) throw new Error('Invalid container ID format.');
    const action = command === 'remove' ? 'rm -f' : command;
    await session.execute({
      command: `docker ${action} ${containerId}`,
      timeoutMs: command === 'stop' ? 30_000 : 20_000,
      maxOutputBytes: 1024 * 1024,
    });
  }
  async getStats(session: ExecutionSession, containerId: string): Promise<DockerStats> {
    if (!session.isReady) throw new Error('SSH connection not active.');
    if (!isSafeDockerIdentifier(containerId)) throw new Error('Invalid container ID format.');
    const result = await session.execute({
      command: `docker stats ${containerId} --no-stream --format '{{json .}}'`,
      timeoutMs: 15_000,
      maxOutputBytes: 1024 * 1024,
    });
    if (result.stderr.trim()) throw new Error(result.stderr.trim());
    if (!result.stdout.trim()) throw new Error('No stats data received (container might be stopped).');
    try {
      return JSON.parse(result.stdout.trim()) as DockerStats;
    } catch {
      throw new Error('Failed to parse stats data.');
    }
  }
}

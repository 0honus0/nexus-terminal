import type { ExecutionSession } from '../execution/execution-session';
import { executeSshCommand } from '../execution/ssh-command-executor';
import { isSafeDockerIdentifier } from '../execution/posix-shell';
import type { DockerCommand, DockerContainer, DockerPortInfo, DockerStats, DockerStatus } from './docker.types';

const DOCKER_UNAVAILABLE_PATTERNS = [
  'command not found',
  'permission denied',
  'Cannot connect to the Docker daemon',
];

const parsePortsString = (portsString: string | undefined | null): DockerPortInfo[] => {
  if (!portsString) return [];
  const ports: DockerPortInfo[] = [];
  for (const entry of portsString.split(', ')) {
    const parts = entry.split('->');
    const publicPart = parts.length === 2 ? parts[0] : '';
    const privatePart = parts.length === 2 ? parts[1] : parts[0];
    if (parts.length > 2) continue;

    const privateMatch = privatePart.match(/^(\d+)\/(tcp|udp|\w+)$/);
    if (!privateMatch) continue;
    const privatePort = Number.parseInt(privateMatch[1], 10);
    if (!Number.isInteger(privatePort)) continue;

    let ip: string | undefined;
    let publicPort: number | undefined;
    if (publicPart) {
      const publicMatch = publicPart.match(/^(?:([\d.:a-fA-F]+):)?(\d+)$/);
      if (publicMatch) {
        ip = publicMatch[1] || undefined;
        publicPort = Number.parseInt(publicMatch[2], 10);
      }
    }
    ports.push({ IP: ip, PrivatePort: privatePort, PublicPort: publicPort, Type: privateMatch[2] });
  }
  return ports;
};

const isDockerUnavailable = (stderr: string): boolean =>
  DOCKER_UNAVAILABLE_PATTERNS.some((pattern) => stderr.includes(pattern));

/** Reusable Docker operations executed through a remote ExecutionSession. */
export class RemoteDockerService {
  async getStatus(session: ExecutionSession): Promise<DockerStatus> {
    if (!session.isReady) return { available: false, containers: [] };

    try {
      const version = await executeSshCommand(session.client, {
        command: "docker version --format '{{.Server.Version}}'",
        timeoutMs: 10_000,
      });
      if (isDockerUnavailable(version.stderr) || !version.stdout.trim()) {
        return { available: false, containers: [] };
      }
    } catch {
      return { available: false, containers: [] };
    }

    let containers: DockerContainer[];
    try {
      const result = await executeSshCommand(session.client, {
        command: "docker ps -a --no-trunc --format '{{json .}}'",
        timeoutMs: 15_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
      if (isDockerUnavailable(result.stderr)) return { available: false, containers: [] };
      containers = (result.stdout.trim() ? result.stdout.trim().split('\n') : [])
        .map((line): DockerContainer | null => {
          try {
            const data = JSON.parse(line) as Record<string, any>;
            return {
              id: String(data.ID || ''),
              Names: typeof data.Names === 'string' ? data.Names.split(',') : Array.isArray(data.Names) ? data.Names : [],
              Image: String(data.Image || ''),
              ImageID: String(data.ImageID || ''),
              Command: String(data.Command || ''),
              Created: data.CreatedAt || 0,
              State: String(data.State || 'unknown'),
              Status: String(data.Status || ''),
              Ports: parsePortsString(data.Ports),
              Labels: data.Labels || {},
              stats: null,
            };
          } catch {
            return null;
          }
        })
        .filter((container): container is DockerContainer => container !== null);
    } catch {
      return { available: false, containers: [] };
    }

    const runningIds = containers
      .filter((container) => container.State === 'running' && isSafeDockerIdentifier(container.id))
      .map((container) => container.id);
    if (runningIds.length > 0) {
      try {
        const statsResult = await executeSshCommand(session.client, {
          command: `docker stats ${runningIds.join(' ')} --no-stream --format '{{json .}}'`,
          timeoutMs: 15_000,
          maxOutputBytes: 4 * 1024 * 1024,
        });
        const stats = new Map<string, DockerStats>();
        for (const line of statsResult.stdout.trim() ? statsResult.stdout.trim().split('\n') : []) {
          try {
            const parsed = JSON.parse(line) as DockerStats;
            if (parsed.ID) stats.set(parsed.ID, parsed);
          } catch {
            // Ignore one malformed stats line; container metadata remains useful.
          }
        }
        for (const container of containers) {
          container.stats = stats.get(container.id) || stats.get(container.id.slice(0, 12)) || null;
        }
      } catch {
        // Stats are optional; preserve the container list.
      }
    }

    return { available: true, containers };
  }

  async executeCommand(session: ExecutionSession, containerId: string, command: DockerCommand): Promise<void> {
    if (!session.isReady) throw new Error('SSH connection not active.');
    if (!isSafeDockerIdentifier(containerId)) throw new Error('Invalid container ID format.');
    const action = command === 'remove' ? 'rm -f' : command;
    await executeSshCommand(session.client, {
      command: `docker ${action} ${containerId}`,
      timeoutMs: command === 'stop' ? 30_000 : 20_000,
    });
  }

  async getStats(session: ExecutionSession, containerId: string): Promise<DockerStats> {
    if (!session.isReady) throw new Error('SSH connection not active.');
    if (!isSafeDockerIdentifier(containerId)) throw new Error('Invalid container ID format.');
    const result = await executeSshCommand(session.client, {
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

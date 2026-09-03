import WebSocket from 'ws';
import type { AuthenticatedWebSocket } from '../types';
import type { DockerCommand } from '../../../platform/docker/docker.types';
import { remoteDockerService, workspaceSessionRegistry } from '../../../bootstrap/container/application.container';

const resolveExecutionSession = (sessionId: string | undefined) => {
  if (!sessionId) return null;
  const workspace = workspaceSessionRegistry.get(sessionId);
  return workspace?.executionSession.isReady ? workspace.executionSession : null;
};

export async function handleDockerGetStatus(ws: AuthenticatedWebSocket, sessionId: string | undefined): Promise<void> {
  const session = resolveExecutionSession(sessionId);
  if (!session) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: 'SSH connection not active.' } }));
    }
    return;
  }

  try {
    const status = await remoteDockerService.getStatus(session);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'docker:status:update', payload: status }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message } }));
    }
  }
}

export async function handleDockerCommand(
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
  payload: any,
): Promise<void> {
  const session = resolveExecutionSession(sessionId);
  const { containerId, command } = payload || {};
  if (!session) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'docker:command:error',
        payload: { command, containerId, message: 'SSH connection not active.' },
      }));
    }
    return;
  }

  const allowedCommands: DockerCommand[] = ['start', 'stop', 'restart', 'remove'];
  if (typeof containerId !== 'string' || !allowedCommands.includes(command)) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'docker:command:error',
        payload: { command, containerId, message: 'Invalid containerId or command.' },
      }));
    }
    return;
  }

  try {
    await remoteDockerService.executeCommand(session, containerId, command);
    setTimeout(() => {
      const current = sessionId ? workspaceSessionRegistry.get(sessionId) : undefined;
      if (current && current.ws.readyState === current.ws.OPEN) {
        current.ws.send(JSON.stringify({ type: 'request_docker_status_update' }));
      }
    }, 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'docker:command:error',
        payload: { command, containerId, message: `Failed to execute remote command: ${message}` },
      }));
    }
  }
}

export async function handleDockerGetStats(
  ws: AuthenticatedWebSocket,
  sessionId: string | undefined,
  payload: any,
): Promise<void> {
  const session = resolveExecutionSession(sessionId);
  const containerId = payload?.containerId;
  if (!session) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'docker:stats:error',
        payload: { containerId, message: 'SSH connection not active.' },
      }));
    }
    return;
  }
  if (typeof containerId !== 'string') {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'docker:stats:error',
        payload: { containerId, message: 'Missing containerId.' },
      }));
    }
    return;
  }

  try {
    const stats = await remoteDockerService.getStats(session, containerId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'docker:stats:update', payload: { containerId, stats } }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message } }));
    }
  }
}

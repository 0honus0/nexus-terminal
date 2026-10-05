import type { AcpByteTransport } from '../../../modules/agent/ai/integrations.types';
import type { AgentConnectionResolverPort } from '../../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

export class SshAcpTransport {
  constructor(
    private readonly connections: AgentConnectionResolverPort,
    private readonly sessions: ExecutionSessionManager,
  ) {}

  async open(
    context: ToolContext,
    connectionId: number,
    configurationHash: string,
    argv: string[],
    cwd: string,
  ): Promise<AcpByteTransport> {
    context.signal.throwIfAborted();
    const session = await this.sessions.connect({
      ownerType: 'agent',
      ownerId: context.runId,
      connection: await this.connections.resolve(connectionId, configurationHash),
      connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
    });
    try {
      context.signal.throwIfAborted();
      if ((await this.connections.get(connectionId))?.configurationHash !== configurationHash)
        throw new Error('RESOURCE_CHANGED');
      const command = await session.startCommand({
        command: `cd ${quote(cwd)} && exec ${argv.map(quote).join(' ')}`,
        pty: false,
        maxOutputBytes: 256 * 1024,
      });
      const subscriptions: (() => void)[] = [];
      let ended = false;
      const readable = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            subscriptions.push(
              command.onStdout((bytes) => {
                if (ended) return;
                if ((controller.desiredSize ?? 0) <= 0) {
                  ended = true;
                  controller.error(new Error('ACP_SSH_STREAM_OVERFLOW'));
                  void command.terminate();
                  return;
                }
                controller.enqueue(bytes);
              }),
            );
            subscriptions.push(
              command.onError(() => {
                if (!ended) {
                  ended = true;
                  controller.error(new Error('ACP_SSH_CHANNEL_ERROR'));
                }
              }),
            );
            subscriptions.push(
              session.onTransportClose(() => {
                if (!ended) {
                  ended = true;
                  controller.error(new Error('ACP_SSH_DISCONNECTED'));
                }
              }),
            );
            subscriptions.push(
              command.onClose((event) => {
                if (!ended) {
                  ended = true;
                  event.exitCode === 0 ? controller.close() : controller.error(new Error('ACP_SSH_PROCESS_EXIT'));
                }
              }),
            );
          },
        },
        { highWaterMark: 256 * 1024, size: (bytes) => bytes.byteLength },
      );
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> =>
        (closing ??= (async () => {
          context.signal.removeEventListener('abort', abort);
          subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
          await command.terminate().finally(() => this.sessions.close(session.id));
        })());
      const abort = () => void close().catch(() => undefined);
      context.signal.addEventListener('abort', abort, { once: true });
      if (context.signal.aborted) {
        await close();
        context.signal.throwIfAborted();
      }
      return {
        readable,
        writable: new WritableStream({
          write(bytes) {
            if (!command.write(bytes)) throw new Error('ACP_SSH_WRITE_FAILED');
          },
        }),
        close,
      };
    } catch (error) {
      await this.sessions.close(session.id);
      throw error;
    }
  }
}

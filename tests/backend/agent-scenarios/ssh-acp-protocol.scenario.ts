import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { Client, Server } from 'ssh2';
import {
  SshClientRoute,
  ConnectedSshClient,
} from '../../../packages/backend/src/infrastructure/ssh/connection/ssh-client.connector';
import { SshExecutionTransportAdapter } from '../../../packages/backend/src/infrastructure/ssh/execution/ssh-execution-transport.adapter';
import { ExecutionSessionManager } from '../../../packages/backend/src/platform/execution/execution-session-manager';
import { SshAcpTransport } from '../../../packages/backend/src/infrastructure/agent/integrations/ssh-acp-transport';
import { AcpAdapter } from '../../../packages/backend/src/infrastructure/agent/integrations/acp.adapter';
import type { AgentConnectionResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import type { IntegrationView } from '../../../packages/backend/src/modules/agent/ai/integrations.types';

export const sshAcpProtocolScenario = async () => {
  const methods: string[] = [];
  let commandText = '';
  let permissionDecision: unknown;
  let channelClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    channelClosed = resolve;
  });
  const server = new Server(
    {
      hostKeys: [
        generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }),
      ],
    },
    (client) => {
      client.on('error', () => {});
      client.on('authentication', (auth) => auth.accept());
      client.on('ready', () =>
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (_accept, reject) => reject());
          session.on('exec', (accept, _reject, info) => {
            commandText = info.command;
            const stream = accept();
            let buffered = '';
            let promptId: unknown;
            const send = (value: unknown) => stream.write(JSON.stringify(value) + '\n');
            stream.on('close', channelClosed);
            stream.on('error', () => {});
            stream.on('data', (bytes) => {
              buffered += bytes.toString();
              while (buffered.includes('\n')) {
                const end = buffered.indexOf('\n');
                const message = JSON.parse(buffered.slice(0, end));
                buffered = buffered.slice(end + 1);
                if (message.method) methods.push(message.method);
                if (message.method === 'initialize')
                  send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                      protocolVersion: 1,
                      agentCapabilities: {},
                      agentInfo: { name: 'ssh-fixture', version: '1' },
                    },
                  });
                if (message.method === 'session/new')
                  send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'ssh-session' } });
                if (message.method === 'session/prompt') {
                  promptId = message.id;
                  send({
                    jsonrpc: '2.0',
                    id: 'permission',
                    method: 'session/request_permission',
                    params: {
                      sessionId: 'ssh-session',
                      toolCall: { toolCallId: 'inner-write', title: 'Write fixture', kind: 'edit' },
                      options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
                    },
                  });
                }
                if (message.id === 'permission') {
                  permissionDecision = message.result;
                  send({
                    jsonrpc: '2.0',
                    method: 'session/update',
                    params: {
                      sessionId: 'ssh-session',
                      update: {
                        sessionUpdate: 'agent_message_chunk',
                        content: { type: 'text', text: 'SSH protocol complete' },
                      },
                    },
                  });
                  send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
                }
              }
            });
            session.on('signal', () => {
              stream.exit(0);
              stream.end();
            });
          });
        }),
      );
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const manager = new ExecutionSessionManager({
    connect: async () => {
      const client = new Client();
      await new Promise<void>((resolve, reject) => {
        client.once('ready', resolve);
        client.once('error', reject);
        client.connect({
          host: '127.0.0.1',
          port: address.port,
          username: 'fixture',
          password: 'fixture',
          readyTimeout: 5000,
        });
      });
      const route = new SshClientRoute('ACP fixture');
      route.setPrimary(new ConnectedSshClient(client, 'ACP fixture'));
      return new SshExecutionTransportAdapter(1, route);
    },
  });
  const ssh = new SshAcpTransport(
    {
      resolve: async () => ({}),
      get: async () => ({ configurationHash: 'fixture' }),
    } as unknown as AgentConnectionResolverPort,
    manager,
  );
  const abort = new AbortController();
  const context = {
    userId: 1,
    appId: 'fixture',
    runId: 'fixture-run',
    signal: abort.signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 20,
  } as ToolContext;
  const integration = {
    kind: 'acp',
    configuration: {
      displayName: 'fixture',
      transport: 'ssh',
      profileId: 'fixture',
      protocolVersion: '1',
      argv: ['agent', '--acp'],
      cwd: '/srv/project',
    },
  } as IntegrationView;
  try {
    const result = await new AcpAdapter({
      open: async () => {
        throw new Error('Wrong transport');
      },
    }).execute(
      integration,
      { workspaceId: '', generation: 0, cwd: '/srv/project', prompt: 'Inspect fixture', maxOutputBytes: 4096 },
      {
        signal: abort.signal,
        requestPermission: async (request) => {
          assert.equal(request.toolCallId, 'inner-write');
          return 'reject_once';
        },
        openTransport: () => ssh.open(context, 1, 'fixture', ['agent', '--acp'], '/srv/project'),
      },
    );
    assert.equal(result.text, 'SSH protocol complete');
    assert.equal(result.stopReason, 'end_turn');
    assert.deepEqual(methods.slice(0, 3), ['initialize', 'session/new', 'session/prompt']);
    assert.deepEqual(permissionDecision, { outcome: { outcome: 'selected', optionId: 'reject' } });
    assert.equal(commandText, "cd '/srv/project' && exec 'agent' '--acp'");
    await closed;
    return [{ name: 'ssh_acp_real_channel_protocol', value: 1, unit: 'scenarios' }];
  } finally {
    abort.abort();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

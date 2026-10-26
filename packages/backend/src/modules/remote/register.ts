import type { Logger } from '../../platform/logging/logger.js';
import { registerRemoteSnapshot } from './snapshots/adapters/sqlite/snapshot-registration.js';
import type { SnapshotRegistration } from '../../platform/storage/sqlite/snapshot-types.js';
import type { OperationsEvents } from '../operations/public.js';
import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import { SqliteMachineMutationStorage } from './machines/adapters/sqlite/mutation-sql.js';
import { MachineMutationModel } from './machines/model/mutation-model.js';
import { MachineMutationService } from './machines/service/mutation-service.js';
import { MutationRecoveryService } from './machines/service/mutation-recovery-service.js';
import { createMutationHttpRoutes } from './interfaces/http/mutation-http.js';
import { SecureSessionTokens } from '../../platform/security/adapters/secure-session-tokens.js';
import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { MachineAcpModel } from './machines/model/acp-model.js';
import { NdjsonAcpAdapter } from '../../platform/acp/adapters/ndjson-acp.js';
import { MachineCommandModel } from './machines/model/command-model.js';
import { PosixCommandAdapter } from '../../platform/commands/adapters/posix-command.js';
import { RemoteMachineOperationService } from './machines/service/operation-service.js';
import { remoteOperations } from './operation-mapper.js';
import type { RemoteMachineOperations } from './public.js';
import { RemoteResourceCleanupFailure } from './resource-errors.js';
import { PosixServerStatusCollector } from '../../platform/system/adapters/posix-status.js';
import { NativeDockerAdapter } from '../../platform/docker/adapters/native-docker.js';
import { ObservationModel } from './monitoring/model/observation-model.js';
import { RemoteObservationService } from './monitoring/service/observation-service.js';
import { ResourceStatusService } from './monitoring/service/resource-status-service.js';
import { createResourceStatusRoutes } from './interfaces/http/resource-status-http.js';
import { HeadlessTerminalLogRenderer } from '../../platform/terminal/adapters/headless-suspended-log-export.js';
import { remoteBoundary, remoteSyncBoundary, remoteSubscription } from './remote-errors.js';
import type { MachineSshFactory, MachineConnectOptions } from '../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver, HostKeyManagement, TargetsPublicApi } from '../targets/public.js';
import { SessionTokenModel } from './sessions/model/session-token-model.js';
import { RemoteSessionModel } from './sessions/model/session-model.js';
import { RemoteMachineModel } from './machines/model/machine-model.js';
import { ConnectionTestModel } from './machines/model/connection-test-model.js';
import { ConnectionTestService } from './machines/service/connection-test-service.js';
import { createConnectionTestRoutes } from './interfaces/http/connection-test-http.js';
import { RemoteFileModel } from './files/model/file-model.js';
import { RemoteFileService } from './files/service/file-service.js';
import { RemoteSessionService } from './sessions/service/session-service.js';
import type { RemoteSessions, SessionView, OpenShellRequest } from './public.js';
import type { OpenSessionRequest, RemoteSessionSnapshot } from './sessions/model/session-types.js';
import type { AccessPublicApi } from '../access/public.js';
import type { HttpRoute, HttpWebSocketRoute } from '../../platform/http/http-types.js';
import { RemoteSessionOwner } from './sessions/service/session-owner.js';
import { WorkspaceService } from './sessions/service/workspace-service.js';
import { WorkspaceShellModelFactory } from './sessions/model/workspace-shell-model.js';
import { WorkspaceHistoryModel } from './sessions/model/workspace-history-model.js';
import { NativeShellIntegrationFactory } from '../../platform/terminal/adapters/native-shell-integration.js';
import { WorkspaceCommandModel } from './sessions/model/workspace-command-model.js';
import { LocalSuspendedTerminalLog } from '../../platform/terminal/adapters/local-suspended-log.js';
import { HeadlessSuspendedCheckpointFactory } from '../../platform/terminal/adapters/headless-suspended-checkpoint.js';
import {
	WORKSPACE_TERMINAL_MAX_COLUMNS,
	WORKSPACE_TERMINAL_MAX_ROWS,
} from '@nexus-terminal/shared/remote/workspace/values';
import { createRemoteHttpRoutes } from './interfaces/http/remote-http.js';
import { createRemoteWebSocketRoute } from './interfaces/ws/pty-stream.js';
import { createRemoteFileHttpRoutes } from './interfaces/http/file-http.js';
import { createFileDownloadHttpRoutes } from './interfaces/http/file-download-http.js';
import { createWorkspaceFilesRoute } from './interfaces/ws/workspace-files.js';
import { createUploadStreamRoute } from './interfaces/ws/upload-stream.js';
import { createSuspendHttpRoutes } from './interfaces/http/suspend-http.js';
import { createSuspendedCatalogWebSocketRoute } from './interfaces/ws/suspended-catalog-ws.js';
import { BrowserDesktopAdapter } from '../../platform/desktop/adapters/browser-desktop.js';
import { DesktopService } from './desktop/service/desktop-service.js';
import { DesktopModel } from './desktop/model/desktop-model.js';
import { createDesktopHttpRoutes } from './interfaces/http/desktop-http.js';
import { createDesktopWebSocketRoute } from './interfaces/ws/desktop-ws.js';
import { ServerTransferModel } from './transfers/model/server-transfer-model.js';
import { ServerTransferService } from './transfers/service/server-transfer-service.js';
import { NativeServerTransfer } from '../../platform/transfers/adapters/native-transfer.js';
import type { ResourceCollector } from '../../platform/system/resource-diagnostic.js';
import { createServerTransferRoutes } from './interfaces/http/server-transfer-http.js';
import { RemoteToolModel } from './tools/model/tool-model.js';
import { RemoteToolService } from './tools/service/tool-service.js';
import { PosixToolInstaller } from '../../platform/tools/adapters/posix-tool-installer.js';
import { createRemoteToolRoutes } from './interfaces/http/tool-http.js';

interface RemoteRegistrationOptions {
	logger?: Logger;
	events: OperationsEvents;
	sqlite: SqliteRuntime;
	resolver: TrustedSshTargetResolver;
	ssh: MachineSshFactory;
	verifyHostKey: MachineConnectOptions['verifyHostKey'] | null;
	hostKeys: Pick<HostKeyManagement, 'list'>;
	targets: Pick<TargetsPublicApi, 'get' | 'list' | 'desktopTargets' | 'connectionUsage'>;
	statusIntervalSeconds?: number;
	resourceRefreshSeconds?: number;
	access: AccessPublicApi;
	/** Root beside the configured SQLite data file, never process.cwd(). */
	logDirectory?: string;
}

interface RemoteRegistration {
	resourceCollector: ResourceCollector;
	prepareMonitoringConfiguration(statusIntervalSeconds: number, resourceRefreshSeconds: number): () => void;
	publicApi: RemoteSessions;
	operations: RemoteMachineOperations;
	httpRoutes(): HttpRoute[];
	webSocketRoutes(): HttpWebSocketRoute[];
	quiesce(): void;
	initialize(): Promise<void>;
	close(): Promise<void>;
	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void;
}

function toSessionView(view: RemoteSessionSnapshot): SessionView {
	return {
		id: view.id,
		targetId: view.targetId,
		fingerprint: view.fingerprint,
		startedAt: view.startedAt,
		status: view.status,
	};
}

function toOpenSessionRequest(input: OpenShellRequest): OpenSessionRequest {
	const result: OpenSessionRequest = {
		targetId: input.targetId,
		columns: input.columns,
		rows: input.rows,
		timeoutMs: input.timeoutMs,
	};
	if (input.term !== undefined) {
		result.term = input.term;
	}
	if (input.signal !== undefined) {
		result.signal = input.signal;
	}
	return result;
}

export function registerRemote(options: RemoteRegistrationOptions): RemoteRegistration {
	const mutationStorage = new SqliteMachineMutationStorage(options.sqlite);
	const mutationModel = new MachineMutationModel(mutationStorage, options.resolver, new SecureSessionTokens());
	const mutations = new MachineMutationService(mutationModel, options.logger);
	const recovery = new MutationRecoveryService(mutationModel, mutations.ownerId, options.access, options.events);
	const machines = new RemoteMachineModel(options.resolver, options.ssh, options.verifyHostKey, options.hostKeys);
	const tools = new RemoteToolService(
		options.access,
		new RemoteToolModel(machines, options.resolver, new PosixToolInstaller(), new SecureSessionTokens()),
		mutations,
		options.logger,
	);
	const serverTransfers = new ServerTransferService(
		options.access,
		new ServerTransferModel(
			options.resolver,
			machines,
			options.hostKeys,
			new NativeServerTransfer(),
			new SecureSessionTokens(),
		),
		mutations,
		options.logger,
	);
	const connectionTests = new ConnectionTestService(new ConnectionTestModel(machines), options.access);
	const service = new RemoteSessionService(new RemoteSessionModel(machines), options.targets);
	// Independent technical PTY leases: public Remote/Agent sessions never enumerate
	// or claim ordinary Workspace shell resources.
	const workspaceShells = new RemoteSessionService(new RemoteSessionModel(machines), options.targets, {
		columns: WORKSPACE_TERMINAL_MAX_COLUMNS,
		rows: WORKSPACE_TERMINAL_MAX_ROWS,
	});
	const workspaceCommands = new WorkspaceCommandModel(machines);
	const suspendedLogs = options.logDirectory ? new LocalSuspendedTerminalLog(options.logDirectory) : null;
	const suspendedCheckpoints = new HeadlessSuspendedCheckpointFactory();
	const files = new RemoteFileService(
		options.access,
		new RemoteFileModel(machines, options.resolver, new SecureSessionTokens()),
		options.targets,
		mutations,
		options.logger,
	);
	const sessionTokens = new SessionTokenModel(new SecureSessionTokens());
	const workspaces = new WorkspaceService(
		options.access,
		workspaceShells,
		files,
		workspaceCommands,
		options.targets,
		new WorkspaceShellModelFactory(new NativeShellIntegrationFactory()),
		sessionTokens,
		suspendedLogs
			? new WorkspaceHistoryModel(suspendedLogs, suspendedCheckpoints, new HeadlessTerminalLogRenderer())
			: undefined,
		options.logger,
	);
	const observationModel = new ObservationModel(
		machines,
		new PosixServerStatusCollector(),
		new NativeDockerAdapter(),
		options.targets,
		options.resolver,
	);
	const operations = new RemoteMachineOperationService(
		new RemoteFileModel(machines, options.resolver, new SecureSessionTokens()),
		observationModel,
		new MachineCommandModel(machines, new PosixCommandAdapter()),
		new MachineAcpModel(machines, new PosixCommandAdapter(), new NdjsonAcpAdapter()),
		mutations,
	);
	const observations = new RemoteObservationService(
		options.access,
		options.resolver,
		workspaces,
		observationModel,
		mutations,
		options.statusIntervalSeconds,
		options.logger,
	);
	const resources = new ResourceStatusService(
		options.access,
		observationModel,
		observations,
		options.resourceRefreshSeconds,
	);
	const desktopModel = new DesktopModel(new BrowserDesktopAdapter(), new SecureSessionTokens());
	const desktops = new DesktopService(
		options.access,
		options.targets.desktopTargets,
		desktopModel,
		options.targets.connectionUsage,
		options.logger,
	);
	const publicApi: RemoteSessions = {
		open: (input) => remoteBoundary(async () => toSessionView(await service.open(toOpenSessionRequest(input)))),

		get: (id) =>
			remoteSyncBoundary(() => {
				const view = service.get(id);
				return view === null ? null : toSessionView(view);
			}),

		list: () => remoteSyncBoundary(() => service.list().map(toSessionView)),

		write: (id, bytes) => remoteSyncBoundary(() => service.write(id, Uint8Array.from(bytes))),

		resize: (id, columns, rows) => remoteSyncBoundary(() => service.resize(id, columns, rows)),

		onData: (id, listener) =>
			remoteSubscription(() => service.onData(id, (bytes) => listener(Uint8Array.from(bytes)))),

		onStderr: (id, listener) =>
			remoteSubscription(() => service.onStderr(id, (bytes) => listener(Uint8Array.from(bytes)))),

		onDrain: (id, listener) => remoteSubscription(() => service.onDrain(id, listener)),

		onClosed: (id, listener) => remoteSubscription(() => service.onClosed(id, listener)),

		pauseOutput: (id) => remoteSyncBoundary(() => service.pauseOutput(id)),

		resumeOutput: (id) => remoteSyncBoundary(() => service.resumeOutput(id)),

		closeSession: (id) => remoteBoundary(() => service.closeSession(id)),
	};
	const owner = new RemoteSessionOwner(options.access, service, options.events, sessionTokens);
	let closePromise: Promise<void> | null = null;
	const closeFailures: unknown[] = [];
	return {
		publicApi,
		operations: remoteOperations(operations),
		resourceCollector: {
			id: 'remote',

			collect: () => {
				const value = workspaces.getResourceUsage();
				return [
					{ name: 'active_workspaces', unit: 'count', value: value.workspaces },
					{ name: 'suspended_sessions', unit: 'count', value: value.suspended },
					{ name: 'disconnected_sessions', unit: 'count', value: value.disconnected },
					{ name: 'output_buffer_bytes', unit: 'bytes', value: value.outputBytes },
					{ name: 'input_buffer_bytes', unit: 'bytes', value: value.inputBytes },
					{ name: 'suspend_queue_bytes', unit: 'bytes', value: value.suspendQueueBytes },
					{ name: 'resume_buffer_bytes', unit: 'bytes', value: value.resumeBytes },
					{ name: 'active_transfers', unit: 'count', value: serverTransfers.getActiveTransferCount() },
					{ name: 'retained_transfers', unit: 'count', value: serverTransfers.getRetainedTransferCount() },
					{ name: 'status_subscriptions', unit: 'count', value: observations.getSubscriptionCount() },
				];
			},
		},

		prepareMonitoringConfiguration: (statusIntervalSeconds, resourceRefreshSeconds) => {
			const applyStatus = observations.prepareStatusInterval(statusIntervalSeconds);
			const applyResources = resources.prepareRefreshInterval(resourceRefreshSeconds);
			return () => {
				applyStatus();
				applyResources();
			};
		},

		installTransactionIdentityReader: (read) => mutationStorage.installTransactionIdentityReader(read),

		initialize: async () => {
			await mutations.initialize();
			await suspendedLogs?.clearAll();
		},

		httpRoutes: () => [
			...createRemoteToolRoutes(tools),
			...createServerTransferRoutes(serverTransfers),
			...createMutationHttpRoutes(recovery),
			...createConnectionTestRoutes(connectionTests),
			...createDesktopHttpRoutes(desktops),
			...createRemoteHttpRoutes(owner),
			...createSuspendHttpRoutes(workspaces),
			...createRemoteFileHttpRoutes(files),
			...createFileDownloadHttpRoutes(files),
			...createResourceStatusRoutes(resources),
		],

		webSocketRoutes: () => [
			createSuspendedCatalogWebSocketRoute(options.access, workspaces),
			createDesktopWebSocketRoute(options.access, desktops, desktopModel),
			createRemoteWebSocketRoute(owner, service),
			createWorkspaceFilesRoute(options.access, files, workspaces, observations),
			createUploadStreamRoute(options.access, files),
		],

		quiesce: () => {
			tools.quiesce();
			serverTransfers.quiesce();
			connectionTests.quiesce();
			recovery.quiesce();
			operations.quiesce();
			desktops.quiesce();
			resources.quiesce();
			observations.quiesce();
			workspaces.quiesce();
			workspaceCommands.quiesce();
			owner.quiesce();
			workspaceShells.quiesce();
			service.quiesce();
			files.quiesce();
		},

		close: () => {
			if (closePromise) {
				return closePromise;
			}
			closePromise = Promise.resolve().then(async () => {
				tools.quiesce();
				serverTransfers.quiesce();
				connectionTests.quiesce();
				recovery.quiesce();
				operations.quiesce();
				desktops.quiesce();
				resources.quiesce();
				observations.quiesce();
				workspaces.quiesce();
				workspaceCommands.quiesce();
				owner.quiesce();
				workspaceShells.quiesce();
				service.quiesce();
				files.quiesce();
				// Start independent owners together; a slow owner cannot block release of the others.
				const actual = Promise.allSettled([
					Promise.resolve().then(() => tools.close()),
					Promise.resolve().then(() => serverTransfers.close()),
					Promise.resolve().then(() => connectionTests.close()),
					Promise.resolve().then(() => recovery.close()),
					Promise.resolve().then(() => operations.close()),
					Promise.resolve().then(() => desktops.close()),
					Promise.resolve().then(() => desktopModel.close()),
					Promise.resolve().then(() => resources.close()),
					Promise.resolve().then(() => observations.close()),
					Promise.resolve().then(() => workspaces.close()),
					Promise.resolve().then(() => owner.close()),
					Promise.resolve().then(() => service.close()),
					Promise.resolve().then(() => workspaceShells.close()),
					Promise.resolve().then(() => workspaceCommands.close()),
					Promise.resolve().then(() => files.close()),
				]).then(async (outcomes) => {
					for (const result of outcomes) {
						if (result.status === 'rejected') {
							closeFailures.push(result.reason);
						}
					}
					if (suspendedLogs) {
						try {
							await suspendedLogs.close();
						} catch (error) {
							closeFailures.push(error);
						}
					}
					if (closeFailures.length) {
						throw new RemoteResourceCleanupFailure([...new Set(closeFailures)]);
					}
				});
				let timer: ReturnType<typeof setTimeout> | null = null;
				const timeout = new Promise<never>((_, reject) => {
					timer = setTimeout(
						() =>
							reject(new RemoteResourceCleanupFailure([new Error('Remote close confirmation expired')])),
						30_000,
					);
					timer.unref();
				});
				// The real close stays observed after the bounded caller returns unknown.
				void actual.catch((error) => {
					if (!closeFailures.includes(error)) {
						closeFailures.push(error);
					}
				});
				try {
					await Promise.race([actual, timeout]);
				} finally {
					if (timer) {
						clearTimeout(timer);
					}
				}
			});
			return closePromise;
		},
	};
}

/** Installation-only fixed storage coverage; no business records leave the adapter. */
export function registerRemoteBackup(): SnapshotRegistration {
	return registerRemoteSnapshot();
}

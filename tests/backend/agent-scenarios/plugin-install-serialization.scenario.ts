import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppStateRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-state.repository';
import { SqlitePluginInstallRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-plugin-install.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort } from '../../../packages/backend/src/modules/agent/agent.types';
import type { AgentSettingsService } from '../../../packages/backend/src/modules/agent/host/agent-settings.service';
import { validateManifest } from '../../../packages/backend/src/modules/agent/host/app-manifest-validator';
import { AppRegistryService } from '../../../packages/backend/src/modules/agent/host/app-registry.service';
import type {
	PackageVerifierPort,
	VerifiedPluginPackage,
} from '../../../packages/backend/src/modules/agent/host/package-verifier.port';
import type { PluginBackendRuntimePort } from '../../../packages/backend/src/modules/agent/host/plugin-backend-runtime.port';
import type { PluginDataManager } from '../../../packages/backend/src/modules/agent/host/plugin-data-manager';
import { PluginPackageInstallCoordinator } from '../../../packages/backend/src/modules/agent/host/plugin-package-install-coordinator';
import type { PluginPackageSourcePort } from '../../../packages/backend/src/modules/agent/host/plugin-package-source.port';
import { NOOP_PLUGIN_INSTALL_HOOKS } from '../../../packages/backend/src/modules/agent/host/plugin-install.types';
import type { RemotePluginRepositoryPort } from '../../../packages/backend/src/modules/agent/host/remote-plugin-repository.port';
import { PluginRuntimeLifecycleCoordinator } from '../../../packages/backend/src/modules/agent/host/plugin-runtime-lifecycle-coordinator';

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

export const pluginInstallSerializationScenario = async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-plugin-install-serialization-'));
	const db = new DatabaseAdapter({
		dataDirectory: directory,
		filename: 'plugin-install-serialization.sqlite',
		nodeEnv: 'test',
	});
	const repository = new SqlitePluginInstallRepository(db);
	const states = new SqliteAppStateRepository(db);
	const registry = new AppRegistryService();
	const appId = 'fixture.concurrent-install';
	const userId = 1;
	let now = 1_800_000_000;
	const clock: ClockPort = { nowUnixSeconds: () => now++ };
	const firstPackageInstallStarted = deferred();
	const releaseFirstPackageInstall = deferred();
	const secondVerified = deferred();
	const packageInstalls: string[] = [];

	const manifest = (version: string) =>
		validateManifest(
			{
				schemaVersion: 1,
				id: appId,
				version,
				displayName: 'Concurrent ' + version,
				sdkVersion: '1.0.0',
				nexus: { minVersion: '1.0.0', maxVersion: '99.0.0' },
				capabilities: [],
				intents: [],
			},
			{ nexusVersion: '1.0.0', supportedSdkMajor: 1 },
		);

	const packagesByStage = new Map<string, VerifiedPluginPackage>([
		[
			'stage-v1',
			{
				stageId: 'stage-v1',
				packageHash: 'hash-v1',
				publisherKeyId: 'publisher',
				manifest: manifest('1.0.0'),
				files: [],
				frontendEntry: null,
				backendEntry: null,
				skillFiles: [],
			},
		],
		[
			'stage-v2',
			{
				stageId: 'stage-v2',
				packageHash: 'hash-v2',
				publisherKeyId: 'publisher',
				manifest: manifest('2.0.0'),
				files: [],
				frontendEntry: null,
				backendEntry: null,
				skillFiles: [],
			},
		],
	]);
	const verifier: PackageVerifierPort = {
		normalizePublisherKey: async () => {
			throw new Error('UNUSED');
		},

		stage: async () => {
			throw new Error('UNUSED');
		},

		verify: async (stageId) => {
			const verified = packagesByStage.get(stageId);
			if (!verified) throw new Error('PLUGIN_STAGE_NOT_FOUND');
			if (stageId === 'stage-v2') secondVerified.resolve();
			return verified;
		},

		adoptStage: async () => undefined,

		install: async (stageId) => {
			packageInstalls.push(stageId);
			if (stageId === 'stage-v1') {
				firstPackageInstallStarted.resolve();
				await releaseFirstPackageInstall.promise;
			}
		},

		removeInstalled: async () => undefined,

		discardStage: async () => undefined,

		reconcileStages: async () => undefined,
	};
	const runtime: PluginBackendRuntimePort = {
		reconcileUser: async () => undefined,

		health: async () => ({ available: true, reason: null }),

		activate: async () => undefined,

		quiesce: async () => undefined,

		dispose: async () => undefined,

		migrate: async (_scope, _fromVersion, _plugin, storage) => storage,
	};
	const runtimeLifecycle = new PluginRuntimeLifecycleCoordinator(
		repository,
		registry,
		states,
		runtime,
		NOOP_PLUGIN_INSTALL_HOOKS,
		() => undefined,
	);
	const unusedPackages = {} as unknown as PluginPackageSourcePort;
	const unusedRemotePackages = {} as unknown as RemotePluginRepositoryPort;
	const unusedSettings = {} as unknown as AgentSettingsService;
	const unusedData = {} as unknown as PluginDataManager;
	const coordinator = new PluginPackageInstallCoordinator(
		repository,
		verifier,
		unusedPackages,
		unusedRemotePackages,
		unusedSettings,
		registry,
		states,
		unusedData,
		runtimeLifecycle,
		clock,
		'1.0.0',
	);

	let firstInstall: Promise<unknown> | null = null;
	let secondOutcome: Promise<{ ok: boolean; error?: unknown }> | null = null;
	try {
		await db.initialize();
		await db.execute(
			"INSERT INTO users (id, username, hashed_password) VALUES (1, 'plugin-install-user', 'not-used')",
		);
		for (const [stageId, verified] of packagesByStage) {
			const { validated: _validated, ...persistedManifest } = verified.manifest;
			await repository.createStage({
				id: stageId,
				userId,
				source: { kind: 'artifact', appId: 'fixture.source', id: stageId + '-artifact' },
				packageHash: verified.packageHash,
				sizeBytes: 1,
				publisherKeyId: verified.publisherKeyId,
				appId,
				version: verified.manifest.version,
				manifest: persistedManifest,
				status: 'verified',
				errorCode: null,
				createdAt: clock.nowUnixSeconds(),
				updatedAt: clock.nowUnixSeconds(),
				versionNumber: 1,
			});
		}

		firstInstall = coordinator.install(userId, 'stage-v1');
		await firstPackageInstallStarted.promise;
		secondOutcome = coordinator.install(userId, 'stage-v2').then(
			() => ({ ok: true }),
			(error) => ({ ok: false, error }),
		);
		await secondVerified.promise;
		await new Promise<void>((resolve) => setImmediate(resolve));
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.deepEqual(packageInstalls, ['stage-v1'], 'second version must not cross the per-App install boundary');

		releaseFirstPackageInstall.resolve();
		await firstInstall;
		const second = await secondOutcome;
		assert.equal(second.ok, false, 'concurrent different-version install must be rejected');
		assert.match(String(second.error), /PLUGIN_UPGRADE_REQUIRED/);

		const state = await states.get({ userId, appId });
		const installation = await repository.getInstallation(userId, appId);
		assert.equal(state?.activeVersion, '1.0.0');
		assert.equal(installation?.version, '1.0.0');
		assert.equal(installation?.status, 'installed');
		assert.deepEqual(
			packageInstalls,
			['stage-v1'],
			'rejected version must not be installed as a package side effect',
		);
		assert.equal((await repository.getStage(userId, 'stage-v2'))?.status, 'verified');

		return [{ name: 'plugin_install_concurrent_version_serialization', value: 1, unit: 'cases' }];
	} finally {
		releaseFirstPackageInstall.resolve();
		await firstInstall?.catch(() => undefined);
		await secondOutcome?.catch(() => undefined);
		await db.close().catch(() => undefined);
		fs.rmSync(directory, { recursive: true, force: true });
	}
};

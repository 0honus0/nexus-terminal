import { createHash, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PLUGIN_RUNNER_PROTOCOL_VERSION } from '../plugin-sdk.types';
import type { EnvironmentCommand, EnvironmentJobRequest, EnvironmentRecord } from '../types';
import { EnvironmentCatalog } from './environment-catalog';
import { SandboxEngine } from './sandbox-engine';
import { RunnerJournal, payloadHash } from './journal';
import { PackInstaller } from './pack-installer';
import { QuotaManager } from './quota-manager';
import { SpaceReporter } from './space-reporter';
import { CleanupPlanner } from './cleanup-planner';
import { PluginRunnerRuntime } from './plugin-runner-runtime';
import { MAX_HOST_WORKSPACE_TRANSFER_BYTES, type WorkspacePermission } from './workspace-broker';

const MAX_BODY_BYTES = 256 * 1024;
const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
};

const binary = async (
  response: ServerResponse,
  sizeBytes: number,
  source: AsyncIterable<Uint8Array>,
): Promise<void> => {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/octet-stream');
  response.setHeader('content-length', String(sizeBytes));
  response.setHeader('cache-control', 'no-store');
  await pipeline(Readable.from(source), response);
};

const workspaceContentLength = (request: IncomingMessage): number => {
  if (request.headers['transfer-encoding'] !== undefined) throw new Error('VALIDATION_FAILED');
  const raw = request.headers['content-length'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error('VALIDATION_FAILED');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_HOST_WORKSPACE_TRANSFER_BYTES) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  return value;
};

const body = async (request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(bytes);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('VALIDATION_FAILED');
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, unknown>;
};

const equalsToken = (candidate: string, expected: string): boolean => {
  const left = createHash('sha256').update(candidate).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
};

export interface RunnerControllerDependencies {
  token: string;
  deploymentId: string;
  catalog: EnvironmentCatalog;
  journal: RunnerJournal;
  sandboxEngine: SandboxEngine;
  installer: PackInstaller;
  quota: QuotaManager;
  storage: SpaceReporter;
  cleanup: CleanupPlanner;
  pluginRunner: PluginRunnerRuntime;
}

export class RunnerControllerServer {
  constructor(private readonly dependencies: RunnerControllerDependencies) {}

  createServer(): http.Server {
    return http.createServer((request, response) => void this.route(request, response));
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.authorized(request)) {
        json(response, 401, { error: 'UNAUTHORIZED' });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://runner.internal');
      if (request.method === 'GET' && url.pathname === '/v1/availability') {
        const sandbox = this.dependencies.sandboxEngine.availability();
        json(response, 200, {
          available: sandbox.available,
          state: sandbox.available ? 'ready' : 'degraded',
          reason: sandbox.available ? 'ready' : (sandbox.reason ?? 'sandbox_unavailable'),
          deploymentId: this.dependencies.deploymentId,
          controllerVersion: '1.0.0',
          sandbox,
          capabilities: { egressAllowlist: false },
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/catalog') {
        const catalog = this.dependencies.catalog.load();
        const active = this.dependencies.journal
          .environments()
          .filter((environment) => !['deleted', 'failed'].includes(environment.status));
        const packs = catalog.packs.map((pack) => {
          const contentDigest = pack.contentDigestByArch[process.arch] ?? '';
          const ref = { familyId: pack.familyId, versionId: pack.versionId, contentDigest };
          const supported = Boolean(contentDigest) && pack.supportedArchitectures.includes(process.arch);
          return {
            schemaVersion: 1 as const,
            familyId: pack.familyId,
            versionId: pack.versionId,
            displayName: pack.displayName,
            contentDigest,
            capabilities: pack.capabilities,
            runnerApiRange: pack.runnerApiRange,
            diskBytes: pack.diskBytes,
            dependencies: pack.dependencies,
            supportedArchitectures: pack.supportedArchitectures,
            status: supported ? pack.status : ('unavailable' as const),
            sideBySide: pack.sideBySide,
            installed: supported && this.dependencies.installer.installed(ref),
            enabled: supported && pack.status === 'supported',
            inUse:
              supported &&
              active.some((environment) =>
                environment.packs.some(
                  (candidate) =>
                    candidate.familyId === ref.familyId &&
                    candidate.versionId === ref.versionId &&
                    candidate.contentDigest === ref.contentDigest,
                ),
              ),
          };
        });
        json(response, 200, {
          revision: catalog.revision,
          runtimeDigest: catalog.runtimeDigest,
          recipes: catalog.recipes,
          packs,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/storage') {
        json(response, 200, this.dependencies.storage.report());
        return;
      }
      const workspaceFileMatch = url.pathname.match(/^\/v1\/environments\/([^/]+)\/workspaces\/([^/]+)\/file$/);
      if (workspaceFileMatch && (request.method === 'GET' || request.method === 'PUT')) {
        const environmentId = decodeURIComponent(workspaceFileMatch[1]!);
        const targetPluginId = decodeURIComponent(workspaceFileMatch[2]!);
        const generation = Number(url.searchParams.get('generation'));
        const logicalPath = url.searchParams.get('path') ?? '';
        const environment = this.dependencies.journal.environment(environmentId);
        if (!environment || ['deleted', 'failed'].includes(environment.status))
          throw new Error('ENVIRONMENT_NOT_FOUND');
        if (generation !== environment.generation) throw new Error('ENVIRONMENT_GENERATION_CONFLICT');
        if (!(environment.runnerPlugins ?? []).some((target) => target.pluginId === targetPluginId)) {
          throw new Error('WORKSPACE_TARGET_NOT_FOUND');
        }
        if (request.method === 'GET') {
          const read = await this.dependencies.pluginRunner.openWorkspaceFileRead(
            environmentId,
            generation,
            targetPluginId,
            logicalPath,
          );
          try {
            await binary(response, read.sizeBytes, read.source);
          } finally {
            await read.close();
          }
          return;
        }
        const expectedBytes = workspaceContentLength(request);
        await this.dependencies.pluginRunner.writeWorkspaceFileStream(
          environmentId,
          generation,
          targetPluginId,
          logicalPath,
          request,
          expectedBytes,
        );
        json(response, 200, { writtenBytes: expectedBytes });
        return;
      }
      const workspaceGrantMatch = url.pathname.match(/^\/v1\/environments\/([^/]+)\/workspaces\/([^/]+)\/grants$/);
      if (workspaceGrantMatch && (request.method === 'GET' || request.method === 'POST')) {
        const environmentId = decodeURIComponent(workspaceGrantMatch[1]!);
        const targetPluginId = decodeURIComponent(workspaceGrantMatch[2]!);
        const environment = this.dependencies.journal.environment(environmentId);
        if (!environment) throw new Error('ENVIRONMENT_NOT_FOUND');
        const targetIds = new Set((environment.runnerPlugins ?? []).map((target) => target.pluginId));
        if (!targetIds.has(targetPluginId)) throw new Error('WORKSPACE_TARGET_NOT_FOUND');
        if (request.method === 'GET') {
          const generation = Number(url.searchParams.get('generation'));
          if (generation !== environment.generation) throw new Error('ENVIRONMENT_GENERATION_CONFLICT');
          json(response, 200, {
            targetPluginId,
            grants: this.dependencies.pluginRunner.workspaceGrants(environmentId, generation, targetPluginId),
          });
          return;
        }
        const input = asRecord(await body(request));
        const generation = Number(input.generation);
        if (generation !== environment.generation || !Array.isArray(input.grants) || input.grants.length > 256) {
          throw new Error('VALIDATION_FAILED');
        }
        const grants = input.grants.map((candidate) => {
          const grant = asRecord(candidate);
          const principalPluginId = String(grant.principalPluginId ?? '');
          const grantPath = String(grant.path ?? '');
          if (
            !targetIds.has(principalPluginId) ||
            principalPluginId === targetPluginId ||
            !Array.isArray(grant.permissions)
          ) {
            throw new Error('WORKSPACE_GRANT_INVALID');
          }
          const permissions = grant.permissions.map(String) as WorkspacePermission[];
          return { principalPluginId, path: grantPath, permissions };
        });
        this.dependencies.pluginRunner.replaceWorkspaceGrants(environmentId, generation, targetPluginId, grants);
        json(response, 200, {
          targetPluginId,
          grants: this.dependencies.pluginRunner.workspaceGrants(environmentId, generation, targetPluginId),
        });
        return;
      }
      const commandMatch = url.pathname.match(/^\/v1\/commands\/([^/]+)$/);
      if (request.method === 'GET' && commandMatch) {
        const command = this.dependencies.journal.command(decodeURIComponent(commandMatch[1]!));
        if (!command) {
          json(response, 404, { error: 'COMMAND_NOT_FOUND' });
          return;
        }
        json(response, 200, command);
        return;
      }
      const environmentMatch = url.pathname.match(/^\/v1\/environments\/([^/]+)$/);
      if (request.method === 'GET' && environmentMatch) {
        const environment = this.dependencies.journal.environment(decodeURIComponent(environmentMatch[1]!));
        if (!environment) {
          json(response, 404, { error: 'ENVIRONMENT_NOT_FOUND' });
          return;
        }
        json(response, 200, environment);
        return;
      }
      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
      if (request.method === 'GET' && jobMatch) {
        const job = this.dependencies.journal.job(decodeURIComponent(jobMatch[1]!));
        if (!job) {
          json(response, 404, { error: 'JOB_NOT_FOUND' });
          return;
        }
        json(response, 200, job);
        return;
      }
      const environmentJobsMatch = url.pathname.match(/^\/v1\/environments\/([^/]+)\/jobs$/);
      if (request.method === 'POST' && environmentJobsMatch) {
        const environmentId = decodeURIComponent(environmentJobsMatch[1]!);
        const requestBody = asRecord(await body(request)) as unknown as EnvironmentJobRequest;
        json(response, 202, this.beginEnvironmentJob(environmentId, requestBody));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/setup/preview') {
        const input = asRecord(await body(request));
        const recipeId = String(input.recipeId ?? '');
        const versions = (
          input.versions && typeof input.versions === 'object' && !Array.isArray(input.versions) ? input.versions : {}
        ) as Record<string, string>;
        const recipe = this.dependencies.catalog.recipe(recipeId);
        const packs = this.dependencies.catalog.resolve(recipeId, versions);
        json(response, 200, {
          recipe,
          packs,
          missingPacks: packs,
          limits: recipe.defaultLimits,
          network: recipe.networkDefaults,
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/packs/ensure') {
        const input = asRecord(await body(request));
        const packs = Array.isArray(input.packs) ? input.packs : [];
        await this.dependencies.installer.ensure(packs as never[]);
        json(response, 200, { installed: packs.length });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/cache-cleanup') {
        json(response, 200, this.dependencies.cleanup.cacheCleanup());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/runtime-cleanup') {
        const input = asRecord(await body(request));
        if (!Number.isSafeInteger(input.userId) || (input.userId as number) < 1) throw new Error('VALIDATION_FAILED');
        json(response, 200, await this.dependencies.cleanup.runtimeCleanup(input.userId as number));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        json(response, 202, await this.executeCommand(await body(request)));
        return;
      }
      json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error('RUNNER_STREAM_FAILED'));
        return;
      }
      const message = error instanceof Error ? error.message : 'RUNNER_ERROR';
      const status =
        message === 'VALIDATION_FAILED'
          ? 400
          : message === 'PAYLOAD_TOO_LARGE' || message === 'WORKSPACE_FILE_TOO_LARGE'
            ? 413
            : message.includes('NOT_FOUND')
              ? 404
              : message.includes('MISMATCH') || message.includes('IDENTITY_CONFLICT')
                ? 409
                : message.includes('UNAVAILABLE')
                  ? 503
                  : 500;
      json(response, status, { error: message });
    }
  }

  private beginEnvironmentJob(environmentId: string, request: EnvironmentJobRequest) {
    const environment = this.dependencies.journal.environment(environmentId);
    if (!environment || !environment.sandboxId || environment.status !== 'running') {
      throw new Error('ENVIRONMENT_NOT_RUNNING');
    }
    const now = Math.floor(Date.now() / 1000);
    if (
      !request ||
      typeof request !== 'object' ||
      request.environmentId !== environmentId ||
      typeof request.jobId !== 'string' ||
      !/^[A-Za-z0-9-]{8,128}$/.test(request.jobId) ||
      request.userId !== environment.userId ||
      request.appId !== environment.appId ||
      request.runId !== environment.runId ||
      request.agentRuntimeId !== environment.agentRuntimeId ||
      request.generation !== environment.generation ||
      typeof request.operationHash !== 'string' ||
      !/^v1:[a-f0-9]{64}$/.test(request.operationHash) ||
      !Number.isSafeInteger(request.issuedAt) ||
      request.issuedAt > now + 60 ||
      !Number.isSafeInteger(request.deadlineAt) ||
      request.deadlineAt <= now ||
      typeof request.nonce !== 'string' ||
      request.nonce.length < 8 ||
      request.nonce.length > 256 ||
      !Array.isArray(request.argv) ||
      request.argv.length < 1 ||
      request.argv.length > 128 ||
      request.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      typeof request.cwd !== 'string' ||
      request.cwd.length < 1 ||
      request.cwd.length > 4096 ||
      !Number.isSafeInteger(request.maxBytes) ||
      request.maxBytes < 1 ||
      request.maxBytes > 1024 * 1024 ||
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > 5 * 60 * 1000
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const hash = payloadHash(request);
    const job = this.dependencies.journal.beginJob(request.jobId, hash, environmentId, request.generation);
    if (job.status === 'pending') {
      this.dependencies.journal.runningJob(request.jobId);
      void this.executeEnvironmentJob(environment.sandboxId, request);
    }
    return this.dependencies.journal.job(request.jobId)!;
  }

  private async executeEnvironmentJob(sandboxId: string, request: EnvironmentJobRequest): Promise<void> {
    try {
      const result = await this.dependencies.sandboxEngine.executeJob(sandboxId, request);
      this.dependencies.journal.succeedJob(request.jobId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dependencies.journal.failJob(request.jobId, message);
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    return (
      typeof header === 'string' &&
      header.startsWith('Bearer ') &&
      equalsToken(header.slice(7), this.dependencies.token)
    );
  }

  private async executeCommand(input: unknown) {
    const record = asRecord(input);
    const action = typeof record.action === 'string' ? record.action : '';
    if (['cacheCleanup', 'runtimeCleanup', 'packInstall', 'packUninstall'].includes(action)) {
      return this.executeAdminCommand(
        record,
        action as 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
      );
    }
    const command = record as unknown as EnvironmentCommand;
    this.validateCommand(command);
    const hash = payloadHash(command);
    const existing = this.dependencies.journal.begin(command.commandId, hash, command.action, command.environmentId);
    if (existing.status !== 'pending') return existing;
    this.dependencies.journal.running(command.commandId);
    try {
      let result: unknown;
      if (command.action === 'provision') result = await this.provision(command);
      else result = await this.environmentAction(command);
      this.dependencies.journal.succeed(command.commandId, result);
    } catch (error) {
      this.dependencies.journal.fail(command.commandId, error instanceof Error ? error.message : String(error));
    }
    return this.dependencies.journal.command(command.commandId)!;
  }

  private async executeAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ) {
    this.validateCommonCommand(command);
    const commandId = String(command.commandId);
    const hash = payloadHash(command);
    const existing = this.dependencies.journal.begin(commandId, hash, action, null);
    if (existing.status !== 'pending') return existing;
    this.dependencies.journal.running(commandId);
    try {
      let result: unknown;
      if (action === 'cacheCleanup') result = this.dependencies.cleanup.cacheCleanup();
      else if (action === 'runtimeCleanup')
        result = await this.dependencies.cleanup.runtimeCleanup(command.userId as number);
      else if (action === 'packInstall') {
        const packs = Array.isArray(command.packs) ? command.packs : [];
        if (!packs.length || packs.length > 32) throw new Error('VALIDATION_FAILED');
        await this.dependencies.installer.ensure(packs as never[], commandId);
        result = { installed: packs.length };
      } else {
        const pack = command.pack;
        if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('VALIDATION_FAILED');
        const ref = pack as { familyId?: unknown; versionId?: unknown; contentDigest?: unknown };
        if (
          typeof ref.familyId !== 'string' ||
          typeof ref.versionId !== 'string' ||
          typeof ref.contentDigest !== 'string'
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const inUse = this.dependencies.journal
          .environments()
          .filter((environment) => !['deleted', 'failed'].includes(environment.status))
          .some((environment) =>
            environment.packs.some(
              (candidate) =>
                candidate.familyId === ref.familyId &&
                candidate.versionId === ref.versionId &&
                candidate.contentDigest === ref.contentDigest,
            ),
          );
        if (inUse) throw new Error('ENVIRONMENT_PACK_IN_USE');
        await this.dependencies.installer.uninstall({
          familyId: ref.familyId,
          versionId: ref.versionId,
          contentDigest: ref.contentDigest,
        });
        result = { uninstalled: true };
      }
      this.dependencies.journal.succeed(commandId, result);
    } catch (error) {
      this.dependencies.journal.fail(commandId, error instanceof Error ? error.message : String(error));
    }
    return this.dependencies.journal.command(commandId)!;
  }

  private validateCommonCommand(command: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof command.commandId !== 'string' ||
      !command.commandId ||
      command.deploymentId !== this.dependencies.deploymentId ||
      !Number.isSafeInteger(command.userId) ||
      (command.userId as number) < 1 ||
      typeof command.appId !== 'string' ||
      !command.appId ||
      !Number.isSafeInteger(command.deadlineAt) ||
      (command.deadlineAt as number) <= now ||
      !Number.isSafeInteger(command.issuedAt) ||
      (command.issuedAt as number) > now + 60 ||
      typeof command.nonce !== 'string' ||
      !command.nonce ||
      command.nonce.length > 256 ||
      typeof command.operationHash !== 'string' ||
      !/^v1:[a-f0-9]{64}$/.test(command.operationHash)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }

  private validateCommand(command: EnvironmentCommand): void {
    this.validateCommonCommand(command as unknown as Record<string, unknown>);
    if (!command.environmentId || !command.runId || !command.agentRuntimeId || !command.groupId) {
      throw new Error('VALIDATION_FAILED');
    }
    if (!Number.isSafeInteger(command.generation) || command.generation < 1) throw new Error('VALIDATION_FAILED');
    if (command.action === 'provision') {
      const catalog = this.dependencies.catalog.load();
      if (command.catalogRevision !== catalog.revision || command.runtimeDigest !== catalog.runtimeDigest) {
        throw new Error('CATALOG_REVISION_CONFLICT');
      }
      const recipe = this.dependencies.catalog.recipe(command.recipeId);
      if (recipe.revision !== command.recipeRevision) throw new Error('ENVIRONMENT_RECIPE_STALE');
      this.dependencies.catalog.validateSelection(command.recipeId, command.packs);
      this.dependencies.quota.validate(command.limits);
      const targets = command.runnerPlugins ?? [];
      if (!Array.isArray(targets) || targets.length > 64) throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
      const targetIds = new Set<string>();
      for (const target of targets) {
        if (
          !target ||
          typeof target.pluginId !== 'string' ||
          typeof target.version !== 'string' ||
          typeof target.sdkVersion !== 'string' ||
          target.protocolVersion !== PLUGIN_RUNNER_PROTOCOL_VERSION ||
          typeof target.packageHash !== 'string' ||
          typeof target.entry !== 'string' ||
          targetIds.has(target.pluginId)
        ) {
          throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
        }
        targetIds.add(target.pluginId);
      }
    }
  }

  private async provision(command: EnvironmentCommand): Promise<EnvironmentRecord> {
    const current = this.dependencies.journal.environment(command.environmentId);
    if (current && current.generation >= command.generation && current.status !== 'deleted')
      throw new Error('ENVIRONMENT_GENERATION_CONFLICT');
    await this.dependencies.installer.ensure(command.packs, command.commandId);
    const now = Math.floor(Date.now() / 1000);
    const creating: EnvironmentRecord = {
      environmentId: command.environmentId,
      userId: command.userId,
      appId: command.appId,
      groupId: command.groupId,
      runId: command.runId,
      agentRuntimeId: command.agentRuntimeId,
      generation: command.generation,
      status: 'creating',
      sandboxId: null,
      commandId: command.commandId,
      retained: command.retained === true,
      recipeId: command.recipeId,
      recipeRevision: command.recipeRevision,
      runtimeDigest: command.runtimeDigest,
      catalogRevision: command.catalogRevision,
      packs: command.packs,
      runnerPlugins: (command.runnerPlugins ?? []).map((target) => ({ ...target })),
      limits: command.limits,
      network: command.network,
      updatedAt: now,
    };
    this.dependencies.journal.saveEnvironment(creating);
    const sandboxId = await this.dependencies.sandboxEngine.create(command);
    const ready: EnvironmentRecord = {
      ...creating,
      sandboxId,
      status: 'ready',
      updatedAt: Math.floor(Date.now() / 1000),
    };
    this.dependencies.pluginRunner.prepareEnvironment(ready);
    this.dependencies.journal.saveEnvironment(ready);
    return ready;
  }

  private async environmentAction(command: EnvironmentCommand): Promise<EnvironmentRecord> {
    const environment = this.dependencies.journal.environment(command.environmentId);
    if (!environment || environment.generation !== command.generation || !environment.sandboxId) {
      throw new Error('ENVIRONMENT_NOT_FOUND');
    }
    const samePacks = JSON.stringify(environment.packs) === JSON.stringify(command.packs);
    const sameRunnerPlugins =
      JSON.stringify(environment.runnerPlugins ?? []) === JSON.stringify(command.runnerPlugins ?? []);
    if (
      environment.userId !== command.userId ||
      environment.appId !== command.appId ||
      environment.groupId !== command.groupId ||
      environment.runId !== command.runId ||
      environment.agentRuntimeId !== command.agentRuntimeId ||
      environment.recipeId !== command.recipeId ||
      environment.recipeRevision !== command.recipeRevision ||
      environment.runtimeDigest !== command.runtimeDigest ||
      environment.catalogRevision !== command.catalogRevision ||
      !samePacks ||
      !sameRunnerPlugins
    ) {
      throw new Error('ENVIRONMENT_IDENTITY_MISMATCH');
    }
    if (command.action === 'start') {
      await this.dependencies.sandboxEngine.start(environment.sandboxId);
      try {
        await this.dependencies.pluginRunner.activateEnvironment(environment);
      } catch (error) {
        await this.dependencies.sandboxEngine.stop(environment.sandboxId).catch(() => undefined);
        throw error;
      }
      return this.save(environment, 'running', command.commandId);
    }
    if (command.action === 'stop') {
      await this.dependencies.pluginRunner.quiesceEnvironment(environment, Math.floor(Date.now() / 1000) + 10);
      await this.dependencies.pluginRunner.disposeEnvironment(environment);
      await this.dependencies.sandboxEngine.stop(environment.sandboxId);
      return this.save(environment, 'stopped', command.commandId);
    }
    if (command.action === 'restart') {
      await this.dependencies.pluginRunner.disposeEnvironment(environment);
      await this.dependencies.sandboxEngine.restart(environment.sandboxId);
      await this.dependencies.pluginRunner.activateEnvironment(environment);
      return this.save(environment, 'running', command.commandId);
    }
    if (command.action === 'delete') {
      await this.dependencies.pluginRunner.disposeEnvironment(environment);
      await this.dependencies.sandboxEngine.remove(environment.sandboxId);
      return this.save(environment, 'deleted', command.commandId);
    }
    if (command.action === 'setNetwork' || command.action === 'resize')
      throw new Error('ENVIRONMENT_RECREATE_REQUIRED');
    throw new Error('VALIDATION_FAILED');
  }

  private save(
    environment: EnvironmentRecord,
    status: EnvironmentRecord['status'],
    commandId: string,
  ): EnvironmentRecord {
    const next = { ...environment, status, commandId, updatedAt: Math.floor(Date.now() / 1000) };
    this.dependencies.journal.saveEnvironment(next);
    return next;
  }
}

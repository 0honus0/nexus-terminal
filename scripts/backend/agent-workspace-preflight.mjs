#!/usr/bin/env node
// Read-only inventory for OLD-version Workspace removal preflight.
// Run only against quiesced, consistent copies of Backend and Runner SQLite files.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LIMIT = 100_000;
const BACKEND_WORKSPACE_STATES = new Set([
  'creating',
  'ready',
  'starting',
  'running',
  'stopping',
  'stopped',
  'deleting',
  'deleted',
  'failed',
]);
const RUNNER_WORKSPACE_STATES = new Set(['creating', 'ready', 'running', 'stopped', 'deleted', 'failed']);
const COMMAND_STATES = new Set(['pending', 'running', 'succeeded', 'failed', 'unknown']);
const JOB_STATES = new Set(['pending', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']);
const allowed = new Set(['--backend-db', '--runner-journal', '--output']);
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  const value = process.argv[i + 1];
  if (!allowed.has(name) || !value || options.has(name)) {
    throw new Error(
      'Usage: node scripts/backend/agent-workspace-preflight.mjs --backend-db PATH --runner-journal PATH --output NEW_JSON_PATH',
    );
  }
  options.set(name, value);
}
if (options.size !== 3) throw new Error('Provide both SQLite snapshots and an explicit new report path.');

const inputFile = (name) => {
  const filename = path.resolve(options.get(name));
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular snapshot: ${name}`);
  if (info.size === 0) throw new Error(`Empty snapshot: ${name}`);
  return filename;
};
const backendFile = inputFile('--backend-db');
const runnerFile = inputFile('--runner-journal');
const outputFile = path.resolve(options.get('--output'));
if (new Set([backendFile, runnerFile, outputFile]).size !== 3) throw new Error('Input/output paths must differ.');

const open = (filename) => {
  const database = new DatabaseSync(filename, { readOnly: true });
  database.exec('PRAGMA query_only = ON');
  return database;
};
const bounded = (db, sql) => {
  const rows = db.prepare(`${sql} LIMIT ${LIMIT + 1}`).all();
  if (rows.length > LIMIT) throw new Error('INVENTORY_TOO_LARGE');
  return rows;
};
const requiredTables = (db, names) => {
  const found = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  for (const name of names) if (!found.has(name)) throw new Error(`SNAPSHOT_TABLE_MISSING:${name}`);
};
const hasSidecar = (filename) => {
  try {
    lstatSync(`${filename}-wal`);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};
const tally = (items) =>
  Object.fromEntries(
    [...new Set(items.map((item) => item.status))]
      .sort()
      .map((status) => [status, items.filter((item) => item.status === status).length]),
  );
const digest = (value) => createHash('sha256').update(value).digest('hex');
const backend = open(backendFile);
const runner = open(runnerFile);
let result;
try {
  requiredTables(backend, [
    'agent_workspaces',
    'agent_workspace_runtime_commands',
    'agent_workspace_runtime_confirmations',
    'agent_ssh_jobs',
    'agent_project_directories',
  ]);
  requiredTables(runner, ['journal_records']);
  const runnerVersion = runner.prepare('PRAGMA user_version').get()?.user_version;
  if (runnerVersion !== 5) throw new Error('RUNNER_JOURNAL_SCHEMA_UNSUPPORTED');

  const workspaces = bounded(
    backend,
    'SELECT id, user_id, app_id, run_id, generation, status, retained, retained_manifest_ref FROM agent_workspaces',
  );
  const commands = bounded(
    backend,
    'SELECT id, workspace_id, generation, action, status FROM agent_workspace_runtime_commands',
  );
  if (
    workspaces.some(
      (row) =>
        typeof row.id !== 'string' ||
        !Number.isSafeInteger(row.generation) ||
        row.generation < 1 ||
        (row.retained !== 0 && row.retained !== 1) ||
        !BACKEND_WORKSPACE_STATES.has(row.status),
    ) ||
    commands.some((row) => !COMMAND_STATES.has(row.status))
  ) {
    throw new Error('BACKEND_WORKSPACE_STATE_INVALID');
  }
  const runnerRows = bounded(runner, 'SELECT kind, id, payload FROM journal_records');
  const runnerRecords = { workspaces: [], commands: [], jobs: [] };
  for (const row of runnerRows) {
    if (!Object.hasOwn(runnerRecords, row.kind)) throw new Error('RUNNER_JOURNAL_KIND_INVALID');
    if (typeof row.payload !== 'string' || Buffer.byteLength(row.payload) > 2 * 1024 * 1024) {
      throw new Error('RUNNER_JOURNAL_PAYLOAD_INVALID');
    }
    const record = JSON.parse(row.payload);
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('RUNNER_JOURNAL_PAYLOAD_INVALID');
    }
    const key = row.kind === 'workspaces' ? 'workspaceId' : row.kind === 'jobs' ? 'jobId' : 'commandId';
    if (record[key] !== row.id || typeof record.status !== 'string') {
      throw new Error('RUNNER_JOURNAL_ID_OR_STATUS_INVALID');
    }
    if (
      (row.kind === 'workspaces' &&
        (!RUNNER_WORKSPACE_STATES.has(record.status) ||
          !Number.isSafeInteger(record.generation) ||
          record.generation < 1 ||
          typeof record.retained !== 'boolean')) ||
      (row.kind === 'commands' && !COMMAND_STATES.has(record.status)) ||
      (row.kind === 'jobs' &&
        (!JOB_STATES.has(record.status) || !Number.isSafeInteger(record.generation) || record.generation < 1))
    ) {
      throw new Error('RUNNER_JOURNAL_STATE_INVALID');
    }
    runnerRecords[row.kind].push(
      row.kind === 'workspaces'
        ? {
            id: record.workspaceId,
            generation: record.generation,
            status: record.status,
            retained: record.retained,
            configuredAcpProfiles: Array.isArray(record.acpProfiles) ? record.acpProfiles.length : null,
            configuredRunnerPlugins: Array.isArray(record.runnerPlugins) ? record.runnerPlugins.length : null,
          }
        : {
            id: row.id,
            workspaceId: record.workspaceId ?? null,
            generation: record.generation ?? null,
            status: record.status,
          },
    );
  }
  const backendById = new Map(workspaces.map((row) => [row.id, row]));
  const runnerById = new Map(runnerRecords.workspaces.map((row) => [row.id, row]));
  const differences = [];
  for (const row of workspaces) {
    const remote = runnerById.get(row.id);
    if (!remote) differences.push({ workspaceId: row.id, issue: 'missing_runner_workspace' });
    else if (row.generation !== remote.generation || Boolean(row.retained) !== remote.retained) {
      differences.push({ workspaceId: row.id, issue: 'generation_or_retention_mismatch' });
    } else if (row.status !== remote.status) {
      differences.push({ workspaceId: row.id, issue: 'status_mismatch' });
    }
  }
  for (const row of runnerRecords.workspaces) {
    if (!backendById.has(row.id)) differences.push({ workspaceId: row.id, issue: 'runner_only_workspace' });
  }
  const sidecars = { backend: hasSidecar(backendFile), runner: hasSidecar(runnerFile) };
  const pending = {
    backendCommands: commands.filter((row) => ['pending', 'running', 'unknown'].includes(row.status)).length,
    runnerCommands: runnerRecords.commands.filter((row) => ['pending', 'running', 'unknown'].includes(row.status))
      .length,
    runnerJobs: runnerRecords.jobs.filter((row) => ['pending', 'running', 'unknown'].includes(row.status)).length,
  };
  result = {
    schemaVersion: 1,
    kind: 'agent-workspace-preflight-read-only',
    generatedAt: new Date().toISOString(),
    input: {
      backend: {
        sizeBytes: lstatSync(backendFile).size,
        sqliteVersion: backend.prepare('PRAGMA user_version').get()?.user_version,
      },
      runner: { sizeBytes: lstatSync(runnerFile).size, journalVersion: runnerVersion },
      sidecars,
    },
    summary: {
      backendWorkspaces: workspaces.length,
      retainedWorkspaces: workspaces.filter((row) => row.retained === 1).length,
      backendStatuses: tally(workspaces),
      runnerWorkspaces: runnerRecords.workspaces.length,
      runnerStatuses: tally(runnerRecords.workspaces),
      backendCommands: commands.length,
      runnerCommands: runnerRecords.commands.length,
      runnerJobs: runnerRecords.jobs.length,
      pending,
      mismatches: differences.length,
    },
    records: { workspaces, backendCommands: commands, runner: runnerRecords, differences },
    unverified: [
      'write_admission_frozen',
      'live_runner_reachability',
      'os_process_exit_for_terminal_acp_plugins_and_jobs',
      'workspace_project_file_archives_and_artifact_hashes',
      'backend_and_runner_backup_integrity',
      'unknown_side_effect_reconciliation',
    ],
    eligibleForDestructiveMigration: false,
    reportSha256: null,
  };
  // Exclude full status and command payloads, credentials, argv, paths, and execution output.
  result.reportSha256 = digest(JSON.stringify({ summary: result.summary, records: result.records }));
} finally {
  backend.close();
  runner.close();
}
writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(
  JSON.stringify({
    result: 'INVENTORY_ONLY_NOT_CLEARED_FOR_MIGRATION',
    summary: result.summary,
    walSidecarsPresent: result.input.sidecars,
    output: outputFile,
  }),
);

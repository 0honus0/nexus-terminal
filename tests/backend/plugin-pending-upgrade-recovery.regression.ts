import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const schema = read('packages/backend/src/infrastructure/database/sqlite-schema.ts');
assert(schema.includes('CREATE TABLE IF NOT EXISTS agent_plugin_pending_upgrades'));
assert(schema.includes('app_state_version INTEGER NOT NULL'));

const coordinator = read('packages/backend/src/modules/agent/host/plugin-package-install-coordinator.ts');
assert(coordinator.includes('await this.repository.upsertPendingUpgrade(pendingUpgrade);'));
assert(coordinator.includes('async listPendingUpgrades(userId: number)'));
assert(coordinator.includes('async cancelPendingUpgrade(userId: number, appId: string, expectedVersion: number)'));
assert(coordinator.includes("throw new Error('PLUGIN_UPGRADE_IN_PROGRESS')"));
assert(coordinator.includes('await this.repository.deletePendingUpgrade(userId, appId);'));

const routes = read('packages/backend/src/interfaces/http/agent/plugins.routes.ts');
assert(routes.includes("'/pending-upgrades'"));
assert(routes.includes("'/:appId/upgrade/cancel'"));

const frontend = read('packages/frontend/src/features/agent/settings/PluginManagementSettings.vue');
assert(frontend.includes('agentApi.pendingPluginUpgrades()'));
assert(frontend.includes('candidate.value = { stage: recovered.stage, plugin: recovered.plugin };'));
assert(frontend.includes('drainingUpgradeVersion.value = recovered.expectedVersion;'));
assert(frontend.includes('agentApi.cancelPluginUpgrade(current.plugin.appId, expectedVersion)'));

process.stdout.write('plugin pending upgrade recovery regression: PASS\n');

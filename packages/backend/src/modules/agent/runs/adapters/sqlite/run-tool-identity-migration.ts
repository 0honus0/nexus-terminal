import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { readAgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity-codec';
import type { AgentToolHostOperationName } from '@nexus-terminal/shared/agent/plugins/values';
import { pluginToolName } from '../../../plugins/plugin-tool-authority-rules.js';

/** Historical Host interface names only; never consulted by runtime dispatch or admission. */
const HISTORICAL_HOST_OPERATIONS: Readonly<Record<string, AgentToolHostOperationName>> = {
	tool_search: 'discovery.search',
	plugin_tool_call: 'plugins.invoke',
	machine_connection_list: 'targets.list',
	host_diagnostics_read: 'diagnostics.host',
	machine_diagnostics_read: 'diagnostics.readTarget',
	skill_search: 'skills.search',
	skill_read: 'skills.read',
	image_models_list: 'images.list',
	image_generate: 'images.generate',
	context_checkpoint: 'context.checkpoint',
	tool_result_read: 'context.readResults',
	artifact_create: 'artifacts.create',
	artifact_read: 'artifacts.read',
	artifact_present: 'artifacts.present',
	memory_propose: 'memory.propose',
	memory_recall: 'memory.recall',
	project_directory_bind: 'project.bind',
	project_directory_read: 'project.read',
	project_directory_clear: 'project.clear',
	remote_file_read_text_page: 'remote.readTextPage',
	remote_directory_list_page: 'remote.listPage',
	file_read: 'remote.readTextPage',
	file_list: 'remote.listPage',
	file_inspect: 'remote.inspect',
	file_search: 'remote.search',
	file_write: 'remote.write',
	file_patch: 'remote.patch',
	file_move: 'remote.move',
	file_delete: 'remote.delete',
	file_deliver: 'remote.deliver',
	shell_execute: 'shell.execute',
	shell_job_control: 'shell.jobs',
	machine_docker_inspect: 'docker.inspect',
	machine_docker_control: 'docker.control',
	acp_integration_list: 'acp.catalog',
	acp_integration_execute: 'acp.executeSaved',
	acp_execute: 'acp.execute',
	acp_inner_permission: 'acp.permission',
	mcp_discover: 'mcp.catalog',
	mcp_tool: 'mcp.invokeTool',
	mcp_resource: 'mcp.readResource',
	mcp_prompt: 'mcp.readPrompt',
	browser_targets_list: 'browser.catalog',
	browser_open: 'browser.open',
	browser_close: 'browser.close',
	browser_snapshot: 'browser.snapshot',
	browser_screenshot: 'browser.screenshot',
	browser_console: 'browser.console',
	browser_navigate: 'browser.navigate',
	browser_back: 'browser.back',
	browser_scroll: 'browser.scroll',
	browser_press: 'browser.press',
	browser_select: 'browser.select',
	browser_wait: 'browser.wait',
	browser_click: 'browser.click',
	browser_type: 'browser.type',
	browser_upload: 'browser.upload',
	browser_download: 'browser.download',
	collaboration_delegate: 'collaboration.delegate',
	collaboration_list: 'collaboration.list',
	collaboration_output_read: 'collaboration.readOutput',
	collaboration_join: 'collaboration.join',
	collaboration_cancel: 'collaboration.cancel',
	collaboration_message_send: 'collaboration.sendMessage',
	collaboration_message_read: 'collaboration.readMessages',
	collaboration_message_consume: 'collaboration.consumeMessages',
	collaboration_fact_read: 'collaboration.readFact',
	collaboration_fact_write: 'collaboration.writeFact',
};

export function historicalToolHostOperation(name: string): AgentToolHostOperationName | null {
	return Object.hasOwn(HISTORICAL_HOST_OPERATIONS, name) ? (HISTORICAL_HOST_OPERATIONS[name] ?? null) : null;
}

async function historicalIdentity(tx: SqlExecutor, userId: number, toolName: string, toolVersion: string) {
	const host = historicalToolHostOperation(toolName);
	if (host !== null) {
		const identity = readAgentToolIdentity({ kind: 'host', operation: host });
		return identity;
	}
	const binding = /^([^@]+)@([^#]+)#([a-f0-9]{64})$/u.exec(toolVersion);
	if (!binding) {
		throw new Error('Unrecognized historical tool identity');
	}
	const packageId = binding[1],
		packageVersion = binding[2],
		packageSha256 = binding[3];
	const version = await tx.one(
		'SELECT manifest_json FROM agent_plugin_versions WHERE user_id=? AND definition_id=? AND version=? AND package_hash=?',
		[userId, packageId, packageVersion, packageSha256],
	);
	if (!version || typeof version.manifest_json !== 'string') {
		throw new Error('Historical tool package missing');
	}
	const manifest: unknown = JSON.parse(version.manifest_json);
	if (
		manifest === null ||
		typeof manifest !== 'object' ||
		!('id' in manifest) ||
		manifest.id !== packageId ||
		!('version' in manifest) ||
		manifest.version !== packageVersion ||
		!('contributions' in manifest) ||
		manifest.contributions === null ||
		typeof manifest.contributions !== 'object' ||
		!('tools' in manifest.contributions) ||
		!Array.isArray(manifest.contributions.tools)
	) {
		throw new Error('Historical tool manifest corrupt');
	}
	const names = manifest.contributions.tools.flatMap((tool: unknown) => {
		if (tool === null || typeof tool !== 'object' || !('name' in tool) || typeof tool.name !== 'string') {
			throw new Error('Historical tool declaration corrupt');
		}
		return pluginToolName(packageId, tool.name) === toolName ? [tool.name] : [];
	});
	if (names.length !== 1) {
		throw new Error('Historical tool declaration missing');
	}
	const identity = readAgentToolIdentity({
		kind: 'plugin',
		packageId,
		packageVersion,
		packageSha256,
		name: names[0],
	});
	return identity;
}

/** Add explicit provenance without changing original operation hashes, names, or approval decisions. */
export async function persistToolIdentities(tx: SqlExecutor): Promise<void> {
	await tx.exec("ALTER TABLE agent_run_tools ADD COLUMN identity_json TEXT NOT NULL DEFAULT '{}'");
	const tools = await tx.all('SELECT id,user_id,tool_name,tool_version FROM agent_run_tools', []);
	for (const row of tools) {
		if (
			typeof row.id !== 'string' ||
			typeof row.user_id !== 'number' ||
			!Number.isSafeInteger(row.user_id) ||
			row.user_id < 1 ||
			typeof row.tool_name !== 'string' ||
			typeof row.tool_version !== 'string'
		) {
			throw new Error('Corrupt historical tool identity');
		}
		const identity = await historicalIdentity(tx, row.user_id, row.tool_name, row.tool_version);
		await tx.run('UPDATE agent_run_tools SET identity_json=? WHERE id=?', [JSON.stringify(identity), row.id]);
	}
	const approvals = await tx.all('SELECT id,user_id,inspection_json FROM agent_governance_approvals', []);
	for (const row of approvals) {
		if (
			typeof row.id !== 'string' ||
			typeof row.user_id !== 'number' ||
			!Number.isSafeInteger(row.user_id) ||
			row.user_id < 1 ||
			typeof row.inspection_json !== 'string'
		) {
			throw new Error('Corrupt historical approval identity');
		}
		const inspection: unknown = JSON.parse(row.inspection_json);
		if (
			inspection === null ||
			typeof inspection !== 'object' ||
			!('toolName' in inspection) ||
			typeof inspection.toolName !== 'string' ||
			!('toolVersion' in inspection) ||
			typeof inspection.toolVersion !== 'string'
		) {
			throw new Error('Corrupt historical approval inspection');
		}
		// Superseded inspections retain their own exact package version, rather than adopting the current row's revision.
		const identity = await historicalIdentity(tx, row.user_id, inspection.toolName, inspection.toolVersion);
		await tx.run(
			"UPDATE agent_governance_approvals SET inspection_json=json_set(inspection_json,'$.identity',json(?)) WHERE id=?",
			[JSON.stringify(identity), row.id],
		);
	}
}

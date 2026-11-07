import { agentInteger, agentRecord, agentText } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentPluginToolInputSchema } from '@nexus-terminal/shared/agent/plugins/tool-schema';
import {
	readAgentPluginCompatibility,
	readAgentPluginPackageId,
} from '@nexus-terminal/shared/agent/plugins/http-codec';
import { legacyPluginSummary } from '../sqlite/plugin-legacy-row.js';
import { pluginEntry } from './plugin-manifest.js';
import { compare } from 'semver';

// Historical names are deliberately frozen: SDK4 must not reinterpret a signed SDK3 tool.
const SDK3_HOST_OPERATIONS = [
	'discovery.catalog',
	'discovery.activate',
	'targets.list',
	'diagnostics.host',
	'diagnostics.readTarget',
	'skills.catalog',
	'skills.read',
	'images.list',
	'images.generate',
	'context.checkpoint',
	'context.readResults',
	'artifacts.create',
	'artifacts.read',
	'artifacts.present',
	'artifacts.checkCapacity',
	'memory.propose',
	'memory.retrieve',
	'project.bindingRead',
	'project.bindingWrite',
	'remote.readTextPage',
	'remote.listPage',
	'remote.inspect',
	'remote.search',
	'remote.write',
	'remote.patch',
	'remote.move',
	'remote.delete',
	'remote.deliver',
	'shell.execute',
	'shell.jobs',
	'docker.inspect',
	'docker.control',
	'acp.catalog',
	'acp.executeSaved',
	'acp.execute',
	'mcp.catalog',
	'mcp.invokeTool',
	'mcp.readResource',
	'mcp.readPrompt',
	'browser.catalog',
	'browser.open',
	'browser.close',
	'browser.snapshot',
	'browser.screenshot',
	'browser.console',
	'browser.navigate',
	'browser.back',
	'browser.scroll',
	'browser.press',
	'browser.select',
	'browser.wait',
	'browser.click',
	'browser.type',
	'browser.upload',
	'browser.download',
	'collaboration.delegate',
	'collaboration.list',
	'collaboration.readOutput',
	'collaboration.join',
	'collaboration.cancel',
	'collaboration.sendMessage',
	'collaboration.readMessages',
	'collaboration.consumeMessages',
	'collaboration.readFact',
	'collaboration.writeFact',
] as const;

function invalid(): never {
	throw new Error('Corrupt historical plugin tool');
}

/** Audit only. No executable tool definition or runtime authority leaves this reader. */
export function retiredSdk3ToolName(input: unknown): string {
	const row = agentRecord(
		input,
		['name', 'description', 'inputSchema', 'executionProfile', 'discovery', 'childAccess', 'hostOperations'],
		256 * 1024,
	);
	const name = agentText(row.name, 64);
	const description = agentText(row.description, 256 * 1024);
	const discovery = agentRecord(row.discovery, ['mode', 'loader', 'keywords'], 256 * 1024);
	if (!Array.isArray(discovery.keywords) || !Array.isArray(row.hostOperations)) {
		invalid();
	}
	const keywords = discovery.keywords.map((value) => agentText(value, 256 * 1024));
	const operations = row.hostOperations.map((input) => {
		const operation = SDK3_HOST_OPERATIONS.find((value) => value === input);
		if (!operation) {
			invalid();
		}
		return operation;
	});
	if (
		!/^[a-z][a-z0-9_]{0,63}$/u.test(name) ||
		name.includes('\0') ||
		!description.trim() ||
		description.includes('\0') ||
		(row.executionProfile !== 'general' && row.executionProfile !== 'managed') ||
		(row.childAccess !== 'inherit' && row.childAccess !== 'root-only') ||
		(discovery.mode !== 'initial' && discovery.mode !== 'on-demand') ||
		typeof discovery.loader !== 'boolean' ||
		keywords.some((value) => !value.trim() || value.includes('\0')) ||
		new Set(keywords).size !== keywords.length ||
		new Set(operations).size !== operations.length ||
		(row.executionProfile === 'general' && (operations.length > 0 || discovery.loader)) ||
		(discovery.loader && !operations.includes('discovery.activate'))
	) {
		invalid();
	}
	readAgentPluginToolInputSchema(row.inputSchema);
	return name;
}

function canonicalJson(input: unknown): string {
	if (Array.isArray(input)) {
		return '[' + input.map(canonicalJson).join(',') + ']';
	}
	if (input !== null && typeof input === 'object') {
		return (
			'{' +
			Object.entries(input)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, value]) => JSON.stringify(key) + ':' + canonicalJson(value))
				.join(',') +
			'}'
		);
	}
	const encoded = JSON.stringify(input);
	if (encoded === undefined) {
		invalid();
	}
	return encoded;
}

/** Validate a retired signed SDK3 manifest solely for backup and migration evidence. */
export function retiredSdk3Manifest(input: unknown) {
	const row = agentRecord(
		input,
		[
			'schemaVersion',
			'id',
			'version',
			'displayName',
			'compatibility',
			'capabilities',
			'intents',
			'frontendEntry',
			'backendEntry',
			'contributions',
		],
		65536,
	);
	if (row.schemaVersion !== 3) {
		invalid();
	}
	const summary = legacyPluginSummary({
		format: 'legacy-archive',
		packageId: readAgentPluginPackageId(row.id),
		version: agentText(row.version, 64),
		displayName: agentText(row.displayName, 128),
		capabilities: row.capabilities,
	});
	const compatibility = readAgentPluginCompatibility(row.compatibility);
	if (!Array.isArray(row.intents)) {
		invalid();
	}
	const intents = row.intents.map((input) => {
		const intent = agentRecord(input, ['id', 'schemaVersion']);
		return { id: agentText(intent.id, 128), schemaVersion: agentInteger(intent.schemaVersion, 1) };
	});
	const contributions = agentRecord(row.contributions, ['app', 'tools', 'ui', 'skills'], 65536);
	if (
		!Array.isArray(contributions.tools) ||
		!Array.isArray(contributions.skills) ||
		typeof contributions.ui !== 'boolean'
	) {
		invalid();
	}
	const tools = contributions.tools.map(retiredSdk3ToolName);
	let self = false;
	if (contributions.app !== null) {
		const app = agentRecord(contributions.app, ['toolNames', 'execution', 'dependencies'], 65536);
		if ((app.toolNames !== null && !Array.isArray(app.toolNames)) || !Array.isArray(app.dependencies)) {
			invalid();
		}
		const names =
			app.toolNames === null
				? []
				: app.toolNames.map((input) => {
						const name = agentText(input, 64);
						if (!/^[a-z][a-z0-9_]{0,63}$/u.test(name)) {
							invalid();
						}
						return name;
					});
		const dependencies = app.dependencies.map((input) => {
			const dependency = agentRecord(input, ['packageId', 'publisherKeyId', 'minVersion', 'maxVersion']);
			const packageId = readAgentPluginPackageId(dependency.packageId);
			const range = readAgentPluginCompatibility({
				host: { minVersion: dependency.minVersion, maxVersion: dependency.maxVersion },
				backendSdk: null,
				frontendSdk: null,
			});
			if (
				packageId === summary.packageId ||
				typeof dependency.publisherKeyId !== 'string' ||
				!/^ed25519:[a-f0-9]{64}$/u.test(dependency.publisherKeyId) ||
				compare(range.host.minVersion, range.host.maxVersion) > 0
			) {
				invalid();
			}
			return packageId;
		});
		if (new Set(names).size !== names.length || new Set(dependencies).size !== dependencies.length) {
			invalid();
		}
		const execution = agentRecord(
			app.execution,
			app.execution !== null &&
				typeof app.execution === 'object' &&
				'kind' in app.execution &&
				app.execution.kind === 'self'
				? ['kind', 'protocol']
				: ['kind', 'protocol', 'packageId'],
		);
		if (execution.protocol !== 1) {
			invalid();
		}
		if (execution.kind === 'self') {
			self = true;
		} else if (
			execution.kind !== 'reference' ||
			execution.packageId === summary.packageId ||
			!dependencies.includes(readAgentPluginPackageId(execution.packageId))
		) {
			invalid();
		}
	}
	const skills = contributions.skills.map((input) => {
		const skill = agentRecord(input, ['id', 'path']);
		const path = pluginEntry(skill.path);
		const match = path === null ? null : /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path);
		if (path === null || !match || match[1].length > 64 || skill.id !== summary.packageId + '.' + match[1]) {
			invalid();
		}
		return { id: skill.id, path };
	});
	const frontendEntry = pluginEntry(row.frontendEntry),
		backendEntry = pluginEntry(row.backendEntry);
	if (
		new Set(tools).size !== tools.length ||
		new Set(skills.map((value) => value.id)).size !== skills.length ||
		new Set(intents.map((value) => value.id)).size !== intents.length ||
		(frontendEntry !== null && !frontendEntry.startsWith('frontend/')) ||
		(backendEntry !== null && !backendEntry.startsWith('backend/')) ||
		(frontendEntry === null) !== (compatibility.frontendSdk === null) ||
		(backendEntry === null) !== (compatibility.backendSdk === null) ||
		contributions.ui !== (frontendEntry !== null) ||
		(tools.length > 0 && (backendEntry === null || !summary.capabilities.includes('plugin.invoke'))) ||
		(self && (backendEntry === null || compatibility.backendSdk !== 3)) ||
		(contributions.app === null && tools.length === 0 && !contributions.ui && skills.length === 0)
	) {
		invalid();
	}
	return {
		summary,
		canonical: canonicalJson(input),
		schemaVersion: 3 as const,
		frontendEntry,
		backendEntry,
		skillPaths: skills.map((value) => value.path),
		toolNames: tools,
		kinds: {
			app: contributions.app !== null,
			tool: tools.length > 0 || skills.length > 0 || backendEntry !== null,
			ui: contributions.ui,
		},
	};
}

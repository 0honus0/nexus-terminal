import { agentInteger, agentRecord, agentText } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_PLUGIN_MAX_ENTRY_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { legacyPluginSummary } from '../../../plugins/adapters/sqlite/plugin-legacy-row.js';
import { pluginEntry } from '../../../plugins/adapters/package/plugin-manifest.js';
import type { StoredLegacyPluginSummary } from '../../../plugins/storage/plugin-legacy-storage.js';
import type { PackageReader, PackageSignature } from '../../../../../platform/packages/package-reader.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import {
	readAgentPluginCompatibility,
	readAgentPluginPackageId,
} from '@nexus-terminal/shared/agent/plugins/http-codec';
import { readAgentPluginToolInputSchema } from '@nexus-terminal/shared/agent/plugins/tool-schema';
import { retiredSdk3Manifest, retiredSdk3ToolName } from '../../../plugins/adapters/package/plugin-sdk3-audit.js';
import { AGENT_APPROVAL_RISKS } from '@nexus-terminal/shared/agent/governance/values';
import { compare } from 'semver';

interface ArchivedManifest {
	summary: StoredLegacyPluginSummary;
	canonical: string;
	schemaVersion: 1 | 2 | 3;
	frontendEntry: string | null;
	backendEntry: string | null;
	skillPaths: string[];
	toolNames: string[];
	kinds: { app: boolean; tool: boolean; ui: boolean };
}

function json(bytes: Uint8Array): unknown {
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function legacyText(value: unknown, maxBytes: number): string {
	const text = agentText(value, maxBytes);
	if (/[\u0000-\u001f\u007f]/u.test(text)) {
		throw new SnapshotFailure('unavailable');
	}
	return text;
}

/** Historical manifest validation is restricted to backup archives and never creates executable contributions. */
export function snapshotLegacyManifest(input: unknown): ArchivedManifest {
	if (input !== null && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 3) {
		return retiredSdk3Manifest(input);
	}
	if (input !== null && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 2) {
		return retiredSdk2Manifest(input);
	}
	const row = agentRecord(
		input,
		[
			'schemaVersion',
			'id',
			'version',
			'displayName',
			'sdkVersion',
			'capabilities',
			'intents',
			'frontendEntry',
			'backendEntry',
		],
		65536,
	);
	if (row.schemaVersion !== 1 || row.sdkVersion !== '1' || !Array.isArray(row.intents) || row.intents.length > 128) {
		throw new SnapshotFailure('unavailable');
	}
	const summary = legacyPluginSummary({
		format: 'legacy-archive',
		packageId: legacyText(row.id, 128),
		version: legacyText(row.version, 64),
		displayName: legacyText(row.displayName, 128),
		capabilities: row.capabilities,
	});
	const intents = row.intents.map((value) => {
		const item = agentRecord(value, ['id', 'schemaVersion']);
		return { id: legacyText(item.id, 128), schemaVersion: agentInteger(item.schemaVersion, 1) };
	});
	if (new Set(intents.map((value) => value.id)).size !== intents.length) {
		throw new SnapshotFailure('unavailable');
	}

	const entry = (input: unknown, prefix: string) => {
		if (input === null) {
			return null;
		}
		const value = pluginEntry(agentText(input, AGENT_PLUGIN_MAX_ENTRY_BYTES));
		if (value === null || !value.startsWith(prefix + '/')) {
			throw new SnapshotFailure('unavailable');
		}
		return value;
	};

	const frontendEntry = entry(row.frontendEntry, 'frontend');
	const backendEntry = entry(row.backendEntry, 'backend');
	return {
		summary,
		schemaVersion: 1,
		frontendEntry,
		backendEntry,
		skillPaths: [],
		toolNames: [],
		kinds: { app: true, tool: false, ui: false },
		canonical: JSON.stringify({
			schemaVersion: 1,
			id: summary.packageId,
			version: summary.version,
			displayName: summary.displayName,
			sdkVersion: '1',
			capabilities: summary.capabilities,
			intents,
			frontendEntry,
			backendEntry,
		}),
	};
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
		throw new SnapshotFailure('unavailable');
	}
	return encoded;
}

function retiredSdk2Manifest(input: unknown): ArchivedManifest {
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
	const summary = legacyPluginSummary({
		format: 'legacy-archive',
		packageId: readAgentPluginPackageId(row.id),
		version: agentText(row.version, 64),
		displayName: agentText(row.displayName, 128),
		capabilities: row.capabilities,
	});
	const compatibility = readAgentPluginCompatibility(row.compatibility);
	if (!Array.isArray(row.intents)) {
		throw new SnapshotFailure('unavailable');
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
		throw new SnapshotFailure('unavailable');
	}
	const tools = contributions.tools.map((input) => {
		if (
			input !== null &&
			typeof input === 'object' &&
			'discovery' in input &&
			typeof input.discovery === 'object'
		) {
			if (!summary.capabilities.includes('plugin.invoke')) {
				throw new SnapshotFailure('unavailable');
			}
			// SDK2's final tool declaration has the same finite shape as SDK3;
			// only its name leaves this inert archive validator.
			return retiredSdk3ToolName(input);
		}
		const tool = agentRecord(
			input,
			[
				'name',
				'description',
				'inputSchema',
				'capability',
				'risk',
				'mutation',
				'scheduling',
				'executionProfile',
				'discovery',
			],
			65536,
		);
		if (
			typeof tool.name !== 'string' ||
			!/^[a-z][a-z0-9_]{0,63}$/u.test(tool.name) ||
			typeof tool.description !== 'string' ||
			!tool.description.trim() ||
			tool.description.includes('\0') ||
			!summary.capabilities.some((value) => value === tool.capability) ||
			!AGENT_APPROVAL_RISKS.some((value) => value === tool.risk) ||
			typeof tool.mutation !== 'boolean' ||
			(tool.scheduling !== 'parallel' && tool.scheduling !== 'exclusive') ||
			(tool.executionProfile !== 'general' && tool.executionProfile !== 'remote-files-read') ||
			(tool.discovery !== 'initial' && tool.discovery !== 'on-demand') ||
			(tool.executionProfile === 'remote-files-read' &&
				(tool.capability !== 'file.read' ||
					tool.risk !== 'read' ||
					tool.mutation ||
					tool.scheduling !== 'parallel'))
		) {
			throw new SnapshotFailure('unavailable');
		}
		readAgentPluginToolInputSchema(tool.inputSchema);
		return tool.name;
	});
	let beforeStep = false;
	if (contributions.app !== null) {
		const app = agentRecord(contributions.app, ['role', 'beforeStep', 'toolNames', 'dependencies'], 65536);
		if (
			typeof app.role !== 'string' ||
			app.role.includes('\0') ||
			typeof app.beforeStep !== 'boolean' ||
			(app.toolNames !== null && !Array.isArray(app.toolNames)) ||
			!Array.isArray(app.dependencies)
		) {
			throw new SnapshotFailure('unavailable');
		}
		beforeStep = app.beforeStep;
		const names =
			app.toolNames === null
				? []
				: app.toolNames.map((input) => {
						if (typeof input !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(input)) {
							throw new SnapshotFailure('unavailable');
						}
						return input;
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
				throw new SnapshotFailure('unavailable');
			}
			return packageId;
		});
		if (new Set(names).size !== names.length || new Set(dependencies).size !== dependencies.length) {
			throw new SnapshotFailure('unavailable');
		}
	}
	const skills = contributions.skills.map((input) => {
		const skill = agentRecord(input, ['id', 'path']);
		const path = pluginEntry(skill.path);
		const match = path === null ? null : /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path);
		if (path === null || !match || match[1].length > 64 || skill.id !== summary.packageId + '.' + match[1]) {
			throw new SnapshotFailure('unavailable');
		}
		return { id: skill.id, path };
	});
	const frontendEntry = pluginEntry(row.frontendEntry);
	const backendEntry = pluginEntry(row.backendEntry);
	if (
		new Set(tools).size !== tools.length ||
		new Set(skills.map((value) => value.id)).size !== skills.length ||
		new Set(intents.map((value) => value.id)).size !== intents.length ||
		(frontendEntry !== null && !frontendEntry.startsWith('frontend/')) ||
		(backendEntry !== null && !backendEntry.startsWith('backend/')) ||
		(frontendEntry === null) !== (compatibility.frontendSdk === null) ||
		(backendEntry === null) !== (compatibility.backendSdk === null) ||
		(tools.length > 0 && backendEntry === null) ||
		contributions.ui !== (frontendEntry !== null) ||
		(beforeStep && (backendEntry === null || !summary.capabilities.includes('context.read')))
	) {
		throw new SnapshotFailure('unavailable');
	}
	return {
		summary,
		canonical: canonicalJson(input),
		schemaVersion: 2,
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

/** Verify retained signed bytes inertly; the executable package decoder accepts only the current contract. */
export async function validateSnapshotLegacyPackage(
	bytes: Uint8Array,
	manifestJson: string,
	publisherKeyId: string,
	publicKey: string,
	reader: PackageReader,
	signature: PackageSignature,
): Promise<void> {
	const files = await reader.read(bytes, {
		maxEntries: 10000,
		maxExpandedBytes: 200 * 1024 * 1024,
		maxFileBytes: 50 * 1024 * 1024,
	});
	const index = new Map(files.map((value) => [value.path, value]));
	const manifestFile = index.get('manifest.json'),
		listFile = index.get('files.json'),
		signatureFile = index.get('signature.ed25519');
	if (
		!manifestFile ||
		!listFile ||
		!signatureFile ||
		listFile.bytes.byteLength > 1024 * 1024 ||
		manifestFile.bytes.byteLength > 65536 ||
		snapshotLegacyManifest(json(manifestFile.bytes)).canonical !==
			snapshotLegacyManifest(JSON.parse(manifestJson)).canonical
	) {
		throw new SnapshotFailure('unavailable');
	}
	const list = agentRecord(json(listFile.bytes), ['schemaVersion', 'publisherKeyId', 'files'], 1024 * 1024);
	if (
		list.schemaVersion !== 1 ||
		list.publisherKeyId !== publisherKeyId ||
		!Array.isArray(list.files) ||
		list.files.length !== files.length - 3
	) {
		throw new SnapshotFailure('unavailable');
	}
	const listed = new Set<string>();
	for (const value of list.files) {
		const item = agentRecord(value, ['path', 'sizeBytes', 'sha256']);
		const path = pluginEntry(item.path);
		if (
			path === null ||
			listed.has(path) ||
			['manifest.json', 'files.json', 'signature.ed25519'].includes(path) ||
			typeof item.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(item.sha256)
		) {
			throw new SnapshotFailure('unavailable');
		}
		listed.add(path);
		const file = index.get(path);
		if (!file || file.bytes.byteLength !== agentInteger(item.sizeBytes) || file.sha256 !== item.sha256) {
			throw new SnapshotFailure('unavailable');
		}
	}
	const manifest = snapshotLegacyManifest(json(manifestFile.bytes));
	for (const entry of [manifest.frontendEntry, manifest.backendEntry]) {
		if (entry !== null && (typeof entry !== 'string' || !listed.has(entry))) {
			throw new SnapshotFailure('unavailable');
		}
	}
	if (
		manifest.schemaVersion !== 1 &&
		(index.has('agent.json') || manifest.skillPaths.some((path) => !listed.has(path)))
	) {
		throw new SnapshotFailure('unavailable');
	}
	if (
		signature.normalize(publicKey).id !== publisherKeyId ||
		!signature.verify(
			publicKey,
			Buffer.from(
				manifest.schemaVersion === 1
					? 'NEXUS_AGENT_PLUGIN_V1\0'
					: manifest.schemaVersion === 2
						? 'NEXUS_AGENT_PLUGIN_V2\0'
						: 'NEXUS_AGENT_PLUGIN_V3\0',
				'utf8',
			),
			[manifestFile.bytes, listFile.bytes],
			signatureFile.bytes,
		)
	) {
		throw new SnapshotFailure('unavailable');
	}
}

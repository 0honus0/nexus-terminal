import { agentPluginCapabilityReplyBytes } from '@nexus-terminal/shared/agent/plugins/runtime-codec';
import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { AgentFailure } from '../agent-failure.js';
import type { PluginSkillDocument, PluginSkill } from './model/plugin-skill-types.js';

interface ParsedFrontmatter {
	fields: Map<string, string>;
	metadata: Map<string, string>;
}

const parseScalar = (raw: string): string => {
	const value = raw.trim();
	if (value.startsWith('"') || value.endsWith('"')) {
		if (!(value.startsWith('"') && value.endsWith('"'))) {
			throw new AgentFailure('invalid_input');
		}
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed !== 'string') {
				throw new Error('invalid');
			}
			return parsed;
		} catch {
			throw new AgentFailure('invalid_input');
		}
	}
	if (value.startsWith("'") || value.endsWith("'")) {
		if (!(value.startsWith("'") && value.endsWith("'"))) {
			throw new AgentFailure('invalid_input');
		}
		return value.slice(1, -1).replaceAll("''", "'");
	}
	return value;
};

const blockScalar = (lines: readonly string[], start: number, marker: string): { value: string; next: number } => {
	const collected: string[] = [];
	let next = start;
	while (next < lines.length) {
		const line = lines[next];
		if (!line.trim()) {
			collected.push('');
			next += 1;
			continue;
		}
		const indentation = /^\s+/.exec(line)?.[0].length ?? 0;
		if (indentation === 0) {
			break;
		}
		collected.push(line);
		next += 1;
	}
	const nonEmpty = collected.filter((line) => line.trim());
	const indentation = nonEmpty.length ? Math.min(...nonEmpty.map((line) => /^\s+/.exec(line)?.[0].length ?? 0)) : 0;
	const normalized = collected.map((line) => (line ? line.slice(Math.min(indentation, line.length)) : ''));
	const folded = marker.startsWith('>')
		? normalized
				.join('\n')
				.replace(/([^\n])\n(?=[^\n])/g, '$1 ')
				.replace(/\n{3,}/g, '\n\n')
		: normalized.join('\n');
	const value = marker.endsWith('-') ? folded.replace(/\n+$/g, '') : folded;
	return { value, next };
};

const parseFrontmatter = (header: string): ParsedFrontmatter => {
	const fields = new Map<string, string>();
	const metadata = new Map<string, string>();
	const lines = header.split('\n');
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (!line.trim() || line.trimStart().startsWith('#')) {
			index += 1;
			continue;
		}
		if (/^\s/.test(line)) {
			throw new AgentFailure('invalid_input');
		}
		const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
		if (!match) {
			throw new AgentFailure('invalid_input');
		}
		const key = match[1];
		const rawValue = match[2] ?? '';
		if (fields.has(key) || (key === 'metadata' && metadata.size > 0)) {
			throw new AgentFailure('invalid_input');
		}

		if (key === 'metadata' && rawValue.trim() === '') {
			index += 1;
			while (index < lines.length) {
				const metadataLine = lines[index];
				if (!metadataLine.trim()) {
					index += 1;
					continue;
				}
				if (!/^\s/.test(metadataLine)) {
					break;
				}
				const item = /^\s+([A-Za-z0-9_.-]+):(?:\s*(.*))?$/.exec(metadataLine);
				if (!item) {
					throw new AgentFailure('invalid_input');
				}
				const metadataKey = item[1];
				if (metadata.has(metadataKey)) {
					throw new AgentFailure('invalid_input');
				}
				metadata.set(metadataKey, parseScalar(item[2] ?? ''));
				index += 1;
			}
			fields.set(key, '');
			continue;
		}

		if (/^[>|][+-]?$/.test(rawValue.trim())) {
			const block = blockScalar(lines, index + 1, rawValue.trim());
			fields.set(key, block.value);
			index = block.next;
			continue;
		}

		fields.set(key, parseScalar(rawValue));
		index += 1;
	}
	return { fields, metadata };
};

export function parsePluginSkills(documents: PluginSkillDocument[], version: string): PluginSkill[] {
	return documents.map((document) => {
		const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(document.path);
		const end = document.content.indexOf('\n---\n', 4);
		if (!match || match[1].length > 64 || !document.content.startsWith('---\n') || end < 0) {
			throw new AgentFailure('invalid_input');
		}
		const { fields } = parseFrontmatter(document.content.slice(4, end));
		const name = fields.get('name'),
			description = fields.get('description');
		if (
			name !== match[1] ||
			!description?.trim() ||
			/[\u0000-\u001f\u007f]/u.test(name) ||
			description.includes('\0') ||
			[...fields.keys()].some(
				(key) =>
					!['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(key),
			)
		) {
			throw new AgentFailure('invalid_input');
		}
		const skill = { name, description, version, sha256: document.sha256, body: document.content.slice(end + 5) };
		// Skills are currently delivered as one RPC result. Validate actual encoded
		// envelopes rather than inventing separate document or metadata quotas.
		const metadata = { name, description, version, sha256: document.sha256 };
		if (
			agentPluginCapabilityReplyBytes({ operation: 'skills.read', value: skill }) >
				AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES ||
			agentPluginCapabilityReplyBytes({
				operation: 'skills.catalog',
				value: { items: [metadata], nextOffset: Number.MAX_SAFE_INTEGER, catalogSha256: document.sha256 },
			}) > AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES
		) {
			throw new AgentFailure('limit_exceeded');
		}
		return skill;
	});
}

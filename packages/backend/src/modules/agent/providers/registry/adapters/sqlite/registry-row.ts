import { AGENT_REASONING_EFFORTS } from '@nexus-terminal/shared/agent/providers/values';
import type { StoredRegistryDefaults, StoredRegistrySnapshot } from '../../storage/registry-storage.js';

const REASONING = AGENT_REASONING_EFFORTS;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function positive(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function checkDefaults(raw: unknown): StoredRegistryDefaults {
	const row = record(raw);
	if (
		!row ||
		Object.keys(row).some(
			(key) =>
				![
					'contextWindow',
					'maxOutputTokens',
					'supportsTools',
					'supportsImageInput',
					'supportsFileInput',
					'reasoningEfforts',
				].includes(key),
		) ||
		!positive(row.contextWindow) ||
		!positive(row.maxOutputTokens) ||
		row.maxOutputTokens > row.contextWindow ||
		(row.supportsTools !== undefined && typeof row.supportsTools !== 'boolean')
	) {
		throw new Error('Invalid persisted registry capability');
	}
	for (const value of [row.supportsImageInput, row.supportsFileInput]) {
		if (value !== undefined && typeof value !== 'boolean') {
			throw new Error('Invalid persisted registry capability');
		}
	}
	let efforts: StoredRegistryDefaults['reasoningEfforts'];
	if (row.reasoningEfforts !== undefined) {
		if (
			!Array.isArray(row.reasoningEfforts) ||
			!row.reasoningEfforts.length ||
			row.reasoningEfforts.length > REASONING.length ||
			row.reasoningEfforts.some(
				(value) => typeof value !== 'string' || !REASONING.some((item) => item === value),
			) ||
			new Set(row.reasoningEfforts).size !== row.reasoningEfforts.length
		) {
			throw new Error('Invalid registry reasoning');
		}
		efforts = row.reasoningEfforts.map((value) => {
			for (const effort of REASONING) {
				if (value === effort) {
					return effort;
				}
			}
			throw new Error('Invalid registry reasoning');
		});
	}
	return {
		contextWindow: row.contextWindow,
		maxOutputTokens: row.maxOutputTokens,
		...(row.supportsTools === undefined ? {} : { supportsTools: row.supportsTools }),
		...(typeof row.supportsImageInput === 'boolean' ? { supportsImageInput: row.supportsImageInput } : {}),
		...(typeof row.supportsFileInput === 'boolean' ? { supportsFileInput: row.supportsFileInput } : {}),
		...(efforts === undefined ? {} : { reasoningEfforts: [...efforts] }),
	};
}

export function decodeRegistrySnapshot(raw: unknown): StoredRegistrySnapshot {
	const row = record(raw);
	const entries = record(row?.entries);
	if (
		!row ||
		!entries ||
		row.schemaVersion !== 1 ||
		row.source !== 'models.dev' ||
		(row.sourceRevision !== null && typeof row.sourceRevision !== 'string') ||
		!positive(row.generatedAt) ||
		Object.keys(entries).length < 1 ||
		Object.keys(entries).length > 5000
	) {
		throw new Error('Corrupt model registry snapshot');
	}
	const validated: Record<string, StoredRegistryDefaults> = Object.create(null);
	for (const [key, value] of Object.entries(entries)) {
		if (!key.trim() || key.length > 512 || Object.hasOwn(validated, key)) {
			throw new Error('Corrupt registry entry');
		}
		validated[key] = checkDefaults(value);
	}
	return {
		schemaVersion: 1,
		source: 'models.dev',
		sourceRevision: row.sourceRevision,
		generatedAt: row.generatedAt,
		entries: validated,
	};
}

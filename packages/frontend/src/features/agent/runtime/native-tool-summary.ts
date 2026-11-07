import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';

interface ToolSummaryTranslator {
	translate(key: string, named?: Record<string, string>): string;
	has(key: string): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function formatBytes(value: number): string {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function readBytes(value: unknown): string | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? formatBytes(value) : null;
}

function parsedSummary(summary: string): Record<string, unknown> | null {
	const text = summary.trim();
	if (!text.startsWith('{')) return null;
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

function actionLabel(value: string | null, translator: ToolSummaryTranslator): string | null {
	if (!value) return null;
	const key = `agent.nativeRun.toolAction.${value}`;
	return translator.has(key) ? translator.translate(key) : value;
}

function toolLabel(identity: AgentToolIdentity, translator: ToolSummaryTranslator): string | null {
	if (identity.kind !== 'host') return null;
	const key = `agent.nativeRun.hostOperation.${identity.operation.replaceAll('.', '_')}`;
	return translator.has(key) ? translator.translate(key) : null;
}

/** Display persisted Host identity; a plugin's local name never assigns Host behavior. */
export function toolDisplayName(identity: AgentToolIdentity, translator?: ToolSummaryTranslator): string {
	if (identity.kind === 'plugin') return `${identity.packageId} / ${identity.name}`;
	return (translator ? toolLabel(identity, translator) : null) ?? identity.operation;
}

export interface ToolCommandPreview {
	text: string;
	truncated: boolean;
}

/** Reads the bounded task or command preview included with the authoritative audit summary. */
export function toolCommandPreview(summary: string): ToolCommandPreview | null {
	const fields = parsedSummary(summary);
	const command = fields ? readText(fields.command) : null;
	return command ? { text: command, truncated: fields?.commandTruncated === true } : null;
}

function summaryTargetIds(fields: Record<string, unknown> | null): number[] {
	const targets = fields?.targets;
	if (
		!Array.isArray(targets) ||
		!targets.every((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
		new Set(targets).size !== targets.length
	)
		return [];
	return targets;
}

export function toolSummaryTargetIds(summary: string): number[] {
	return summaryTargetIds(parsedSummary(summary));
}

/** Multi-target delegations retain their real target list instead of inventing a single target. */
export function formatToolTargets(
	summary: string,
	targetConnectionId: number | null,
	labels: ReadonlyMap<number, string>,
): string {
	const targets = toolSummaryTargetIds(summary);
	const ids = targets.length ? targets : targetConnectionId === null ? [] : [targetConnectionId];
	return ids.length ? ids.map((id) => labels.get(id) ?? String(id)).join(', ') : '—';
}

/** Converts the server's sanitized audit summary into readable UI copy without exposing raw JSON. */
export function formatToolSummary(
	summary: string,
	identity: AgentToolIdentity,
	translator: ToolSummaryTranslator,
): string {
	const fields = parsedSummary(summary);
	if (!fields) {
		return toolLabel(identity, translator) ?? translator.translate('agent.nativeRun.toolSummary.recorded');
	}
	const action = readText(fields.action);
	const path = readText(fields.path);
	const bytes = readBytes(fields.bytes ?? fields.newBytes);
	switch (action) {
		case 'delegate':
			return translator.translate('agent.nativeRun.toolSummary.delegate', {
				profile: readText(fields.profile) ?? '—',
				targets: summaryTargetIds(fields).join(', ') || '—',
				bytes: readBytes(fields.objectiveBytes) ?? '—',
			});
		case 'execute': {
			const mode =
				readText(fields.mode) === 'background'
					? translator.translate('agent.nativeRun.toolSummary.executeBackground')
					: translator.translate('agent.nativeRun.toolSummary.executeForeground');
			const cwd = readText(fields.cwd);
			if (!cwd) return translator.translate('agent.nativeRun.toolSummary.execute', { mode, bytes: bytes ?? '—' });
			return translator.translate('agent.nativeRun.toolSummary.executeWithCwd', {
				mode,
				bytes: bytes ?? '—',
				cwd,
			});
		}
		case 'image_generate':
			return translator.translate('agent.nativeRun.toolSummary.imageGenerate', {
				model: readText(fields.modelId) ?? '—',
				bytes: readBytes(fields.promptBytes) ?? '—',
			});
		case 'acp_execute':
			return translator.translate('agent.nativeRun.toolSummary.acpExecute', {
				cwd: readText(fields.cwd) ?? '—',
				bytes: readBytes(fields.promptBytes) ?? '—',
			});
		case 'bind':
			return translator.translate('agent.nativeRun.toolSummary.projectBind', { path: path ?? '—' });
		case 'read':
			if (path) return translator.translate('agent.nativeRun.toolSummary.projectRead', { path });
			break;
		case 'create':
			return translator.translate('agent.nativeRun.toolSummary.writeCreate', {
				path: path ?? '—',
				bytes: bytes ?? '—',
			});
		case 'replace':
			return translator.translate('agent.nativeRun.toolSummary.writeReplace', {
				path: path ?? '—',
				bytes: bytes ?? '—',
			});
		case 'patch':
			return translator.translate('agent.nativeRun.toolSummary.patch', {
				path: path ?? '—',
				bytes: bytes ?? '—',
			});
		case 'move': {
			const destination = readText(fields.destinationPath);
			if (path && destination)
				return translator.translate('agent.nativeRun.toolSummary.move', { path, destination });
			break;
		}
		case 'delete':
			if (path) return translator.translate('agent.nativeRun.toolSummary.delete', { path });
			break;
	}
	const label = actionLabel(action, translator);
	return label
		? translator.translate('agent.nativeRun.toolSummary.action', { action: label })
		: (toolLabel(identity, translator) ?? translator.translate('agent.nativeRun.toolSummary.recorded'));
}

import { AGENT_REASONING_EFFORTS } from '@nexus-terminal/shared/agent/providers/values';
import type { AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import type { RegistryDefaults, RegistryMatch } from './model/registry-types.js';

function normalize(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function withoutPrefix(value: string): string {
	if (/(?:^|[/:])ft:/i.test(value)) {
		return value;
	}
	let end = value.length;
	while (end > 0) {
		const separator = Math.max(value.lastIndexOf('/', end - 1), value.lastIndexOf(':', end - 1));
		if (separator < 0 || separator === value.length - 1) {
			return value;
		}
		if (value[separator] === ':' && /^\d+$/.test(value.slice(separator + 1, end))) {
			end = separator;
			continue;
		}
		return value.slice(separator + 1).trim();
	}
	return value;
}

function withoutDate(value: string): { base: string; date: number } {
	const match = value.match(/^(.*?)[-_](?:(\d{4})[-_](\d{2})[-_](\d{2})|(\d{8})|(\d{4}))$/);
	if (!match) {
		return { base: value, date: 0 };
	}
	const packed = match[5] ?? match[6];
	const year = match[2] ? Number(match[2]) : packed?.length === 8 ? Number(packed.slice(0, 4)) : 0;
	const month = match[3] ? Number(match[3]) : Number(packed?.slice(-4, -2));
	const day = match[4] ? Number(match[4]) : Number(packed?.slice(-2));
	const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (
		(year !== 0 && (year < 2000 || year > 2199)) ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > (days[month - 1] ?? 0)
	) {
		return { base: value, date: 0 };
	}
	return { base: match[1] ?? value, date: year * 10_000 + month * 100 + day };
}

function identity(value: string): { base: string; date: number; effort?: AgentReasoningEffort } {
	let base = value.toLowerCase();
	let effort: AgentReasoningEffort | undefined;
	let date = 0;
	for (;;) {
		const dated = withoutDate(base);
		if (dated.base !== base) {
			date = dated.date;
			base = dated.base;
			continue;
		}
		const separator = Math.max(base.lastIndexOf('-'), base.lastIndexOf('_'));
		if (separator < 0) {
			break;
		}
		const suffix = base.slice(separator + 1);
		const level = AGENT_REASONING_EFFORTS.find((item) => item === suffix);
		if (!level && suffix !== 'thinking' && suffix !== 'fast') {
			break;
		}
		effort ??= level;
		base = base.slice(0, separator);
	}
	return { base, date, effort };
}

export function matchRegistryDefaults(
	entries: Record<string, RegistryDefaults>,
	modelId: string,
): RegistryMatch | null {
	const requested = modelId.trim().toLowerCase();
	const bare = withoutPrefix(requested);
	const wanted = identity(bare);
	const candidates: Array<{
		id: string;
		defaults: RegistryDefaults;
		score: number;
		aggregate: boolean;
		base: boolean;
		date: number;
	}> = [];
	for (const [id, defaults] of Object.entries(entries)) {
		const key = id.toLowerCase();
		const suffix = withoutPrefix(key);
		const candidate = identity(suffix);
		const score =
			key === requested
				? 150
				: suffix === bare
					? 140
					: normalize(suffix) === normalize(bare)
						? 130
						: normalize(suffix) === normalize(wanted.base)
							? 120
							: normalize(candidate.base) === normalize(wanted.base)
								? 110
								: 0;
		if (score) {
			candidates.push({
				id,
				defaults,
				score,
				aggregate: key.startsWith('opencode/'),
				base: candidate.date === 0,
				date: candidate.date,
			});
		}
	}
	candidates.sort(
		(left, right) =>
			right.score - left.score ||
			Number(left.aggregate) - Number(right.aggregate) ||
			Number(right.base) - Number(left.base) ||
			right.date - left.date ||
			left.id.localeCompare(right.id),
	);
	const first = candidates[0];
	if (!first) {
		return null;
	}
	const tied = candidates.filter(
		(item) =>
			item.score === first.score &&
			item.aggregate === first.aggregate &&
			item.base === first.base &&
			item.date === first.date,
	);
	if (tied.some((item) => JSON.stringify(item.defaults) !== JSON.stringify(first.defaults))) {
		return null;
	}
	return { canonicalId: withoutPrefix(first.id), defaults: first.defaults, reasoningEffort: wanted.effort };
}

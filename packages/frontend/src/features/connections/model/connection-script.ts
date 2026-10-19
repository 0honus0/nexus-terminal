import { InvalidTargetPayload, targetOption } from '@nexus-terminal/shared/targets/http';
import {
	CONNECTION_TYPES,
	TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES,
} from '@nexus-terminal/shared/targets/connections/values';
import { readConnectionImportInput } from '@nexus-terminal/shared/targets/connections/http-codec';
import type { TargetImportInput } from '@nexus-terminal/shared/targets/connections/http';
import type { ProxySummary } from '@/features/proxies/public';
import type { SshKeySummary } from '@/features/ssh-keys/public';

/** A bounded UI batch, dispatched in protocol-sized independent chunks. */
export const CONNECTION_CREATION_MAX_ITEMS = 500;

function tokens(line: string): string[] {
	const result: string[] = [];
	let token = '';
	let quote: string | null = null;
	let started = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === undefined) {
			break;
		}
		if (char === '\\' && quote !== null) {
			const next = line[i + 1];
			if (next === quote || next === '\\') {
				token += next;
				i++;
			} else {
				token += char;
			}
			started = true;
		} else if (quote !== null) {
			if (char === quote) {
				quote = null;
			} else {
				token += char;
			}
		} else if (char === '"' || char === "'") {
			quote = char;
			started = true;
		} else if (/\s/u.test(char)) {
			if (started) {
				result.push(token);
				token = '';
				started = false;
			}
		} else {
			token += char;
			started = true;
		}
	}
	if (quote !== null) {
		throw new InvalidTargetPayload();
	}
	if (started) {
		result.push(token);
	}
	return result;
}

export function expandConnectionHosts(host: string): string[] {
	if (!host.includes('~')) {
		return [host];
	}
	const parts = host.split('~');
	if (parts.length !== 2) {
		throw new InvalidTargetPayload();
	}

	const parse = (value: string | undefined): number[] => {
		const fields = (value ?? '').trim().split('.');
		if (fields.length !== 4 || fields.some((field) => !/^\d{1,3}$/u.test(field) || Number(field) > 255)) {
			throw new InvalidTargetPayload();
		}
		return fields.map(Number);
	};

	const start = parse(parts[0]);
	const end = parse(parts[1]);
	const first = start[3];
	const last = end[3];
	if (
		first === undefined ||
		last === undefined ||
		first > last ||
		start.slice(0, 3).join('.') !== end.slice(0, 3).join('.')
	) {
		throw new InvalidTargetPayload();
	}
	return Array.from({ length: last - first + 1 }, (_, i) => start.slice(0, 3).join('.') + '.' + (first + i));
}

export function parseConnectionScript(
	source: string,
	proxies: readonly ProxySummary[],
	keys: readonly SshKeySummary[],
): TargetImportInput[] {
	if (new TextEncoder().encode(source).byteLength > TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES) {
		throw new InvalidTargetPayload();
	}
	const lines = source
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	if (!lines.length || lines.length > CONNECTION_CREATION_MAX_ITEMS) {
		throw new InvalidTargetPayload();
	}
	return lines.map((line) => {
		const words = tokens(line);
		const address = words.shift();
		if (!address) {
			throw new InvalidTargetPayload();
		}
		const at = address.indexOf('@');
		if (at < 1) {
			throw new InvalidTargetPayload();
		}
		const username = address.slice(0, at);
		let host = address.slice(at + 1);
		let port: number | undefined;
		if (host.startsWith('[')) {
			const match = /^\[([^\]]+)\](?::([1-9]\d*))?$/u.exec(host);
			if (!match?.[1]) {
				throw new InvalidTargetPayload();
			}
			host = match[1];
			if (match[2]) {
				port = Number(match[2]);
			}
		} else if (host.includes(':')) {
			const match = /^([^:]+):([1-9]\d*)$/u.exec(host);
			if (!match?.[1] || !match[2]) {
				throw new InvalidTargetPayload();
			}
			host = match[1];
			port = Number(match[2]);
		}
		let type: TargetImportInput['connection']['type'] = 'SSH';
		let name = username + '@' + host;
		let password: string | undefined;
		let keyName: string | undefined;
		let proxyName: string | undefined;
		let notes: string | null = null;
		const tagNames: string[] = [];
		const seen = new Set<string>();
		for (let i = 0; i < words.length; i++) {
			const flag = words[i];
			if (!flag || seen.has(flag)) {
				throw new InvalidTargetPayload();
			}
			seen.add(flag);
			if (flag === '-tags') {
				while (i + 1 < words.length && !words[i + 1]?.startsWith('-')) {
					tagNames.push(...(words[++i] ?? '').split(',').filter(Boolean));
				}
				continue;
			}
			const value = words[++i];
			if (value === undefined) {
				throw new InvalidTargetPayload();
			}
			switch (flag) {
				case '-type':
					type = targetOption(value.toUpperCase(), CONNECTION_TYPES);
					break;
				case '-name':
					name = value;
					break;
				case '-p':
					password = value;
					break;
				case '-k':
					keyName = value;
					break;
				case '-proxy':
					proxyName = value;
					break;
				case '-note':
					notes = value;
					break;
				default:
					throw new InvalidTargetPayload();
			}
		}
		if (password !== undefined && keyName !== undefined) {
			throw new InvalidTargetPayload();
		}
		const key = keyName === undefined ? undefined : keys.find((key) => key.name === keyName);
		const proxy = proxyName === undefined ? undefined : proxies.find((proxy) => proxy.name === proxyName);
		if (
			(keyName !== undefined && !key) ||
			(proxyName !== undefined && !proxy) ||
			(type !== 'SSH' && (key || proxy))
		) {
			throw new InvalidTargetPayload();
		}
		const input: TargetImportInput = {
			connection: {
				name,
				type,
				host,
				port: port ?? (type === 'SSH' ? 22 : type === 'RDP' ? 3389 : 5900),
				username,
				route: proxy ? 'proxy' : 'direct',
				proxyId: proxy?.id ?? null,
				notes,
				rdpRemoteApp: null,
				rdpRemoteAppDirectory: null,
				rdpRemoteAppArguments: null,
				tagIds: [],
				jumpIds: [],
			},
			tagNames: [...new Set(tagNames.map((name) => name.trim()))],
		};
		if (key) {
			input.credential = { kind: 'ssh_key', sshKeyId: key.id };
		} else if (password !== undefined) {
			input.credential = { kind: 'password', password };
		}
		return readConnectionImportInput(input);
	});
}

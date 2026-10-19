import type { TargetProxyView } from '@nexus-terminal/shared/targets/proxies/model';
import type { TargetProxyInput } from '@nexus-terminal/shared/targets/proxies/http';
import { readProxyInput } from '@nexus-terminal/shared/targets/proxies/http-codec';
import type { ProxyDraft, ProxySummary } from './proxy-types';

export function toProxySummary(value: TargetProxyView): ProxySummary {
	return {
		id: value.id,
		name: value.name,
		type: value.type,
		host: value.host,
		port: value.port,
		username: value.username,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toProxyInput(value: ProxyDraft): TargetProxyInput {
	const input: TargetProxyInput = {
		name: value.name.trim(),
		type: value.type,
		host: value.host.trim(),
		port: Number(value.port),
		username: value.username || null,
	};
	if (value.clearPassword) {
		input.password = null;
	} else if (value.password !== '') {
		input.password = value.password;
	}
	return readProxyInput(input);
}

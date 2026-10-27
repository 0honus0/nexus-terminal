import type { TargetHostKeyView } from '@nexus-terminal/shared/targets/host-keys/model';
import type { TargetHostKeyConfirmRequest } from '@nexus-terminal/shared/targets/host-keys/http';
import { readHostKeyConfirmRequest } from '@nexus-terminal/shared/targets/host-keys/http-codec';
import { InvalidTargetPayload } from '@nexus-terminal/shared/targets/http';
import type { HostKeyDraft, HostKeySummary } from './host-key-types';

export function toHostKeySummary(value: TargetHostKeyView): HostKeySummary {
	return { host: value.host, port: value.port, fingerprint: value.fingerprint, confirmedAt: value.confirmedAt };
}

export function toHostKeyConfirmation(value: HostKeyDraft): TargetHostKeyConfirmRequest {
	if (!/^[1-9]\d{0,4}$/u.test(value.port)) {
		throw new InvalidTargetPayload();
	}
	return readHostKeyConfirmRequest({ host: value.host, port: Number(value.port), fingerprint: value.fingerprint });
}

import { ACCESS_PASSKEY_NAME_MAX_BYTES } from '@nexus-terminal/shared/access/values';

/** A suggested label never participates in credential verification or authorization. */
export function defaultPasskeyName(authenticatorName: string | null): string | null {
	if (authenticatorName === null) {
		return null;
	}
	const name = `${authenticatorName} Passkey`;
	return new TextEncoder().encode(name).length <= ACCESS_PASSKEY_NAME_MAX_BYTES ? name : null;
}

import { InvalidTargetPayload, targetNumber } from '@nexus-terminal/shared/targets/http';

export { InvalidTargetPayload as InvalidTargetsInput } from '@nexus-terminal/shared/targets/http';

export {
	readConnectionInput as connection,
	readConnectionImportBatch as importBatch,
} from '@nexus-terminal/shared/targets/connections/http-codec';

export { readProxyInput as proxy } from '@nexus-terminal/shared/targets/proxies/http-codec';

export { readSshKeyInput as sshKey } from '@nexus-terminal/shared/targets/ssh-keys/http-codec';

/** URL path parsing remains a backend HTTP concern; numeric bounds are Shared. */
export function urlId(value: string | undefined): number {
	if (!value || !/^[1-9][0-9]{0,14}$/u.test(value)) {
		throw new InvalidTargetPayload();
	}
	return targetNumber(Number(value));
}

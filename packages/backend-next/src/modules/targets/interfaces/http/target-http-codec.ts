import { InvalidTargetPayload, targetNumber } from '@nexus-terminal/shared/targets/http';

/** URL path parsing remains a backend HTTP concern; numeric bounds are Shared. */
export function urlId(value: string | undefined): number {
	if (!value || !/^[1-9][0-9]{0,14}$/u.test(value)) {
		throw new InvalidTargetPayload();
	}
	return targetNumber(Number(value));
}

import { ResidentCache, ResidentCacheClosed } from '../../../../platform/cache/resident-cache.js';
import { AccessFailure } from '../../access-failure.js';
import type { OidcModel } from '../../oidc/model/oidc-model.js';
import type { FactorModel } from '../../factors/model/factor-model.js';
import type { LoginMethods } from './login-options-types.js';

/** Public presentation metadata only; authentication always revalidates current storage. */
export class LoginOptionsModel {
	private readonly cache: ResidentCache<LoginMethods>;

	constructor(oidc: OidcModel, factors: FactorModel) {
		this.cache = new ResidentCache(async () => {
			const oidcLabel = await oidc.provider();
			const hasPasskeys = await factors.hasPasskeys();
			return { oidcLabel, hasPasskeys };
		});
	}

	async read(): Promise<LoginMethods> {
		try {
			const value = await this.cache.read();
			return { oidcLabel: value.oidcLabel, hasPasskeys: value.hasPasskeys };
		} catch (cause) {
			if (cause instanceof ResidentCacheClosed) {
				throw new AccessFailure('factor_unavailable', { cause });
			}
			throw cause;
		}
	}

	invalidate(): void {
		this.cache.invalidate();
	}

	quiesce(): void {
		this.cache.quiesce();
	}

	close(): Promise<void> {
		return this.cache.close();
	}
}

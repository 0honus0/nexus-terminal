import type { SourceAdmissionService } from '../../admission/service/source-admission.js';
import type { AccessService } from '../../authentication/service/access-service.js';
import type { SourceAddressModel } from '../../admission/model/source-address-model.js';
import type { LoginFailurePolicy } from '../../login-failure-policy.js';
import type { OidcModel } from '../model/oidc-model.js';
import type { OidcCallback, OidcSettings, OidcSettingsChange, OidcCompleted, OidcStart } from '../model/oidc-types.js';
import { AccessFailure } from '../../access-failure.js';

export class OidcService {
	constructor(
		private readonly model: OidcModel,
		private readonly access: AccessService,
		private readonly addresses: SourceAddressModel,
		private readonly failurePolicy: LoginFailurePolicy,
		private readonly admission: SourceAdmissionService,
	) {}

	private requireToken(token: string | null): string {
		if (token === null) {
			throw new AccessFailure('unauthenticated');
		}
		return token;
	}

	settings(token: string | null): Promise<OidcSettings> {
		return this.model.settings(this.requireToken(token));
	}

	provider(): Promise<string | null> {
		return this.model.provider();
	}

	async save(token: string | null, password: string, input: OidcSettingsChange): Promise<void> {
		await this.access.provePassword(token, password);
		await this.model.save(this.requireToken(token), input);
	}

	async unbind(token: string | null, password: string, revision: string): Promise<void> {
		await this.access.provePassword(token, password);
		await this.model.unbind(this.requireToken(token), revision);
	}

	private source(source: string): { ip: string; enforce: () => boolean } {
		const address = this.addresses.resolve(source);
		if (address === null) {
			throw new AccessFailure('forbidden');
		}
		return {
			ip: address.ip,

			enforce: () => {
				if (!this.admission.allowsSource(source)) {
					throw new AccessFailure('forbidden');
				}
				return this.failurePolicy.shouldEnforce(address.isInternal);
			},
		};
	}

	async start(
		input: Omit<OidcStart, 'enforceBlock'>,
		password: string | null,
	): Promise<{ cookie: string; authorizationUrl: string }> {
		if (input.purpose === 'binding') {
			await this.access.provePassword(input.token, password ?? '');
		}
		const source = this.source(input.source);
		return this.model.start({
			purpose: input.purpose,
			token: input.token,
			previousCookie: input.previousCookie,
			revision: input.revision,
			redirectUri: input.redirectUri,
			rememberMe: input.rememberMe,
			source: source.ip,
			enforceBlock: source.enforce,
			signal: input.signal,
		});
	}

	finish(
		cookie: string | null,
		token: string | null,
		redirectUri: string,
		input: OidcCallback,
		ip: string,
		signal: AbortSignal,
		purpose: 'login' | 'binding',
	): Promise<OidcCompleted> {
		const source = this.source(ip);
		return this.model.finish(cookie, token, redirectUri, input, source.ip, source.enforce, signal, purpose);
	}

	discard(cookie: string): Promise<void> {
		return this.model.discard(cookie);
	}

	revoke(token: string): Promise<void> {
		return this.access.logout(token);
	}
}

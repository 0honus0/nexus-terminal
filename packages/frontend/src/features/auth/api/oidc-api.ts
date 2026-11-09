import {
	readOidcSettingsRequest,
	readOidcSettingsResponse,
	readOidcBindingRequest,
	readOidcStartRequest,
	readOidcStartResponse,
	readOidcFinishRequest,
	readOidcFinishResponse,
	readOidcChangedResponse,
} from '@nexus-terminal/shared/access/oidc/http-codec';
import { createAccessRequest } from './access-request';
import type { OidcSettings, OidcSettingsChange, OidcCallback } from '../model/oidc-types';

function changed(value: unknown): void {
	readOidcChangedResponse(value);
}

export function createOidcApi() {
	const send = createAccessRequest('/api/v1/auth');
	return {
		async settings(signal: AbortSignal): Promise<OidcSettings> {
			const c = await send({
				method: 'GET',
				path: '/oidc/settings',
				status: 200,
				decode: readOidcSettingsResponse,
				signal,
			});
			return {
				revision: c.revision,
				label: c.label,
				issuer: c.issuer,
				clientId: c.clientId,
				clientAuthentication: c.clientAuthentication,
				hasSecret: c.hasSecret,
				bound: c.bound,
				callbackUrl: c.callbackUrl,
			};
		},

		save(input: OidcSettingsChange, signal: AbortSignal): Promise<void> {
			return send({
				method: 'PUT',
				path: '/oidc/settings',
				status: 200,
				decode: changed,

				input: () =>
					readOidcSettingsRequest({
						revision: input.revision,
						label: input.label,
						issuer: input.issuer,
						clientId: input.clientId,
						clientAuthentication: input.clientAuthentication,
						secret:
							input.secret.action === 'replace'
								? { action: 'replace', value: input.secret.value }
								: { action: input.secret.action },
						password: input.password,
					}),

				signal,
			});
		},

		unbind(revision: string, password: string, signal: AbortSignal): Promise<void> {
			return send({
				method: 'DELETE',
				path: '/oidc/binding',
				status: 200,
				decode: changed,

				input: () => readOidcBindingRequest({ revision, password }),

				signal,
			});
		},

		async bind(revision: string, password: string, signal: AbortSignal): Promise<string> {
			return (
				await send({
					method: 'POST',
					path: '/oidc/binding/start',
					status: 200,
					decode: readOidcStartResponse,

					input: () => readOidcBindingRequest({ revision, password }),

					signal,
				})
			).authorizationUrl;
		},

		async login(rememberMe: boolean, signal: AbortSignal): Promise<string> {
			return (
				await send({
					method: 'POST',
					path: '/oidc/login/start',
					status: 200,
					decode: readOidcStartResponse,

					input: () => readOidcStartRequest({ rememberMe }),

					signal,
				})
			).authorizationUrl;
		},

		async finish(
			purpose: 'login' | 'binding',
			input: OidcCallback,
			signal: AbortSignal,
		): Promise<'login' | 'binding'> {
			return (
				await send({
					method: 'POST',
					path: '/oidc/' + purpose + '/finish',
					status: 200,
					decode: readOidcFinishResponse,

					input: () =>
						readOidcFinishRequest({
							code: input.code,
							state: input.state,
							issuer: input.issuer,
							error: input.error,
						}),

					signal,
				})
			).completed;
		},
	};
}

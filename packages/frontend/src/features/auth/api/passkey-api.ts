import {
	readPasskeyAuthenticationOptions,
	readPasskeyAuthenticate,
	readPasskeyRegister,
	readPasskeyName,
	type AccessPasskeyAuthenticationOptionsResponse,
	type AccessPasskeyRegistrationOptionsResponse,
	type AccessPasskeySummary,
	type AccessPasskeyClientCredential,
	type AccessPasskeyLoginResponse,
	type AccessPasskeyVerifiedResponse,
	type AccessPasskeyRemoveResponse,
	type AccessPasskeyRenameResponse,
} from '@nexus-terminal/shared/access/factors/http';
import {
	readPasskeyAuthenticationResponse,
	readPasskeyRegistrationResponse,
	readPasskeyCredentialId,
	readPasskeyList,
	readPasskeyLogin,
	readPasskeyVerified,
	readPasskeyRemoved,
	readPasskeyRenamed,
} from '@nexus-terminal/shared/access/factors/passkey-codec';
import {
	ACCESS_FACTOR_REQUEST_MAX_BYTES,
	ACCESS_FACTOR_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/access/values';
import type { SendAccessRequest } from './access-request';

export interface PasskeyApi {
	authenticationOptions(username?: string, signal?: AbortSignal): Promise<AccessPasskeyAuthenticationOptionsResponse>;
	registrationOptions(signal?: AbortSignal): Promise<AccessPasskeyRegistrationOptionsResponse>;
	authenticate(
		credential: AccessPasskeyClientCredential,
		rememberMe: boolean,
		signal?: AbortSignal,
	): Promise<AccessPasskeyLoginResponse>;
	register(credential: AccessPasskeyClientCredential, signal?: AbortSignal): Promise<AccessPasskeyVerifiedResponse>;
	list(signal?: AbortSignal): Promise<AccessPasskeySummary[]>;
	rename(id: string, name: string, signal?: AbortSignal): Promise<AccessPasskeyRenameResponse>;
	remove(id: string, signal?: AbortSignal): Promise<AccessPasskeyRemoveResponse>;
}

export function createPasskeyApi(send: SendAccessRequest): PasskeyApi {
	return {
		authenticationOptions: (username, signal) =>
			send({
				method: 'POST',
				path: '/passkey/authentication-options',
				status: 200,
				decode: readPasskeyAuthenticationResponse,

				input: () => {
					const name = readPasskeyAuthenticationOptions(username === undefined ? {} : { username });
					return name === undefined ? {} : { username: name };
				},

				signal,
				maxResponseBytes: ACCESS_FACTOR_RESPONSE_MAX_BYTES,
			}),

		registrationOptions: (signal) =>
			send({
				method: 'POST',
				path: '/passkey/registration-options',
				status: 200,
				decode: readPasskeyRegistrationResponse,

				input: () => ({}),

				signal,
				maxResponseBytes: ACCESS_FACTOR_RESPONSE_MAX_BYTES,
			}),

		authenticate: (credential, rememberMe, signal) =>
			send({
				method: 'POST',
				path: '/passkey/authenticate',
				status: 200,
				decode: readPasskeyLogin,

				input: () => {
					const input = readPasskeyAuthenticate({ assertionResponse: credential, rememberMe });
					return { assertionResponse: input.response, rememberMe: input.rememberMe };
				},

				signal,
				maxRequestBytes: ACCESS_FACTOR_REQUEST_MAX_BYTES,
			}),

		register: (credential, signal) =>
			send({
				method: 'POST',
				path: '/passkey/register',
				status: 201,

				decode: (value) => {
					const result = readPasskeyVerified(value);
					if (!result.verified) {
						throw new Error('Invalid registration success');
					}
					return { verified: result.verified };
				},

				input: () => ({ registrationResponse: readPasskeyRegister({ registrationResponse: credential }) }),

				signal,
				maxRequestBytes: ACCESS_FACTOR_REQUEST_MAX_BYTES,

				refused: (status, value) => {
					if (
						status === 400 &&
						value !== null &&
						typeof value === 'object' &&
						Object.hasOwn(value, 'verified') &&
						readPasskeyVerified(value).verified === false
					) {
						return 'invalid_credentials';
					}
					return null;
				},
			}),

		list: (signal) =>
			send({
				method: 'GET',
				path: '/user/passkeys',
				status: 200,
				decode: readPasskeyList,
				signal,
				maxResponseBytes: ACCESS_FACTOR_RESPONSE_MAX_BYTES,
			}),

		rename: (id, name, signal) =>
			send({
				method: 'PUT',
				path: '/user/passkeys/' + encodeURIComponent(id) + '/name',
				status: 200,
				decode: readPasskeyRenamed,

				input: () => {
					readPasskeyCredentialId(id);
					return { name: readPasskeyName({ name }) };
				},

				signal,
			}),

		remove: (id, signal) =>
			send({
				method: 'DELETE',
				path: '/user/passkeys/' + encodeURIComponent(id),
				status: 200,
				decode: readPasskeyRemoved,

				input: () => {
					readPasskeyCredentialId(id);
					return undefined;
				},

				signal,
			}),
	};
}

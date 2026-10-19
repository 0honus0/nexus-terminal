import {
	startAuthentication,
	startRegistration,
	WebAuthnAbortService,
	WebAuthnError,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type AuthenticatorTransport,
	type ResidentKeyRequirement,
	type AttestationConveyancePreference,
} from '@simplewebauthn/browser';
import {
	readPasskeyCredential,
	type AccessPasskeyClientCredential,
	type AccessPasskeyRegistrationOptionsResponse,
	type AccessPasskeyAuthenticationOptionsResponse,
} from '@nexus-terminal/shared/access/factors/http';
import { AuthRequestFailure } from '../model/auth-failure';

export interface PasskeyCeremony {
	register(
		options: AccessPasskeyRegistrationOptionsResponse,
		signal: AbortSignal,
	): Promise<AccessPasskeyClientCredential>;
	authenticate(
		options: AccessPasskeyAuthenticationOptionsResponse,
		signal: AbortSignal,
	): Promise<AccessPasskeyClientCredential>;
}

let activeCeremony: symbol | null = null;

function transport(value: string): AuthenticatorTransport {
	if (value === 'ble' || value === 'hybrid' || value === 'internal' || value === 'nfc' || value === 'usb') {
		return value;
	}
	throw new AuthRequestFailure('protocol_failure', 'not_dispatched');
}

function residentKey(value: string | undefined): ResidentKeyRequirement | undefined {
	if (value === undefined || value === 'required' || value === 'preferred' || value === 'discouraged') {
		return value;
	}
	throw new AuthRequestFailure('protocol_failure', 'not_dispatched');
}

function attestation(value: string | undefined): AttestationConveyancePreference | undefined {
	if (
		value === undefined ||
		value === 'none' ||
		value === 'direct' ||
		value === 'indirect' ||
		value === 'enterprise'
	) {
		return value;
	}
	throw new AuthRequestFailure('protocol_failure', 'not_dispatched');
}

function toDescriptors(value: Array<{ type: 'public-key'; id: string; transports?: string[] }> | undefined) {
	return value?.map((entry) => ({ type: entry.type, id: entry.id, transports: entry.transports?.map(transport) }));
}

function toRegistration(value: AccessPasskeyRegistrationOptionsResponse): PublicKeyCredentialCreationOptionsJSON {
	const selection = value.authenticatorSelection;
	if (
		selection?.userVerification !== 'required' ||
		(selection.authenticatorAttachment !== undefined &&
			selection.authenticatorAttachment !== 'platform' &&
			selection.authenticatorAttachment !== 'cross-platform')
	) {
		throw new AuthRequestFailure('protocol_failure', 'not_dispatched');
	}
	return {
		challenge: value.challenge,
		rp: { name: value.rp.name, id: value.rp.id },
		user: { id: value.user.id, name: value.user.name, displayName: value.user.displayName },
		pubKeyCredParams: value.pubKeyCredParams.map((parameter) => ({ type: parameter.type, alg: parameter.alg })),
		timeout: value.timeout,
		excludeCredentials: toDescriptors(value.excludeCredentials),
		attestation: attestation(value.attestation),
		authenticatorSelection: {
			residentKey: residentKey(selection.residentKey),
			userVerification: selection.userVerification,
			authenticatorAttachment: selection.authenticatorAttachment,
			requireResidentKey: selection.requireResidentKey,
		},
		extensions: value.extensions === undefined ? undefined : { credProps: value.extensions.credProps },
	};
}

function toAuthentication(value: AccessPasskeyAuthenticationOptionsResponse): PublicKeyCredentialRequestOptionsJSON {
	if (value.userVerification !== 'required') {
		throw new AuthRequestFailure('protocol_failure', 'not_dispatched');
	}
	return {
		challenge: value.challenge,
		timeout: value.timeout,
		rpId: value.rpId,
		allowCredentials: toDescriptors(value.allowCredentials),
		userVerification: value.userVerification,
	};
}

async function perform<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
	if (signal.aborted) {
		throw new AuthRequestFailure('cancelled', 'not_dispatched');
	}
	const owner = Symbol('passkey-ceremony');
	activeCeremony = owner;

	const cancel = (): void => {
		// The library shares one abort service; an old owner must never cancel its successor.
		if (activeCeremony === owner) {
			WebAuthnAbortService.cancelCeremony();
		}
	};

	signal.addEventListener('abort', cancel, { once: true });
	try {
		const result = await work();
		if (signal.aborted || activeCeremony !== owner) {
			throw new AuthRequestFailure('cancelled', 'not_dispatched');
		}
		return result;
	} catch (cause) {
		if (cause instanceof AuthRequestFailure) {
			throw cause;
		}
		const cancelled =
			signal.aborted ||
			(cause instanceof WebAuthnError && cause.code === 'ERROR_CEREMONY_ABORTED') ||
			(cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'NotAllowedError'));
		throw new AuthRequestFailure(cancelled ? 'cancelled' : 'factor_unavailable', 'not_dispatched', null, { cause });
	} finally {
		signal.removeEventListener('abort', cancel);
		if (activeCeremony === owner) {
			activeCeremony = null;
		}
	}
}

export function createPasskeyCeremony(): PasskeyCeremony {
	return {
		register: (options, signal) =>
			perform(signal, async () => {
				const result = await startRegistration({ optionsJSON: toRegistration(options) });
				return readPasskeyCredential(
					{
						id: result.id,
						rawId: result.rawId,
						type: result.type,
						response: {
							clientDataJSON: result.response.clientDataJSON,
							attestationObject: result.response.attestationObject,
							authenticatorData: result.response.authenticatorData,
							transports: result.response.transports?.map((entry) => entry),
							publicKeyAlgorithm: result.response.publicKeyAlgorithm,
							publicKey: result.response.publicKey,
						},
						authenticatorAttachment: result.authenticatorAttachment,
						clientExtensionResults: {
							credProps:
								result.clientExtensionResults.credProps === undefined
									? undefined
									: { rk: result.clientExtensionResults.credProps.rk },
						},
					},
					'registration',
				);
			}),

		authenticate: (options, signal) =>
			perform(signal, async () => {
				const result = await startAuthentication({ optionsJSON: toAuthentication(options) });
				return readPasskeyCredential(
					{
						id: result.id,
						rawId: result.rawId,
						type: result.type,
						response: {
							clientDataJSON: result.response.clientDataJSON,
							authenticatorData: result.response.authenticatorData,
							signature: result.response.signature,
							userHandle: result.response.userHandle,
						},
						authenticatorAttachment: result.authenticatorAttachment,
						clientExtensionResults: {},
					},
					'authentication',
				);
			}),
	};
}

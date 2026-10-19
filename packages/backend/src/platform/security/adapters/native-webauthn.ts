import { createHash } from 'node:crypto';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
	AuthenticationResponseJSON,
	RegistrationResponseJSON,
	AuthenticatorTransport,
} from '@simplewebauthn/server';
import { WebauthnTechnicalFailure } from '../webauthn-port.js';
import type {
	WebauthnPort,
	WebauthnResponse,
	WebauthnRegisteredKey,
	WebauthnPublicKey,
	WebauthnRelyingParty,
	WebauthnRegistrationOptions,
	WebauthnAuthenticationOptions,
} from '../webauthn-port.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBase64url(value: string): boolean {
	return /^[A-Za-z0-9_-]+$/u.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function isExpectedClientData(
	response: { response: { clientDataJSON: string } },
	challenge: string,
	origin: string,
	type: 'webauthn.create' | 'webauthn.get',
): boolean {
	const encoded = response.response.clientDataJSON;
	if (!isBase64url(encoded) || encoded.length > 96_000) {
		return false;
	}
	try {
		const json: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
		if (!isRecord(json)) {
			return false;
		}
		const data = json;
		return (
			data.type === type &&
			data.challenge === challenge &&
			data.origin === origin &&
			(data.crossOrigin === undefined || data.crossOrigin === false) &&
			data.topOrigin === undefined
		);
	} catch {
		// A malformed clientDataJSON is a definite invalid assertion, not a provider outage.
		return false;
	}
}

function isExpectedAssertionData(authenticatorData: string, rpId: string, previousCounter: number): boolean {
	if (!isBase64url(authenticatorData)) {
		return false;
	}
	const bytes = Buffer.from(authenticatorData, 'base64url');
	if (bytes.length < 37) {
		return false;
	}
	const expectedRpHash = createHash('sha256').update(rpId).digest();
	const flags = bytes[32] ?? 0;
	const counter = bytes.readUInt32BE(33);
	const validCounter = (previousCounter === 0 && counter === 0) || counter > previousCounter;
	return bytes.subarray(0, 32).equals(expectedRpHash) && (flags & 0x05) === 0x05 && validCounter;
}

function toRegistrationOptions(
	options: Awaited<ReturnType<typeof generateRegistrationOptions>>,
): WebauthnRegistrationOptions {
	const result: WebauthnRegistrationOptions = {
		challenge: options.challenge,
		timeout: options.timeout,
		rp: { name: options.rp.name, id: options.rp.id },
		user: { id: options.user.id, name: options.user.name, displayName: options.user.displayName },
		pubKeyCredParams: options.pubKeyCredParams.map((item) => ({ type: 'public-key', alg: item.alg })),
		excludeCredentials: options.excludeCredentials?.map((item) => ({
			type: 'public-key',
			id: item.id,
			transports: item.transports?.map((transport) => transport),
		})),
		attestation: options.attestation,
		extensions:
			options.extensions?.credProps === undefined ? undefined : { credProps: options.extensions.credProps },
	};
	if (options.authenticatorSelection !== undefined) {
		result.authenticatorSelection = {
			residentKey: options.authenticatorSelection.residentKey,
			userVerification: options.authenticatorSelection.userVerification,
			authenticatorAttachment: options.authenticatorSelection.authenticatorAttachment,
			requireResidentKey: options.authenticatorSelection.requireResidentKey,
		};
	}
	return result;
}

function toAuthenticationOptions(
	options: Awaited<ReturnType<typeof generateAuthenticationOptions>>,
): WebauthnAuthenticationOptions {
	return {
		challenge: options.challenge,
		timeout: options.timeout,
		rpId: options.rpId,
		userVerification: options.userVerification,
		allowCredentials: options.allowCredentials?.map((item) => ({
			type: 'public-key',
			id: item.id,
			transports: item.transports?.map((transport) => transport),
		})),
	};
}

function toTransports(values: readonly string[]): AuthenticatorTransport[] {
	return values.filter(
		(value): value is AuthenticatorTransport =>
			value === 'ble' ||
			value === 'hybrid' ||
			value === 'internal' ||
			value === 'nfc' ||
			value === 'usb' ||
			value === 'cable' ||
			value === 'smart-card',
	);
}

export class NativeWebauthn implements WebauthnPort {
	async registrationOptions(input: {
		rp: WebauthnRelyingParty;
		displayName: string;
		relyingPartyName: string;
		userId: string;
		excluded: { id: string; transports: string[] }[];
	}): Promise<WebauthnRegistrationOptions> {
		const options = await generateRegistrationOptions({
			rpName: input.relyingPartyName,
			rpID: input.rp.rpId,
			userID: new TextEncoder().encode(input.userId),
			userName: input.displayName,
			userDisplayName: input.displayName,
			timeout: 60_000,
			attestationType: 'none',
			excludeCredentials: input.excluded.map((item) => ({
				id: item.id,
				transports: toTransports(item.transports),
			})),
			authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
			supportedAlgorithmIDs: [-7, -257],
		});
		return toRegistrationOptions(options);
	}

	async authenticationOptions(input: {
		rp: WebauthnRelyingParty;
		allowed: { id: string; transports: string[] }[] | null;
	}): Promise<WebauthnAuthenticationOptions> {
		const requestOptions: Parameters<typeof generateAuthenticationOptions>[0] = {
			rpID: input.rp.rpId,
			timeout: 60_000,
			userVerification: 'required',
		};
		if (input.allowed !== null) {
			requestOptions.allowCredentials = input.allowed.map((item) => ({
				id: item.id,
				transports: toTransports(item.transports),
			}));
		}
		const options = await generateAuthenticationOptions(requestOptions);
		return toAuthenticationOptions(options);
	}

	async registrationVerify(input: {
		rp: WebauthnRelyingParty;
		challenge: string;
		response: WebauthnResponse;
	}): Promise<WebauthnRegisteredKey | null> {
		const evidence = input.response;
		if (
			evidence.id !== evidence.rawId ||
			!isBase64url(evidence.id) ||
			evidence.response.attestationObject === undefined
		) {
			return null;
		}
		const response: RegistrationResponseJSON = {
			id: evidence.id,
			rawId: evidence.rawId,
			type: evidence.type,
			response: {
				clientDataJSON: evidence.response.clientDataJSON,
				attestationObject: evidence.response.attestationObject,
				authenticatorData: evidence.response.authenticatorData,
				transports:
					evidence.response.transports === undefined ? undefined : toTransports(evidence.response.transports),
				publicKeyAlgorithm: evidence.response.publicKeyAlgorithm,
				publicKey: evidence.response.publicKey,
			},
			authenticatorAttachment: evidence.authenticatorAttachment ?? undefined,
			clientExtensionResults: {
				credProps:
					evidence.clientExtensionResults.credProps === undefined
						? undefined
						: { rk: evidence.clientExtensionResults.credProps.rk },
			},
		};
		if (
			!isExpectedClientData(response, input.challenge, input.rp.origin, 'webauthn.create') ||
			!isBase64url(response.response.attestationObject)
		) {
			return null;
		}
		let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
		try {
			result = await verifyRegistrationResponse({
				response,
				expectedChallenge: input.challenge,
				expectedOrigin: input.rp.origin,
				expectedRPID: input.rp.rpId,
				requireUserVerification: true,
			});
		} catch (cause) {
			// Vendor exceptions include ambiguous cryptographic and provider failures.
			// Fail closed as unavailable instead of falsely recording a bad password attempt.
			throw new WebauthnTechnicalFailure(cause);
		}
		if (!result.verified || !result.registrationInfo) {
			return null;
		}
		const { credential, credentialBackedUp } = result.registrationInfo;
		return {
			id: credential.id,
			publicKeyBase64: Buffer.from(credential.publicKey).toString('base64'),
			counter: credential.counter,
			transports: credential.transports ?? [],
			backedUp: credentialBackedUp,
		};
	}

	async authenticationVerify(input: {
		rp: WebauthnRelyingParty;
		challenge: string;
		response: WebauthnResponse;
		key: WebauthnPublicKey;
	}): Promise<number | null> {
		const evidence = input.response;
		if (
			evidence.id !== evidence.rawId ||
			!isBase64url(evidence.id) ||
			evidence.response.authenticatorData === undefined ||
			evidence.response.signature === undefined
		) {
			return null;
		}
		const response: AuthenticationResponseJSON = {
			id: evidence.id,
			rawId: evidence.rawId,
			type: evidence.type,
			response: {
				clientDataJSON: evidence.response.clientDataJSON,
				authenticatorData: evidence.response.authenticatorData,
				signature: evidence.response.signature,
				userHandle: evidence.response.userHandle ?? undefined,
			},
			authenticatorAttachment: evidence.authenticatorAttachment ?? undefined,
			clientExtensionResults: {
				credProps:
					evidence.clientExtensionResults.credProps === undefined
						? undefined
						: { rk: evidence.clientExtensionResults.credProps.rk },
			},
		};
		if (
			response.id !== input.key.id ||
			!isBase64url(response.response.signature) ||
			!isExpectedClientData(response, input.challenge, input.rp.origin, 'webauthn.get') ||
			!isExpectedAssertionData(response.response.authenticatorData, input.rp.rpId, input.key.counter)
		) {
			return null;
		}
		let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
		try {
			result = await verifyAuthenticationResponse({
				response,
				expectedChallenge: input.challenge,
				expectedOrigin: input.rp.origin,
				expectedRPID: input.rp.rpId,
				credential: {
					id: input.key.id,
					publicKey: Uint8Array.from(Buffer.from(input.key.publicKeyBase64, 'base64')),
					counter: input.key.counter,
					transports: toTransports(input.key.transports),
				},
				requireUserVerification: true,
			});
		} catch (cause) {
			throw new WebauthnTechnicalFailure(cause);
		}
		return result.verified ? result.authenticationInfo.newCounter : null;
	}
}

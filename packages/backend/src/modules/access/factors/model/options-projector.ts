import { AccessFailure } from '../../access-failure.js';
import type {
	WebauthnOptions,
	WebauthnRegistrationOptions,
	WebauthnAuthenticationOptions,
} from '../../../../platform/security/webauthn-port.js';
import type { FactorWebauthnOptions } from './factor-types.js';

function toDescriptors(input: WebauthnOptions['allowCredentials']): FactorWebauthnOptions['allowCredentials'] {
	return input?.map((item) => ({
		type: item.type,
		id: item.id,
		transports: item.transports?.map((transport) => transport),
	}));
}

function toCommonFactorOptions(options: WebauthnOptions): FactorWebauthnOptions {
	if (!options.challenge || options.challenge.length > 2048) {
		throw new AccessFailure('internal_failure');
	}
	return {
		challenge: options.challenge,
		timeout: options.timeout,
		userVerification: options.userVerification,
		rpId: options.rpId,
		excludeCredentials: toDescriptors(options.excludeCredentials),
		allowCredentials: toDescriptors(options.allowCredentials),
		extensions: options.extensions === undefined ? undefined : { credProps: options.extensions.credProps },
	};
}

/** Explicit technology-to-application projections, with distinct creation/request option contracts. */
export function toRegistrationFactorOptions(options: WebauthnRegistrationOptions): FactorWebauthnOptions {
	const result = toCommonFactorOptions(options);
	result.rp = { name: options.rp.name, id: options.rp.id };
	result.user = {
		id: options.user.id,
		name: options.user.name,
		displayName: options.user.displayName,
	};
	result.pubKeyCredParams = options.pubKeyCredParams.map((item) => ({
		type: item.type,
		alg: item.alg,
	}));
	result.attestation = options.attestation;
	if (options.authenticatorSelection !== undefined) {
		const selection = options.authenticatorSelection;
		result.authenticatorSelection = {
			residentKey: selection.residentKey,
			userVerification: selection.userVerification,
			authenticatorAttachment: selection.authenticatorAttachment,
			requireResidentKey: selection.requireResidentKey,
		};
	}
	return result;
}

export function toAuthenticationFactorOptions(options: WebauthnAuthenticationOptions): FactorWebauthnOptions {
	return toCommonFactorOptions(options);
}

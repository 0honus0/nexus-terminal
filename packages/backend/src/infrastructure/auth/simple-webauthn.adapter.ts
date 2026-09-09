import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { PasskeyTransport } from '../../modules/passkey/passkey.types';
import type {
  GenerateAuthenticationOptionsRequest,
  GenerateRegistrationOptionsRequest,
  VerifyAuthenticationRequest,
  VerifyRegistrationRequest,
  WebAuthnProvider,
} from '../../modules/passkey/webauthn-provider.port';

export interface PasskeyRelyingPartyConfig {
  rpId: string;
  origin: string;
}
export interface SimpleWebAuthnAdapterOptions {
  appName: string;
  relyingParties: readonly PasskeyRelyingPartyConfig[];
}

const PASSKEY_TRANSPORTS = new Set<PasskeyTransport>([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);
const toLibraryTransports = (transports: readonly PasskeyTransport[]): string[] => [...transports];
const toDomainTransports = (transports: readonly string[] | undefined): PasskeyTransport[] =>
  transports?.filter((transport): transport is PasskeyTransport =>
    PASSKEY_TRANSPORTS.has(transport as PasskeyTransport),
  ) ?? [];

export class SimpleWebAuthnAdapter implements WebAuthnProvider {
  constructor(private readonly options: SimpleWebAuthnAdapterOptions) {
    if (!options.relyingParties.length) throw new Error('At least one passkey relying party is required.');
  }
  async generateRegistrationOptions(request: GenerateRegistrationOptionsRequest) {
    const rp = this.resolveRp(request.origin);
    const result = await generateRegistrationOptions({
      rpName: this.options.appName,
      rpID: rp.rpId,
      userID: new TextEncoder().encode(String(request.userId)),
      userName: request.username,
      userDisplayName: request.username,
      timeout: 60_000,
      attestationType: 'none',
      excludeCredentials: request.existingCredentials.map((c) => ({
        id: c.credentialId,
        transports: toLibraryTransports(c.transports),
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      supportedAlgorithmIDs: [-7, -257],
    });
    return result;
  }
  async verifyRegistration(request: VerifyRegistrationRequest) {
    const rp = this.resolveRp(request.origin);
    const verification = await verifyRegistrationResponse({
      response: request.response as RegistrationResponseJSON,
      expectedChallenge: request.expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return { verified: false };
    const { credential, credentialBackedUp } = verification.registrationInfo;
    return {
      verified: true,
      credential: {
        credentialId: credential.id,
        publicKeyBase64: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: toDomainTransports(credential.transports),
        backedUp: credentialBackedUp,
      },
    };
  }
  async generateAuthenticationOptions(request: GenerateAuthenticationOptionsRequest) {
    const rp = this.resolveRp(request.origin);
    return generateAuthenticationOptions({
      rpID: rp.rpId,
      timeout: 60_000,
      allowCredentials: request.credentials?.map((c) => ({
        id: c.credentialId,
        transports: toLibraryTransports(c.transports),
      })),
      userVerification: 'preferred',
    });
  }
  async verifyAuthentication(request: VerifyAuthenticationRequest) {
    const rp = this.resolveRp(request.origin);
    const verification = await verifyAuthenticationResponse({
      response: request.response as AuthenticationResponseJSON,
      expectedChallenge: request.expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      credential: {
        id: request.credential.credentialId,
        publicKey: Uint8Array.from(Buffer.from(request.credential.publicKeyBase64, 'base64')),
        counter: request.credential.counter,
        transports: toLibraryTransports(request.credential.transports),
      },
      requireUserVerification: true,
    });
    return {
      verified: verification.verified,
      ...(verification.verified ? { newCounter: verification.authenticationInfo.newCounter } : {}),
    };
  }
  credentialIdFromAuthenticationResponse(response: unknown): string | null {
    if (!response || typeof response !== 'object') return null;
    const id = (response as { id?: unknown }).id;
    return typeof id === 'string' && id ? id : null;
  }
  private resolveRp(requestOrigin?: string): PasskeyRelyingPartyConfig {
    if (!requestOrigin) return this.options.relyingParties[0]!;
    let normalized: string;
    try {
      normalized = new URL(requestOrigin).origin;
    } catch {
      throw new Error('Invalid passkey origin.');
    }
    const matched = this.options.relyingParties.find((item) => item.origin === normalized);
    if (!matched) throw new Error('Passkey origin is not configured.');
    return matched;
  }
}

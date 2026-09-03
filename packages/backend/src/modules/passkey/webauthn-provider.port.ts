import type {
  PasskeyAuthenticationResult,
  PasskeyCredential,
  PasskeyOptions,
  PasskeyRegistrationCredential,
} from './passkey.types';

export interface GenerateRegistrationOptionsRequest {
  userId: number;
  username: string;
  origin?: string;
  existingCredentials: readonly Pick<PasskeyCredential, 'credentialId' | 'transports'>[];
}

export interface VerifyRegistrationRequest {
  response: unknown;
  expectedChallenge: string;
  origin?: string;
}

export interface GenerateAuthenticationOptionsRequest {
  origin?: string;
  credentials?: readonly Pick<PasskeyCredential, 'credentialId' | 'transports'>[];
}

export interface VerifyAuthenticationRequest {
  response: unknown;
  expectedChallenge: string;
  origin?: string;
  credential: Pick<PasskeyCredential, 'credentialId' | 'publicKeyBase64' | 'counter' | 'transports'>;
}

export interface WebAuthnProvider {
  generateRegistrationOptions(request: GenerateRegistrationOptionsRequest): Promise<PasskeyOptions>;
  verifyRegistration(
    request: VerifyRegistrationRequest,
  ): Promise<{ verified: boolean; credential?: PasskeyRegistrationCredential }>;
  generateAuthenticationOptions(request: GenerateAuthenticationOptionsRequest): Promise<PasskeyOptions>;
  verifyAuthentication(request: VerifyAuthenticationRequest): Promise<PasskeyAuthenticationResult>;
  credentialIdFromAuthenticationResponse(response: unknown): string | null;
}

import {
  generateRegistrationOptions as generateRegOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions as generateAuthOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  GenerateRegistrationOptionsOpts,
  GenerateAuthenticationOptionsOpts,
  VerifyRegistrationResponseOpts,
  VerifyAuthenticationResponseOpts,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { passkeyRepository, Passkey, NewPasskey } from './passkey.repository';
import { userRepository, User } from '../user/user.repository';
import { config, type PasskeyRpConfig } from '../config/app.config';

const RP_NAME = config.appName;

const textEncoder = new TextEncoder();

function base64UrlToUint8Array(base64urlString: string): Uint8Array {
  const base64 = base64urlString.replace(/-/g, '+').replace(/_/g, '/');
  // Buffer.from will handle padding correctly for base64
  try {
    return Buffer.from(base64, 'base64');
  } catch (e) {
    console.error('Failed to decode base64url string to Buffer:', base64urlString, e);
    throw new Error('Invalid base64url string for Buffer conversion');
  }
}

export class PasskeyService {
  constructor(
    private passkeyRepo: typeof passkeyRepository,
    private userRepo: typeof userRepository,
  ) {}

  private resolveRpConfig(requestOrigin?: string): PasskeyRpConfig {
    const configs =
      config.passkeyRpConfigs.length > 0 ? config.passkeyRpConfigs : [{ rpId: config.rpId, rpOrigin: config.rpOrigin }];

    if (!requestOrigin) return configs[0];

    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(requestOrigin).origin;
    } catch {
      throw new Error('Invalid passkey origin.');
    }

    const matchedConfig = configs.find((item) => item.rpOrigin === normalizedOrigin);
    if (!matchedConfig) throw new Error('Passkey origin is not configured.');
    return matchedConfig;
  }

  async generateRegistrationOptions(username: string, userId: number, requestOrigin?: string) {
    const user = await this.userRepo.findUserById(userId);
    if (!user || user.username !== username) {
      throw new Error('User not found or username mismatch');
    }

    const existingPasskeys = await this.passkeyRepo.getPasskeysByUserId(userId);

    const excludeCredentials: { id: string; type: 'public-key'; transports?: AuthenticatorTransportFuture[] }[] =
      existingPasskeys.map((pk) => ({
        id: pk.credential_id,
        type: 'public-key',
        transports: pk.transports ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[]) : undefined,
      }));

    const rpConfig = this.resolveRpConfig(requestOrigin);
    const options: GenerateRegistrationOptionsOpts = {
      rpName: RP_NAME,
      rpID: rpConfig.rpId,
      userID: textEncoder.encode(userId.toString()),
      userName: username,
      userDisplayName: username,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      supportedAlgorithmIDs: [-7, -257],
    };

    const generatedOptions = await generateRegOptions(options);
    return generatedOptions;
  }

  async verifyRegistration(
    registrationResponseJSON: RegistrationResponseJSON,
    expectedChallenge: string,
    userHandleFromClient: string,
    requestOrigin?: string,
  ): Promise<VerifiedRegistrationResponse & { newPasskeyToSave?: NewPasskey }> {
    const userId = parseInt(userHandleFromClient, 10);
    if (isNaN(userId)) {
      throw new Error('Invalid user handle provided.');
    }
    const user = await this.userRepo.findUserById(userId);
    if (!user) {
      throw new Error('User not found for the provided handle.');
    }

    if (!registrationResponseJSON.id) {
      console.error('Missing credential ID in registration response from client:', registrationResponseJSON);
      throw new Error('Registration failed: Missing or malformed credential ID from client.');
    }

    const rpConfig = this.resolveRpConfig(requestOrigin);
    const verifyOpts: VerifyRegistrationResponseOpts = {
      response: registrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rpConfig.rpOrigin,
      expectedRPID: rpConfig.rpId,
      requireUserVerification: true,
    };

    const verification = await verifyRegistrationResponse(verifyOpts);

    if (verification.verified && verification.registrationInfo) {
      const { credential, credentialBackedUp } = verification.registrationInfo;

      const publicKeyBase64 = Buffer.from(credential.publicKey).toString('base64');

      const newPasskeyEntry: NewPasskey = {
        user_id: user.id,
        credential_id: credential.id,
        public_key: publicKeyBase64,
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        backed_up: credentialBackedUp,
      };
      return { ...verification, newPasskeyToSave: newPasskeyEntry };
    }
    return verification;
  }

  async generateAuthenticationOptions(username?: string, requestOrigin?: string) {
    let allowCredentials:
      { id: string; type: 'public-key'; transports?: AuthenticatorTransportFuture[] }[] | undefined = undefined;

    if (username) {
      const user = await this.userRepo.findUserByUsername(username);
      if (user) {
        const userPasskeys = await this.passkeyRepo.getPasskeysByUserId(user.id);
        allowCredentials = userPasskeys.map((pk) => ({
          id: pk.credential_id,
          type: 'public-key',
          transports: pk.transports ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[]) : undefined,
        }));
      }
    }

    const rpConfig = this.resolveRpConfig(requestOrigin);
    const options: GenerateAuthenticationOptionsOpts = {
      rpID: rpConfig.rpId,
      timeout: 60000,
      allowCredentials,
      userVerification: 'preferred',
    };

    const generatedOptions = await generateAuthOptions(options);
    return generatedOptions;
  }

  async verifyAuthentication(
    authenticationResponseJSON: AuthenticationResponseJSON,
    expectedChallenge: string,
    requestOrigin?: string,
  ): Promise<VerifiedAuthenticationResponse & { passkey?: Passkey; userId?: number }> {
    // Decode and check authenticatorData length
    if (authenticationResponseJSON.response && authenticationResponseJSON.response.authenticatorData) {
      try {
        const authenticatorDataBytes = base64UrlToUint8Array(authenticationResponseJSON.response.authenticatorData);
        if (authenticatorDataBytes.length < 37) {
          // console.warn(`[PasskeyService] WARNING: Decoded authenticatorData length (${authenticatorDataBytes.length} bytes) is less than the expected minimum of 37 bytes. This may lead to CBOR parsing errors and subsequent failures (e.g., 'cannot read counter').`);
        }
      } catch (error: unknown) {
        console.error(
          '[PasskeyService] Error decoding authenticatorData from client response:',
          error instanceof Error ? error.message : String(error),
        );
        // Potentially re-throw or handle as a critical error, as this is unexpected.
      }
    } else {
      console.warn('[PasskeyService] authenticatorData is missing in the client response.');
    }

    const credentialIdFromResponse = authenticationResponseJSON.id;
    if (!credentialIdFromResponse) {
      console.error('[PasskeyService] Credential ID missing from authentication response.');
      throw new Error('Credential ID missing from authentication response.');
    }

    const passkey = await this.passkeyRepo.getPasskeyByCredentialId(credentialIdFromResponse);
    if (!passkey) {
      console.error('[PasskeyService] Passkey not found for credential ID:', credentialIdFromResponse);
      throw new Error('Authentication failed. Passkey not found.');
    }

    let authenticatorPublicKey: Uint8Array<ArrayBuffer>;
    try {
      const pkBuffer = Buffer.from(passkey.public_key, 'base64');
      authenticatorPublicKey = Uint8Array.from(pkBuffer);
    } catch (error: unknown) {
      console.error(
        '[PasskeyService] Error decoding public_key to Uint8Array:',
        passkey.public_key,
        error instanceof Error ? error.message : String(error),
      );
      throw new Error('Failed to decode public_key.');
    }

    let authenticatorTransports: AuthenticatorTransportFuture[] | undefined;
    try {
      authenticatorTransports = passkey.transports ? JSON.parse(passkey.transports) : undefined;
    } catch (error: unknown) {
      console.error(
        '[PasskeyService] Error parsing transports JSON:',
        passkey.transports,
        error instanceof Error ? error.message : String(error),
      );
      authenticatorTransports = undefined;
    }

    const credential = {
      id: passkey.credential_id,
      publicKey: authenticatorPublicKey,
      counter: passkey.counter,
      transports: authenticatorTransports,
    };

    const rpConfig = this.resolveRpConfig(requestOrigin);
    const verifyOpts: VerifyAuthenticationResponseOpts = {
      response: authenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: rpConfig.rpOrigin,
      expectedRPID: rpConfig.rpId,
      credential,
      requireUserVerification: true,
    };

    const verification = await verifyAuthenticationResponse(verifyOpts);

    if (verification.verified && verification.authenticationInfo) {
      const authInfo = verification.authenticationInfo;
      await this.passkeyRepo.updatePasskeyCounter(passkey.credential_id, authInfo.newCounter);
      await this.passkeyRepo.updatePasskeyLastUsedAt(passkey.credential_id);
      return { ...verification, passkey, userId: passkey.user_id };
    }
    throw new Error('Authentication failed.');
  }

  async listPasskeysByUserId(userId: number): Promise<Partial<Passkey>[]> {
    const passkeys = await this.passkeyRepo.getPasskeysByUserId(userId);
    // 只返回部分信息以避免泄露敏感数据
    return passkeys.map((pk) => ({
      credential_id: pk.credential_id,
      created_at: pk.created_at,
      last_used_at: pk.last_used_at,
      transports: pk.transports ? JSON.parse(pk.transports) : undefined,
      name: pk.name, // <-- 添加 name 字段
    }));
  }

  async deletePasskey(userId: number, credentialID: string): Promise<boolean> {
    const passkey = await this.passkeyRepo.getPasskeyByCredentialId(credentialID);
    if (!passkey) {
      throw new Error('Passkey not found.');
    }
    if (passkey.user_id !== userId) {
      // 安全措施：用户只能删除自己的 Passkey
      throw new Error('Unauthorized to delete this passkey.');
    }
    const wasDeleted = await this.passkeyRepo.deletePasskey(credentialID);
    return wasDeleted;
  }

  async updatePasskeyName(userId: number, credentialID: string, newName: string): Promise<void> {
    const passkey = await this.passkeyRepo.getPasskeyByCredentialId(credentialID);
    if (!passkey) {
      throw new Error('Passkey not found.');
    }
    if (passkey.user_id !== userId) {
      // Security measure: User can only update their own passkey names
      throw new Error('Unauthorized to update this passkey name.');
    }
    await this.passkeyRepo.updatePasskeyName(credentialID, newName);
  }

  async hasPasskeysConfigured(username?: string): Promise<boolean> {
    if (username) {
      const user = await this.userRepo.findUserByUsername(username);
      if (!user) {
        return false; // 如果提供了用户名但用户不存在，则认为没有配置 passkey
      }
      const passkeys = await this.passkeyRepo.getPasskeysByUserId(user.id);
      return passkeys.length > 0;
    } else {
      // 如果没有提供用户名，检查整个系统中是否存在任何 passkey
      // 这对于“可发现凭证”场景可能有用，或者简单地检查系统是否启用了 passkey 功能
      const anyPasskey = await this.passkeyRepo.getFirstPasskey();
      return !!anyPasskey;
    }
  }
}

export const passkeyService = new PasskeyService(passkeyRepository, userRepository);

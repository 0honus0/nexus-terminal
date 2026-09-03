import type { AuditLogService } from '../audit/audit.service';
import type { NotificationService } from '../notifications/notification.service';
import type { UserService } from '../user/user.service';
import type { PasskeyRepository } from './passkey.repository.port';
import type { PasskeyOptions, PasskeySummary } from './passkey.types';
import type { WebAuthnProvider } from './webauthn-provider.port';

export interface PasskeyRegistrationContext {
  userId: number;
  username: string;
  origin?: string;
}

export interface PasskeyAuthenticationContext {
  username?: string;
  origin?: string;
}

/**
 * WebAuthn application use cases. Challenges stay in the HTTP/session adapter; this service
 * verifies them but never owns Express session state.
 */
export class PasskeyService {
  constructor(
    private readonly repository: PasskeyRepository,
    private readonly users: UserService,
    private readonly webauthn: WebAuthnProvider,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async beginRegistration(context: PasskeyRegistrationContext): Promise<PasskeyOptions> {
    const user = await this.users.get(context.userId);
    if (!user || user.username !== context.username) throw new Error('User not found or username mismatch.');
    const existingCredentials = await this.repository.listByUser(context.userId);
    return this.webauthn.generateRegistrationOptions({
      userId: context.userId,
      username: context.username,
      origin: context.origin,
      existingCredentials,
    });
  }

  async finishRegistration(request: {
    userId: number;
    username: string;
    response: unknown;
    expectedChallenge: string;
    origin?: string;
  }): Promise<boolean> {
    const user = await this.users.get(request.userId);
    if (!user || user.username !== request.username) throw new Error('User not found or username mismatch.');
    const result = await this.webauthn.verifyRegistration({
      response: request.response,
      expectedChallenge: request.expectedChallenge,
      origin: request.origin,
    });
    if (!result.verified || !result.credential) return false;
    const existing = await this.repository.getByCredentialId(result.credential.credentialId);
    if (existing) throw new Error('Passkey credential is already registered.');
    const created = await this.repository.create({ userId: request.userId, ...result.credential });
    await this.audit.logAction('PASSKEY_REGISTERED', { userId: request.userId, credentialId: created.credentialId });
    await this.notifications.publish('PASSKEY_REGISTERED', {
      userId: request.userId,
      username: request.username,
      credentialId: created.credentialId,
    });
    return true;
  }

  async beginAuthentication(context: PasskeyAuthenticationContext = {}): Promise<PasskeyOptions> {
    let credentials: Awaited<ReturnType<PasskeyRepository['listByUser']>> | undefined;
    if (context.username) {
      const user = await this.users.findStoredByUsername(context.username);
      credentials = user ? await this.repository.listByUser(user.id) : [];
    }
    return this.webauthn.generateAuthenticationOptions({ origin: context.origin, credentials });
  }

  async finishAuthentication(request: {
    response: unknown;
    expectedChallenge: string;
    origin?: string;
    ip?: string;
  }): Promise<{ verified: true; user: { id: number; username: string }; credentialId: string } | { verified: false }> {
    const credentialId = this.webauthn.credentialIdFromAuthenticationResponse(request.response);
    if (!credentialId) throw new Error('Credential ID missing from authentication response.');
    const passkey = await this.repository.getByCredentialId(credentialId);
    if (!passkey) {
      await this.audit.logAction('PASSKEY_AUTH_FAILURE', { credentialId, reason: 'Passkey not found', ip: request.ip });
      await this.notifications.publish('PASSKEY_AUTH_FAILURE', {
        credentialId,
        reason: 'Passkey not found',
        ip: request.ip,
      });
      return { verified: false };
    }
    const verification = await this.webauthn.verifyAuthentication({
      response: request.response,
      expectedChallenge: request.expectedChallenge,
      origin: request.origin,
      credential: passkey,
    });
    if (!verification.verified || verification.newCounter === undefined) {
      await this.audit.logAction('PASSKEY_AUTH_FAILURE', {
        credentialId,
        reason: 'Verification failed',
        ip: request.ip,
      });
      await this.notifications.publish('PASSKEY_AUTH_FAILURE', {
        credentialId,
        reason: 'Verification failed',
        ip: request.ip,
      });
      return { verified: false };
    }
    const user = await this.users.get(passkey.userId);
    if (!user) throw new Error('Passkey belongs to a missing user.');
    await Promise.all([
      this.repository.updateCounter(credentialId, verification.newCounter),
      this.repository.touch(credentialId),
    ]);
    await this.audit.logAction('PASSKEY_AUTH_SUCCESS', {
      userId: user.id,
      username: user.username,
      credentialId,
      ip: request.ip,
    });
    await this.notifications.publish('LOGIN_SUCCESS', {
      userId: user.id,
      username: user.username,
      credentialId,
      ip: request.ip,
      method: 'Passkey',
    });
    return { verified: true, user: { id: user.id, username: user.username }, credentialId };
  }

  async list(userId: number): Promise<PasskeySummary[]> {
    return (await this.repository.listByUser(userId)).map((passkey) => ({
      credentialId: passkey.credentialId,
      name: passkey.name,
      transports: passkey.transports,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt,
    }));
  }

  async remove(userId: number, credentialId: string, username?: string): Promise<boolean> {
    const passkey = await this.requireOwned(userId, credentialId, 'delete');
    const deleted = await this.repository.delete(passkey.credentialId);
    if (deleted) {
      await this.audit.logAction('PASSKEY_DELETED', { userId, username, credentialId });
      await this.notifications.publish('PASSKEY_DELETED', { userId, username, credentialId });
    }
    return deleted;
  }

  async rename(userId: number, credentialId: string, name: string, username?: string): Promise<void> {
    const trimmed = name?.trim();
    if (!trimmed) throw new Error('Passkey 名称不能为空。');
    if (trimmed.length > 128) throw new Error('Passkey 名称不能超过 128 个字符。');
    await this.requireOwned(userId, credentialId, 'rename');
    if (!(await this.repository.updateName(credentialId, trimmed))) throw new Error('Passkey name update failed.');
    await this.audit.logAction('PASSKEY_NAME_UPDATED', { userId, username, credentialId, newName: trimmed });
  }

  async hasConfigured(username?: string): Promise<boolean> {
    if (!username) return Boolean(await this.repository.getFirst());
    const user = await this.users.findStoredByUsername(username);
    return user ? (await this.repository.listByUser(user.id)).length > 0 : false;
  }

  private async requireOwned(userId: number, credentialId: string, action: 'delete' | 'rename') {
    const passkey = await this.repository.getByCredentialId(credentialId);
    if (!passkey) throw new Error('Passkey not found.');
    if (passkey.userId !== userId) {
      const auditAction = action === 'delete' ? 'PASSKEY_DELETE_UNAUTHORIZED' : 'PASSKEY_NAME_UPDATE_UNAUTHORIZED';
      await this.audit.logAction(auditAction, { userId, credentialIdAttempted: credentialId });
      throw new Error(
        action === 'delete' ? 'Unauthorized to delete this passkey.' : 'Unauthorized to update this passkey name.',
      );
    }
    return passkey;
  }
}

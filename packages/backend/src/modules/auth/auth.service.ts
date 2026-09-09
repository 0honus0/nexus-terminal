import type { PasswordHasher } from '../../shared/security/crypto.port';
import type { AuditLogService } from '../audit/audit.service';
import type { NotificationService } from '../notifications/notification.service';
import type { UserService } from '../user/user.service';

export interface AuthenticatedUser {
  id: number;
  username: string;
}
export type PasswordAuthenticationResult =
  | { status: 'authenticated'; user: AuthenticatedUser }
  | { status: 'requiresTwoFactor'; userId: number }
  | { status: 'invalid' };

/** Password/setup use cases only. Express session creation remains an interface concern. */
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}
  needsSetup(): Promise<boolean> {
    return this.users.count().then((count) => count === 0);
  }
  async setupAdmin(username: string, password: string, context?: { ip?: string }) {
    if ((await this.users.count()) > 0) throw new Error('设置已完成，无法重复执行。');
    this.validateNewPassword(password);
    if (!username?.trim()) throw new Error('用户名不能为空。');
    const id = await this.users.create(username.trim(), await this.hasher.hash(password));
    await this.audit.logAction('ADMIN_SETUP_COMPLETE', { userId: id, username: username.trim(), ip: context?.ip });
    await this.notifications.publish('ADMIN_SETUP_COMPLETE', {
      userId: id,
      username: username.trim(),
      ip: context?.ip,
    });
    return { id, username: username.trim() };
  }
  async authenticatePassword(
    username: string,
    password: string,
    context?: { ip?: string },
  ): Promise<PasswordAuthenticationResult> {
    const user = await this.users.findStoredByUsername(username);
    if (!user || !(await this.hasher.compare(password, user.hashedPassword))) {
      await this.audit.logAction('LOGIN_FAILURE', {
        username,
        reason: user ? 'Invalid password' : 'User not found',
        ip: context?.ip,
      });
      await this.notifications.publish('LOGIN_FAILURE', {
        username,
        reason: user ? 'Invalid password' : 'User not found',
        ip: context?.ip,
      });
      return { status: 'invalid' };
    }
    if (user.twoFactorSecret) return { status: 'requiresTwoFactor', userId: user.id };
    await this.recordLoginSuccess(user.id, user.username, context?.ip, false);
    return { status: 'authenticated', user: { id: user.id, username: user.username } };
  }
  async changePassword(userId: number, currentPassword: string, nextPassword: string, context?: { ip?: string }) {
    if (currentPassword === nextPassword) throw new Error('新密码不能与当前密码相同。');
    this.validateNewPassword(nextPassword);
    const user = await this.users.getStored(userId);
    if (!user) throw new Error('用户不存在。');
    if (!(await this.hasher.compare(currentPassword, user.hashedPassword))) throw new Error('当前密码不正确。');
    if (!(await this.users.updatePassword(userId, await this.hasher.hash(nextPassword))))
      throw new Error('密码更新失败。');
    await this.audit.logAction('PASSWORD_CHANGED', { userId, ip: context?.ip });
    await this.notifications.publish('PASSWORD_CHANGED', { userId, ip: context?.ip });
  }
  async recordLoginFailure(username: string, reason: string, ip?: string) {
    await this.audit.logAction('LOGIN_FAILURE', { username, reason, ip });
    await this.notifications.publish('LOGIN_FAILURE', { username, reason, ip });
  }
  async recordLogout(userId: number, username: string, ip?: string) {
    await this.audit.logAction('LOGOUT', { userId, username, ip });
    await this.notifications.publish('LOGOUT', { userId, username, ip });
  }
  async recordLoginSuccess(userId: number, username: string, ip?: string, twoFactor = false) {
    await this.audit.logAction('LOGIN_SUCCESS', { userId, username, ip, ...(twoFactor ? { twoFactor: true } : {}) });
    await this.notifications.publish('LOGIN_SUCCESS', {
      userId,
      username,
      ip,
      ...(twoFactor ? { twoFactor: true } : {}),
    });
  }
  private validateNewPassword(value: string) {
    if (!value || value.length < 8) throw new Error('密码长度至少需要 8 位。');
  }
}

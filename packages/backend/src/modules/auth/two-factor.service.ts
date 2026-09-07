import type { PasswordHasher } from '../../shared/security/crypto.port';
import type { AuditLogService } from '../audit/audit.service';
import type { NotificationService } from '../notifications/notification.service';
import type { UserService } from '../user/user.service';
import type { AuthService } from './auth.service';
import type { TwoFactorPort } from './two-factor.port';
export class TwoFactorService {
  constructor(
    private readonly users: UserService,
    private readonly provider: TwoFactorPort,
    private readonly hasher: PasswordHasher,
    private readonly auth: AuthService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}
  async beginSetup(userId: number, username: string) {
    const user = await this.users.getStored(userId);
    if (!user) throw new Error('用户不存在。');
    if (user.twoFactorSecret) throw new Error('两步验证已启用。如需重置，请先禁用。');
    return this.provider.generate(`NexusTerminal (${username})`);
  }
  async activate(userId: number, tempSecret: string, token: string, context?: { ip?: string }) {
    if (!tempSecret) throw new Error('未找到临时密钥，请重新开始设置流程。');
    if (!this.provider.verify(tempSecret, token)) return false;
    if (!(await this.users.updateTwoFactorSecret(userId, tempSecret))) throw new Error('未找到要更新的用户');
    await this.audit.logAction('2FA_ENABLED', { userId, ip: context?.ip });
    await this.notifications.publish('2FA_ENABLED', { userId, ip: context?.ip });
    return true;
  }
  async verifyLogin(userId: number, token: string, context?: { ip?: string }) {
    const user = await this.users.getStored(userId);
    if (!user?.twoFactorSecret) throw new Error('无法验证，请重新登录。');
    if (!this.provider.verify(user.twoFactorSecret, token))
      return { valid: false as const, user: { id: user.id, username: user.username } };
    await this.auth.recordLoginSuccess(user.id, user.username, context?.ip, true);
    return { valid: true as const, user: { id: user.id, username: user.username } };
  }
  async disable(userId: number, password: string, context?: { ip?: string }) {
    const user = await this.users.getStored(userId);
    if (!user) throw new Error('用户不存在。');
    if (!(await this.hasher.compare(password, user.hashedPassword))) throw new Error('当前密码不正确。');
    if (!(await this.users.updateTwoFactorSecret(userId, null))) throw new Error('未找到要更新的用户');
    await this.audit.logAction('2FA_DISABLED', { userId, ip: context?.ip });
    await this.notifications.publish('2FA_DISABLED', { userId, ip: context?.ip });
  }
}

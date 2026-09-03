import type { NotificationService } from '../notifications/notification.service';
import type { SettingsService } from '../settings/settings.service';
import type { IpBlacklistRepository } from './ip-blacklist.repository.port';
const LOCAL_IPS = new Set(['127.0.0.1', '::1', 'localhost']);
export class IpBlacklistService {
  constructor(
    private readonly repository: IpBlacklistRepository,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
  ) {}
  async isBlocked(ip: string): Promise<boolean> {
    if (!(await this.settings.isIpBlacklistEnabled())) return false;
    const e = await this.repository.get(ip);
    return Boolean(e?.blockedUntil && e.blockedUntil > Math.floor(Date.now() / 1000));
  }
  async recordFailedAttempt(ip: string): Promise<void> {
    if (!(await this.settings.isIpBlacklistEnabled()) || LOCAL_IPS.has(ip)) return;
    const now = Math.floor(Date.now() / 1000);
    const [maxRaw, durationRaw, current] = await Promise.all([
      this.settings.getSetting('maxLoginAttempts'),
      this.settings.getSetting('loginBanDuration'),
      this.repository.get(ip),
    ]);
    const max = this.bounded(maxRaw, 5, 1, 1000);
    const duration = this.bounded(durationRaw, 300, 1, 86400 * 30);
    const attempts = (current?.attempts ?? 0) + 1;
    const newlyBlocked = attempts >= max && !current?.blockedUntil;
    const blockedUntil = current?.blockedUntil ?? (newlyBlocked ? now + duration : null);
    await this.repository.upsert({ ip, attempts, lastAttemptAt: now, blockedUntil });
    if (newlyBlocked && blockedUntil)
      await this.notifications.publish('IP_BLOCKED', {
        ip,
        attempts,
        duration,
        blockedUntil: new Date(blockedUntil * 1000).toISOString(),
      });
  }
  resetAttempts(ip: string): Promise<boolean> {
    return this.repository.remove(ip);
  }
  getBlacklist(limit = 50, offset = 0) {
    return this.repository.list(limit, offset);
  }
  removeFromBlacklist(ip: string) {
    return this.repository.remove(ip);
  }
  private bounded(raw: string | null, fallback: number, min: number, max: number) {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  }
}

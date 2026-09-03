import type { PasswordHasher } from '../../shared/security/crypto.port';
import type { UserService } from '../user/user.service';
import type { BackupCodecPort, BackupRestoreHooks, BackupSnapshotPort } from './backup.port';
import type { BackupImportResult } from './backup.types';

/** Owns backup authorization and the capture → codec / decode → restore application workflow. */
export class BackupService {
  constructor(
    private readonly snapshots: BackupSnapshotPort,
    private readonly codec: BackupCodecPort,
    private readonly users: UserService,
    private readonly hasher: PasswordHasher,
    private readonly hooks: BackupRestoreHooks = {},
  ) {}

  async exportFull(userId: number, password: string): Promise<Uint8Array> {
    if (!password) throw new Error('请输入当前登录密码后再导出备份。');
    const user = await this.users.getStored(userId);
    if (!user || !(await this.hasher.compare(password, user.hashedPassword))) throw new Error('当前登录密码不正确。');
    return this.codec.encode(await this.snapshots.capture(), password);
  }

  async importFull(bytes: Uint8Array, password?: string): Promise<BackupImportResult> {
    const decoded = await this.codec.decode(bytes, password);
    await this.hooks.beforeRestore?.();
    const restored = await this.snapshots.restore(decoded.snapshot);
    await this.hooks.afterRestore?.();
    return { ...restored, usedPassword: decoded.usedPassword };
  }
}

export class BackupPasswordRequiredError extends Error {
  readonly code = 'BACKUP_PASSWORD_REQUIRED';
  constructor() {
    super('该备份来自其他实例，请输入导出时使用的登录密码。');
    this.name = 'BackupPasswordRequiredError';
  }
}

export class InvalidBackupPasswordError extends Error {
  readonly code = 'INVALID_BACKUP_PASSWORD';
  constructor() {
    super('备份密码不正确，或备份文件已损坏。');
    this.name = 'InvalidBackupPasswordError';
  }
}

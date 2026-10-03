export class SftpDownloadCapacityError extends Error {
  constructor() {
    super('下载并发过多，请等待现有下载完成后重试。');
    this.name = 'SftpDownloadCapacityError';
  }
}

interface SftpDownloadAdmissionPolicy {
  maxPerUser?: number;
  maxTotal?: number;
}

const DEFAULT_MAX_PER_USER = 8;
const DEFAULT_MAX_TOTAL = 64;

/** Owns active HTTP/SFTP read workload across ticket, authenticated file and directory downloads. */
export class SftpDownloadAdmissionRegistry {
  private readonly activeByUser = new Map<number, number>();
  private activeTotal = 0;
  private readonly maxPerUser: number;
  private readonly maxTotal: number;

  constructor(policy: SftpDownloadAdmissionPolicy = {}) {
    this.maxPerUser = Math.max(1, Math.floor(policy.maxPerUser ?? DEFAULT_MAX_PER_USER));
    this.maxTotal = Math.max(1, Math.floor(policy.maxTotal ?? DEFAULT_MAX_TOTAL));
  }

  acquire(userId: number): () => void {
    const activeForUser = this.activeByUser.get(userId) ?? 0;
    if (activeForUser >= this.maxPerUser || this.activeTotal >= this.maxTotal) {
      throw new SftpDownloadCapacityError();
    }
    this.activeByUser.set(userId, activeForUser + 1);
    this.activeTotal += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.activeByUser.get(userId) ?? 0;
      if (current <= 1) this.activeByUser.delete(userId);
      else this.activeByUser.set(userId, current - 1);
      this.activeTotal = Math.max(0, this.activeTotal - 1);
    };
  }
}

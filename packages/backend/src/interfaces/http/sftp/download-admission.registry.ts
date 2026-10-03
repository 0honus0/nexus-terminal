export class SftpDownloadCapacityError extends Error {
  constructor() {
    super('下载并发过多，请等待现有下载完成后重试。');
    this.name = 'SftpDownloadCapacityError';
  }
}

interface SftpDownloadAdmissionPolicy {
  maxTotal?: number;
}

const DEFAULT_MAX_TOTAL = 8;

/** Owns active HTTP/SFTP read workload across ticket, authenticated file and directory downloads. */
export class SftpDownloadAdmissionRegistry {
  private activeTotal = 0;
  private readonly maxTotal: number;

  constructor(policy: SftpDownloadAdmissionPolicy = {}) {
    this.maxTotal = Math.max(1, Math.floor(policy.maxTotal ?? DEFAULT_MAX_TOTAL));
  }

  acquire(): () => void {
    if (this.activeTotal >= this.maxTotal) {
      throw new SftpDownloadCapacityError();
    }
    this.activeTotal += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeTotal = Math.max(0, this.activeTotal - 1);
    };
  }
}

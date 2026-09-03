import type { LocalSystemStatusProvider } from './local-system-status.port';
export class SystemStatusService {
  constructor(private readonly provider: LocalSystemStatusProvider) {}
  getLocalSystemStatus() {
    return this.provider.collect();
  }
}

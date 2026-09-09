import type {
  DiagnosticContext,
  DiagnosticObservation,
  DiagnosticProbe,
} from '../../platform/diagnostics/diagnostic-probe';

export class ProcessDiagnosticProbe implements DiagnosticProbe {
  readonly id = 'process.runtime';
  readonly scope = 'runtime' as const;

  async collect(_context: DiagnosticContext): Promise<DiagnosticObservation> {
    const memory = process.memoryUsage();
    return {
      probeId: this.id,
      scope: this.scope,
      status: 'ok',
      summary: 'Backend process is running.',
      details: {
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
      },
      collectedAt: Date.now(),
    };
  }
}

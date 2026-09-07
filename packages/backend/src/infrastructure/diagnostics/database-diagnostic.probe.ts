import type {
  DiagnosticContext,
  DiagnosticObservation,
  DiagnosticProbe,
} from '../../platform/diagnostics/diagnostic-probe';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';

export class DatabaseDiagnosticProbe implements DiagnosticProbe {
  readonly id = 'storage.database';
  readonly scope = 'storage' as const;

  constructor(private readonly database: RelationalDatabase) {}

  async collect(_context: DiagnosticContext): Promise<DiagnosticObservation> {
    const startedAt = Date.now();
    await this.database.queryOne<{ ok: number }>('SELECT 1 AS ok');
    return {
      probeId: this.id,
      scope: this.scope,
      status: 'ok',
      summary: 'Database query succeeded.',
      details: { latencyMs: Date.now() - startedAt },
      collectedAt: Date.now(),
    };
  }
}

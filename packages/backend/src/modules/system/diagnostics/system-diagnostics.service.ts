import type {
  DiagnosticContext,
  DiagnosticObservation,
  DiagnosticProbe,
  DiagnosticScope,
} from '../../../platform/diagnostics/diagnostic-probe';

export interface DiagnosticRequest extends DiagnosticContext {
  probeIds?: readonly string[];
}

export interface DiagnosticReport {
  generatedAt: number;
  actorType: DiagnosticContext['actorType'];
  subject?: DiagnosticContext['subject'];
  observations: readonly DiagnosticObservation[];
}

export interface DiagnosticsService {
  availableProbes(): readonly { id: string; scope: DiagnosticScope }[];
  run(request: DiagnosticRequest): Promise<DiagnosticReport>;
}

/**
 * Safe, read-only diagnostics surface intended for operators and future Agent self-diagnosis.
 * Probe implementations are injected by Bootstrap; this service never reaches into Infrastructure.
 */
export class SystemDiagnosticsService implements DiagnosticsService {
  constructor(private readonly probes: readonly DiagnosticProbe[]) {}

  availableProbes(): readonly { id: string; scope: DiagnosticScope }[] {
    return this.probes.map((probe) => ({ id: probe.id, scope: probe.scope }));
  }

  async run(request: DiagnosticRequest): Promise<DiagnosticReport> {
    const selectedIds = request.probeIds ? new Set(request.probeIds) : null;
    const selectedScopes = request.scopes ? new Set(request.scopes) : null;
    const selected = this.probes.filter((probe) => {
      if (selectedIds && !selectedIds.has(probe.id)) return false;
      if (selectedScopes && !selectedScopes.has(probe.scope)) return false;
      return true;
    });

    const observations = await Promise.all(selected.map(async (probe): Promise<DiagnosticObservation> => {
      try {
        return await probe.collect(request);
      } catch (error) {
        return {
          probeId: probe.id,
          scope: probe.scope,
          status: 'error',
          summary: error instanceof Error ? error.message : 'Diagnostic probe failed.',
          collectedAt: Date.now(),
        };
      }
    }));

    return {
      generatedAt: Date.now(),
      actorType: request.actorType,
      subject: request.subject,
      observations,
    };
  }
}

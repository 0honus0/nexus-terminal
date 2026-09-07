import type {
  DiagnosticContext,
  DiagnosticDetails,
  DiagnosticObservation,
  DiagnosticProbe,
  DiagnosticScope,
} from '../../../platform/diagnostics/diagnostic-probe';
import { DefaultDiagnosticAccessPolicy, type DiagnosticAccessPolicy } from './diagnostic-access.policy';

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
  availableProbes(context: DiagnosticContext): readonly { id: string; scope: DiagnosticScope }[];
  run(request: DiagnosticRequest): Promise<DiagnosticReport>;
}

const SENSITIVE_DETAIL_KEY = /(authorization|cookie|credential|passphrase|password|private.?key|secret|token)/i;

const redactDetails = (details: DiagnosticDetails | undefined): DiagnosticDetails | undefined => {
  if (!details) return undefined;
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, SENSITIVE_DETAIL_KEY.test(key) ? '[redacted]' : value]),
  );
};

const redactObservation = (observation: DiagnosticObservation): DiagnosticObservation => ({
  ...observation,
  details: redactDetails(observation.details),
});

/**
 * Safe, read-only diagnostics surface intended for operators and future Agent self-diagnosis.
 * Probe implementations are injected by Bootstrap; this service never reaches into Infrastructure.
 * A module-level policy filters probes before execution and observations are redacted before release.
 */
export class SystemDiagnosticsService implements DiagnosticsService {
  constructor(
    private readonly probes: readonly DiagnosticProbe[],
    private readonly accessPolicy: DiagnosticAccessPolicy = new DefaultDiagnosticAccessPolicy(),
  ) {}

  availableProbes(context: DiagnosticContext): readonly { id: string; scope: DiagnosticScope }[] {
    return this.probes
      .filter((probe) => this.accessPolicy.canRun(context, probe))
      .map((probe) => ({ id: probe.id, scope: probe.scope }));
  }

  async run(request: DiagnosticRequest): Promise<DiagnosticReport> {
    const selectedIds = request.probeIds ? new Set(request.probeIds) : null;
    const selectedScopes = request.scopes ? new Set(request.scopes) : null;
    const selected = this.probes.filter((probe) => {
      if (!this.accessPolicy.canRun(request, probe)) return false;
      if (selectedIds && !selectedIds.has(probe.id)) return false;
      if (selectedScopes && !selectedScopes.has(probe.scope)) return false;
      return true;
    });

    const observations = await Promise.all(
      selected.map(async (probe): Promise<DiagnosticObservation> => {
        try {
          return redactObservation(await probe.collect(request));
        } catch (error) {
          return {
            probeId: probe.id,
            scope: probe.scope,
            status: 'error',
            summary: error instanceof Error ? error.message : 'Diagnostic probe failed.',
            collectedAt: Date.now(),
          };
        }
      }),
    );

    return {
      generatedAt: Date.now(),
      actorType: request.actorType,
      subject: request.subject,
      observations,
    };
  }
}

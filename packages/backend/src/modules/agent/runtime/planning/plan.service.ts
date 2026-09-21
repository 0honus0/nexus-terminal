import { logErrorCode, logger } from '../../../../shared/logging/logger';
import type { JsonValue, Scope } from '../../agent.types';
import type { RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { ProjectionCommitPort } from '../runs/state-commit.port';
import { TERMINAL_RUN_STATUSES } from '../runs/run.types';
import { normalizePlanItems, type PlanItem, type RunPlan } from './plan.types';

export class PlanService {
  constructor(
    private readonly runs: RunSnapshotReaderPort,
    private readonly commits: ProjectionCommitPort,
    private readonly now: () => number,
  ) {}

  async replace(
    scope: Scope,
    runId: string,
    expectedPlanRevision: number,
    input: readonly PlanItem[],
  ): Promise<RunPlan> {
    const snapshot = await this.runs.snapshot(scope, runId);
    if (!snapshot) throw new Error('NOT_FOUND');
    if (TERMINAL_RUN_STATUSES.has(snapshot.status)) throw new Error('RUN_NOT_SCHEDULABLE');
    if (snapshot.plan.revision !== expectedPlanRevision) throw new Error('RUN_PLAN_REVISION_CONFLICT');
    const plan: RunPlan = {
      schemaVersion: 1,
      revision: expectedPlanRevision + 1,
      items: normalizePlanItems(input),
    };
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        expectedPlanRevision,
        nextPlanRevision: plan.revision,
        itemCount: plan.items.length,
      },
      'Agent plan update started',
    );
    try {
      await this.commits.commit({
        scope,
        runId,
        expectedRunVersion: snapshot.version,
        events: [
          {
            type: 'plan.updated',
            payload: {
              schemaVersion: 1,
              revision: plan.revision,
              items: plan.items as unknown as JsonValue,
            },
          },
        ],
        runPatch: { plan },
        now: this.now(),
      });
    } catch (error) {
      logger.error(
        {
          userId: scope.userId,
          appId: scope.appId,
          runId,
          expectedRunVersion: snapshot.version,
          planRevision: plan.revision,
          errorCode: logErrorCode(error, 'PLAN_COMMIT_FAILED'),
        },
        'Agent plan update commit failed',
      );
      throw error;
    }
    logger.info(
      { userId: scope.userId, appId: scope.appId, runId, planRevision: plan.revision, itemCount: plan.items.length },
      'Agent plan updated',
    );
    return plan;
  }
}

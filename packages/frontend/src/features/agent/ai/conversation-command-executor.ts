import type { AgentArtifactRef, AgentPendingRunInputPage, AgentRunSnapshot, AgentRunView } from '../api/agent-api';
import { toAgentApiError } from '../api/agent-api';
import { CONVERSATION_COMMAND_SUGGESTIONS, type ConversationSlashCommand } from './conversation-commands';

export interface ConversationCommandResult {
  title: string;
  lines: string[];
  tone: 'info' | 'error';
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

export interface ConversationCommandExecutorDependencies {
  t: Translate;
  getRun: () => AgentRunView | null;
  isActiveRun: (run: AgentRunView) => boolean;
  beginMutation: () => boolean;
  finishMutation: () => void;
  succeedMutation: () => void;
  recoverFailure: (cause: unknown, runId?: string) => Promise<void>;
  setResult: (result: ConversationCommandResult | null) => void;
  clearComposer: () => void;
  createGoalRun: (text: string) => Promise<AgentRunView>;
  getRunSnapshot: (runId: string) => Promise<AgentRunSnapshot>;
  setGoal: (run: AgentRunView, text: string) => Promise<AgentRunView>;
  pendingInputs: (runId: string) => Promise<AgentPendingRunInputPage>;
  adoptRun: (run: AgentRunView) => void;
  refreshBackgroundRuns: () => Promise<void>;
  interruptAndRefresh: (run: AgentRunView, text: string) => Promise<void>;
  cancelAndRefresh: (run: AgentRunView) => Promise<void>;
}

const failureMessage = (t: Translate, cause: unknown): string => {
  const failure = toAgentApiError(cause);
  if (failure.code === 'RUN_NOT_STREAMING_MODEL') return t('agent.conversation.commands.notStreaming');
  if (failure.code === 'RUN_NOT_ACCEPTING_GOAL') return t('agent.conversation.commands.goalNotAccepted');
  if (failure.code === 'STATE_CONFLICT' || failure.code === 'GOAL_REVISION_CONFLICT')
    return t('agent.conversation.commands.stateChanged');
  return failure.message || t('agent.conversation.commands.genericFailure');
};

const errorResult = (t: Translate, message: string): ConversationCommandResult => ({
  title: t('agent.conversation.commands.errorTitle'),
  lines: [message],
  tone: 'error',
});

export const createConversationCommandExecutor = (dependencies: ConversationCommandExecutorDependencies) => {
  const setError = (message: string): void => dependencies.setResult(errorResult(dependencies.t, message));

  return async (command: ConversationSlashCommand, selectedArtifacts: AgentArtifactRef[]): Promise<void> => {
    const { t } = dependencies;
    if (selectedArtifacts.length > 0) {
      setError(t('agent.conversation.commands.attachmentsUnsupported'));
      return;
    }
    if (command.kind === 'help') {
      dependencies.setResult({
        title: t('agent.conversation.commands.helpTitle'),
        lines: [
          ...CONVERSATION_COMMAND_SUGGESTIONS.map(
            (suggestion) => `${suggestion.usage} — ${t(suggestion.descriptionKey)}`,
          ),
          t('agent.conversation.commands.escapeHint'),
        ],
        tone: 'info',
      });
      dependencies.clearComposer();
      return;
    }

    const current = dependencies.getRun();
    if (!current && command.kind === 'goal.set') {
      if (!dependencies.beginMutation()) return;
      dependencies.setResult(null);
      try {
        const created = await dependencies.createGoalRun(command.text);
        dependencies.setResult({
          title: t('agent.conversation.commands.goalTitle'),
          lines: [
            created.goal.text ?? command.text,
            t('agent.conversation.commands.goalStarted', { revision: created.goal.revision }),
          ],
          tone: 'info',
        });
        dependencies.succeedMutation();
      } catch (cause) {
        await dependencies.recoverFailure(cause);
        setError(failureMessage(t, cause));
      } finally {
        dependencies.finishMutation();
      }
      return;
    }
    if (!current) {
      setError(t('agent.conversation.commands.requiresRun'));
      return;
    }
    if (!dependencies.beginMutation()) return;
    dependencies.setResult(null);
    try {
      if (command.kind === 'goal.show') {
        const latest = await dependencies.getRunSnapshot(current.id);
        dependencies.adoptRun(latest);
        dependencies.setResult({
          title: t('agent.conversation.commands.goalTitle'),
          lines: [
            latest.goal.text ?? t('agent.conversation.commands.goalEmpty'),
            t('agent.conversation.commands.goalRevision', { revision: latest.goal.revision }),
          ],
          tone: 'info',
        });
      } else if (command.kind === 'goal.set') {
        const updated = await dependencies.setGoal(current, command.text);
        dependencies.adoptRun(updated);
        dependencies.setResult({
          title: t('agent.conversation.commands.goalTitle'),
          lines: [
            updated.goal.text ?? command.text,
            t('agent.conversation.commands.goalUpdated', { revision: updated.goal.revision }),
          ],
          tone: 'info',
        });
        await dependencies.refreshBackgroundRuns();
      } else if (command.kind === 'plan.show') {
        const latest = await dependencies.getRunSnapshot(current.id);
        dependencies.adoptRun(latest);
        dependencies.setResult({
          title: t('agent.conversation.commands.planTitle'),
          lines: [
            t('agent.conversation.commands.planRevision', { revision: latest.plan.revision }),
            ...(latest.plan.items.length
              ? latest.plan.items.map(
                  (item) =>
                    `${t(`agent.tasks.planStatus.${item.status}`)} · ${item.title}${item.detail ? ` — ${item.detail}` : ''}`,
                )
              : [t('agent.conversation.commands.planEmpty')]),
          ],
          tone: 'info',
        });
      } else if (command.kind === 'queue.show') {
        const latest = await dependencies.getRunSnapshot(current.id);
        dependencies.adoptRun(latest);
        const pending = await dependencies.pendingInputs(current.id);
        dependencies.setResult({
          title: t('agent.conversation.commands.queueTitle'),
          lines: [
            t('agent.conversation.commands.queueSummary', {
              pending: pending.total,
              consumed: latest.consumedInputSequence,
            }),
            ...(pending.items.length
              ? pending.items.map((input) =>
                  t('agent.conversation.commands.queueItem', {
                    sequence: input.sequence,
                    text: input.text.length > 240 ? `${input.text.slice(0, 237)}…` : input.text,
                  }),
                )
              : [t('agent.conversation.commands.queueEmpty')]),
            ...(pending.hasMore
              ? [
                  t('agent.conversation.commands.queueTruncated', {
                    shown: pending.items.length,
                    total: pending.total,
                  }),
                ]
              : []),
          ],
          tone: 'info',
        });
      } else if (command.kind === 'interrupt') {
        if (!dependencies.isActiveRun(current)) {
          setError(t('agent.conversation.commands.requiresActiveRun'));
          dependencies.succeedMutation();
          return;
        }
        await dependencies.interruptAndRefresh(current, command.text);
        dependencies.setResult({
          title: t('agent.conversation.commands.interruptTitle'),
          lines: [t('agent.conversation.commands.interruptSubmitted')],
          tone: 'info',
        });
      } else {
        if (!dependencies.isActiveRun(current)) {
          setError(t('agent.conversation.commands.requiresActiveRun'));
          dependencies.succeedMutation();
          return;
        }
        await dependencies.cancelAndRefresh(current);
        dependencies.setResult({
          title: t('agent.conversation.commands.stopTitle'),
          lines: [t('agent.conversation.commands.stopSubmitted')],
          tone: 'info',
        });
      }
      dependencies.clearComposer();
      dependencies.succeedMutation();
    } catch (cause) {
      await dependencies.recoverFailure(cause, current.id);
      setError(failureMessage(t, cause));
    } finally {
      dependencies.finishMutation();
    }
  };
};

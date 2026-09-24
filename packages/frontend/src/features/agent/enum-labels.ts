import type { Composer } from 'vue-i18n';

const AGENT_ENUM_LABEL_KEYS = {
  goalStatus: {
    unknown: 'agent.enumLabels.goalStatus.unknown',
    in_progress: 'agent.enumLabels.goalStatus.in_progress',
    satisfied: 'agent.enumLabels.goalStatus.satisfied',
    not_satisfied: 'agent.enumLabels.goalStatus.not_satisfied',
  },
  ledgerKind: {
    user_input: 'agent.enumLabels.ledgerKind.user_input',
    assistant_message: 'agent.enumLabels.ledgerKind.assistant_message',
    tool_result: 'agent.enumLabels.ledgerKind.tool_result',
    system_notice: 'agent.enumLabels.ledgerKind.system_notice',
  },
  workspaceKind: {
    shell: 'agent.enumLabels.workspaceKind.shell',
    code: 'agent.enumLabels.workspaceKind.code',
    data: 'agent.enumLabels.workspaceKind.data',
    browser: 'agent.enumLabels.workspaceKind.browser',
  },
  packStatus: {
    supported: 'agent.enumLabels.packStatus.supported',
    deprecated: 'agent.enumLabels.packStatus.deprecated',
    unavailable: 'agent.enumLabels.packStatus.unavailable',
  },
  subagentMessageKind: {
    request: 'agent.enumLabels.subagentMessageKind.request',
    reply: 'agent.enumLabels.subagentMessageKind.reply',
    progress: 'agent.enumLabels.subagentMessageKind.progress',
    evidence: 'agent.enumLabels.subagentMessageKind.evidence',
    completion: 'agent.enumLabels.subagentMessageKind.completion',
  },
  subagentMessageStatus: {
    accepted: 'agent.enumLabels.subagentMessageStatus.accepted',
    delivered: 'agent.enumLabels.subagentMessageStatus.delivered',
    consumed: 'agent.enumLabels.subagentMessageStatus.consumed',
    expired: 'agent.enumLabels.subagentMessageStatus.expired',
    rejected: 'agent.enumLabels.subagentMessageStatus.rejected',
  },
} as const;

export type AgentEnumLabelFamily = keyof typeof AGENT_ENUM_LABEL_KEYS;

export const formatAgentEnumLabel = (t: Composer['t'], family: AgentEnumLabelFamily, value: string): string => {
  const keys = AGENT_ENUM_LABEL_KEYS[family] as Readonly<Record<string, string>>;
  const key = keys[value];
  return key ? t(key) : t('agent.enumLabels.technicalState', { value });
};

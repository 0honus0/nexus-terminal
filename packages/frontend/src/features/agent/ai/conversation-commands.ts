export type ConversationSlashCommand =
  | { kind: 'help' }
  | { kind: 'goal.show' }
  | { kind: 'goal.set'; text: string }
  | { kind: 'plan.show' }
  | { kind: 'queue.show' }
  | { kind: 'interrupt'; text: string }
  | { kind: 'stop' };

export type ConversationSubmission =
  | { kind: 'message'; text: string }
  | { kind: 'command'; command: ConversationSlashCommand }
  | {
      kind: 'invalid_command';
      commandName: string;
      reason: 'unknown' | 'missing_argument' | 'unexpected_argument';
    };

export interface ConversationCommandSuggestion {
  command: string;
  usage: string;
  descriptionKey: string;
}

export const CONVERSATION_COMMAND_SUGGESTIONS: readonly ConversationCommandSuggestion[] = [
  { command: '/goal', usage: '/goal [text]', descriptionKey: 'agent.conversation.commands.helpGoal' },
  { command: '/plan', usage: '/plan', descriptionKey: 'agent.conversation.commands.helpPlan' },
  { command: '/queue', usage: '/queue', descriptionKey: 'agent.conversation.commands.helpQueue' },
  { command: '/interrupt', usage: '/interrupt <text>', descriptionKey: 'agent.conversation.commands.helpInterrupt' },
  { command: '/stop', usage: '/stop', descriptionKey: 'agent.conversation.commands.helpStop' },
  { command: '/help', usage: '/help', descriptionKey: 'agent.conversation.commands.helpHelp' },
] as const;

const noArgumentCommand = (
  commandName: string,
  argument: string,
  kind: 'help' | 'plan.show' | 'queue.show' | 'stop',
): ConversationSubmission =>
  argument
    ? { kind: 'invalid_command', commandName, reason: 'unexpected_argument' }
    : { kind: 'command', command: { kind } };

export const conversationCommandSuggestions = (input: string): readonly ConversationCommandSuggestion[] => {
  const text = input.trimStart().toLowerCase();
  if (!text.startsWith('/') || text.startsWith('//') || /\s/.test(text)) return [];
  return CONVERSATION_COMMAND_SUGGESTIONS.filter((item) => item.command.startsWith(text));
};

export const parseConversationSubmission = (input: string): ConversationSubmission => {
  const text = input.trim();
  if (text.startsWith('//')) return { kind: 'message', text: text.slice(1) };
  if (!text.startsWith('/')) return { kind: 'message', text };

  const separator = text.search(/\s/);
  const rawCommand = separator === -1 ? text : text.slice(0, separator);
  const argument = separator === -1 ? '' : text.slice(separator).trim();
  const commandName = rawCommand.toLowerCase();

  switch (commandName) {
    case '/help':
      return noArgumentCommand(commandName, argument, 'help');
    case '/goal':
      return argument
        ? { kind: 'command', command: { kind: 'goal.set', text: argument } }
        : { kind: 'command', command: { kind: 'goal.show' } };
    case '/plan':
      return noArgumentCommand(commandName, argument, 'plan.show');
    case '/queue':
      return noArgumentCommand(commandName, argument, 'queue.show');
    case '/stop':
      return noArgumentCommand(commandName, argument, 'stop');
    case '/interrupt':
      return argument
        ? { kind: 'command', command: { kind: 'interrupt', text: argument } }
        : { kind: 'invalid_command', commandName, reason: 'missing_argument' };
    default:
      return { kind: 'invalid_command', commandName: rawCommand || '/', reason: 'unknown' };
  }
};

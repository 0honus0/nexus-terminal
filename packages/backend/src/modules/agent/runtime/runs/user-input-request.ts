import type { JsonValue } from '../../agent.types';
import type { UserInputChoice, UserInputQuestion } from './run.types';

const MAX_QUESTIONS = 4;
const MAX_CHOICES = 8;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('USER_INPUT_REQUEST_INVALID');
  return value as Record<string, unknown>;
};

const boundedString = (value: unknown, maxBytes: number, allowEmpty = false): string => {
  if (typeof value !== 'string') throw new Error('USER_INPUT_REQUEST_INVALID');
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new Error('USER_INPUT_REQUEST_INVALID');
  }
  return normalized;
};

const optionalString = (value: unknown, maxBytes: number): string | undefined => {
  if (value === undefined) return undefined;
  return boundedString(value, maxBytes);
};

const choice = (value: unknown): UserInputChoice => {
  const input = record(value);
  if (Object.keys(input).some((key) => !['value', 'label', 'description'].includes(key))) {
    throw new Error('USER_INPUT_REQUEST_INVALID');
  }
  return {
    value: boundedString(input.value, 128),
    label: boundedString(input.label, 256),
    ...(input.description === undefined ? {} : { description: boundedString(input.description, 512) }),
  };
};

export const normalizeUserInputQuestions = (value: unknown): UserInputQuestion[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_QUESTIONS) {
    throw new Error('USER_INPUT_REQUEST_INVALID');
  }
  const ids = new Set<string>();
  return value.map((item) => {
    const input = record(item);
    if (
      Object.keys(input).some(
        (key) => !['id', 'prompt', 'kind', 'choices', 'recommendedChoice', 'context'].includes(key),
      )
    ) {
      throw new Error('USER_INPUT_REQUEST_INVALID');
    }
    const id = boundedString(input.id, 64);
    if (!ID_PATTERN.test(id) || ids.has(id)) throw new Error('USER_INPUT_REQUEST_INVALID');
    ids.add(id);
    const prompt = boundedString(input.prompt, 1024);
    const kind = input.kind;
    if (kind !== 'text' && kind !== 'choice') throw new Error('USER_INPUT_REQUEST_INVALID');
    const context = optionalString(input.context, 1024);
    if (kind === 'text') {
      if (input.choices !== undefined || input.recommendedChoice !== undefined) {
        throw new Error('USER_INPUT_REQUEST_INVALID');
      }
      return { id, prompt, kind, ...(context === undefined ? {} : { context }) };
    }
    if (!Array.isArray(input.choices) || input.choices.length < 2 || input.choices.length > MAX_CHOICES) {
      throw new Error('USER_INPUT_REQUEST_INVALID');
    }
    const choices = input.choices.map(choice);
    if (new Set(choices.map((candidate) => candidate.value)).size !== choices.length) {
      throw new Error('USER_INPUT_REQUEST_INVALID');
    }
    const recommendedChoice = optionalString(input.recommendedChoice, 128);
    if (recommendedChoice !== undefined && !choices.some((candidate) => candidate.value === recommendedChoice)) {
      throw new Error('USER_INPUT_REQUEST_INVALID');
    }
    return {
      id,
      prompt,
      kind,
      choices,
      ...(recommendedChoice === undefined ? {} : { recommendedChoice }),
      ...(context === undefined ? {} : { context }),
    };
  });
};

export const userInputQuestionsJson = (questions: readonly UserInputQuestion[]): JsonValue =>
  questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    kind: question.kind,
    ...(question.choices
      ? {
          choices: question.choices.map((choice) => ({
            value: choice.value,
            label: choice.label,
            ...(choice.description === undefined ? {} : { description: choice.description }),
          })),
        }
      : {}),
    ...(question.recommendedChoice === undefined ? {} : { recommendedChoice: question.recommendedChoice }),
    ...(question.context === undefined ? {} : { context: question.context }),
  }));

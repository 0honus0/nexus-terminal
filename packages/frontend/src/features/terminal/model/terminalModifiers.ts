export interface TerminalModifierState {
  ctrl: boolean;
  alt: boolean;
}

const CTRL_DIGIT_SEQUENCES: Record<string, string> = {
  '2': '\x00',
  '3': '\x1b',
  '4': '\x1c',
  '5': '\x1d',
  '6': '\x1e',
  '7': '\x1f',
  '8': '\x7f',
};

const toCtrlSequence = (character: string): string | null => {
  if (character === ' ') return '\x00';
  if (character === '?') return '\x7f';
  if (CTRL_DIGIT_SEQUENCES[character]) return CTRL_DIGIT_SEQUENCES[character];

  const upperCharacter = character.toUpperCase();
  if (upperCharacter.length !== 1) return null;
  const code = upperCharacter.charCodeAt(0);
  if (code < 64 || code > 95) return null;
  return String.fromCharCode(code & 0x1f);
};

/**
 * Apply one sticky terminal Ctrl/Alt state to a user-input sequence.
 *
 * Printable characters follow the final mobile Workspace Ctrl mapping. Known xterm
 * navigation/function sequences retain their modifier parameter semantics so the
 * clean virtual keyboard does not lose capabilities while sharing the same state.
 * `null` means the sticky modifier cannot represent this input and must remain active.
 */
export const applyTerminalModifiers = (input: string, modifiers: TerminalModifierState): string | null => {
  if (!modifiers.ctrl && !modifiers.alt) return null;

  const tilde = input.match(/^\x1b\[([0-9]+)~$/);
  const cursor = input.match(/^\x1b\[([ABCD])$/);
  if (tilde || cursor) {
    const parameter = 1 + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
    if (tilde) return `\x1b[${tilde[1]};${parameter}~`;
    return `\x1b[1;${parameter}${cursor![1]}`;
  }

  if (input === '\t' || input === '\x1b') return modifiers.alt ? `\x1b${input}` : input;
  if (Array.from(input).length !== 1) return null;

  let sequence = input;
  if (modifiers.ctrl) {
    const ctrlSequence = toCtrlSequence(input);
    if (ctrlSequence === null) return null;
    sequence = ctrlSequence;
  }
  if (modifiers.alt) sequence = `\x1b${sequence}`;
  return sequence;
};

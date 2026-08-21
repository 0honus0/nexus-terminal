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

/** Convert one phone/hardware keyboard character using sticky terminal modifiers. */
export const applyTerminalModifiers = (input: string, modifiers: TerminalModifierState): string | null => {
  if (!modifiers.ctrl && !modifiers.alt) return null;
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

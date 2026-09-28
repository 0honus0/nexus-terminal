export interface TerminalModifierState {
  ctrl: boolean;
  alt: boolean;
  shift?: boolean;
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
  // xterm sends BS for Ctrl+Backspace so readline can delete the previous word.
  if (character === '\x7f') return '\x08';
  if (CTRL_DIGIT_SEQUENCES[character]) return CTRL_DIGIT_SEQUENCES[character];

  const upperCharacter = character.toUpperCase();
  if (upperCharacter.length !== 1) return null;
  const code = upperCharacter.charCodeAt(0);
  if (code < 64 || code > 95) return null;
  return String.fromCharCode(code & 0x1f);
};

/**
 * Apply one sticky terminal Ctrl/Alt/Shift state to a user-input sequence.
 *
 * Printable characters follow the mobile Workspace Ctrl mapping. xterm navigation and
 * function sequences, in both CSI and SS3 (application cursor) form, are re-encoded with
 * the xterm modifier parameter, which always uses the CSI form.
 * `null` means the sticky modifier cannot represent this input and must remain active.
 */
export const applyTerminalModifiers = (input: string, modifiers: TerminalModifierState): string | null => {
  if (!modifiers.ctrl && !modifiers.alt && !modifiers.shift) return null;

  const parameter = 1 + (modifiers.shift ? 1 : 0) + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
  const tilde = input.match(/^\x1b\[([0-9]+)~$/);
  if (tilde) return `\x1b[${tilde[1]};${parameter}~`;
  const letter = input.match(/^\x1b(?:\[|O)([ABCDHFPQRS])$/);
  if (letter) return `\x1b[1;${parameter}${letter[1]}`;

  if (input === '\t') {
    const tab = modifiers.shift ? '\x1b[Z' : '\t';
    return modifiers.alt ? `\x1b${tab}` : tab;
  }
  if (input === '\x1b') return modifiers.alt ? '\x1b\x1b' : input;
  if (Array.from(input).length !== 1) return null;

  let sequence = modifiers.shift ? input.toUpperCase() : input;
  if (Array.from(sequence).length !== 1) sequence = input;
  if (modifiers.ctrl) {
    const ctrlSequence = toCtrlSequence(sequence);
    if (ctrlSequence === null) return null;
    sequence = ctrlSequence;
  }
  if (modifiers.alt) sequence = `\x1b${sequence}`;
  return sequence;
};

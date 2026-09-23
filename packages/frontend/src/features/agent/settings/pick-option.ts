/** Sentinel for selects that need an explicit "nothing selected" row (Reka rejects an empty string value). */
export const NONE_OPTION = '__none__';

/** Narrows an untyped select payload back to the field's literal union, ignoring anything unknown. */
export const pickOption = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

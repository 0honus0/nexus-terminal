/** Quote one argument for a POSIX-compatible remote shell. */
export const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

/** Docker IDs and names may not contain shell metacharacters. */
export const isSafeDockerIdentifier = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);

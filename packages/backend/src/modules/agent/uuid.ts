import { validate, version } from 'uuid';

export const isAgentUuid = (value: unknown): value is string => {
  if (typeof value !== 'string' || !validate(value)) return false;
  const parsedVersion = version(value);
  return parsedVersion >= 1 && parsedVersion <= 8;
};

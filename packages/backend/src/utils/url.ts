export const getSingleHeaderToken = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .find(Boolean);
};

const normalizeHostname = (hostname: string): string => {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
};

export const normalizeOrigin = (origin: string): string | undefined => {
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
};

export const getHostnameFromOrigin = (origin: string): string | undefined => {
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch {
    return undefined;
  }
};

export const getHostnameFromHostHeader = (hostHeader: string): string | undefined => {
  const token = getSingleHeaderToken(hostHeader);
  if (!token) {
    return undefined;
  }

  try {
    return normalizeHostname(new URL(`http://${token}`).hostname);
  } catch {
    return undefined;
  }
};

import fs from 'node:fs';

const DIRECTORY_BINDINGS = ['/usr', '/etc'] as const;
const MERGED_USR_PATHS = ['/bin', '/sbin', '/lib', '/lib64'] as const;

export const sandboxSystemRuntimeArguments = (): string[] => {
  const args: string[] = [];

  for (const source of DIRECTORY_BINDINGS) {
    if (fs.existsSync(source)) args.push('--ro-bind', source, source);
  }

  for (const source of MERGED_USR_PATHS) {
    if (!fs.existsSync(source)) continue;
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
      args.push('--symlink', fs.readlinkSync(source), source);
      continue;
    }
    args.push('--ro-bind', source, source);
  }

  return args;
};

export const sandboxResolverRuntimeArguments = (): string[] => {
  const resolver = '/etc/resolv.conf';
  if (!fs.existsSync(resolver)) return [];
  const resolved = fs.realpathSync(resolver);
  const preboundPrefixes = [...DIRECTORY_BINDINGS, ...MERGED_USR_PATHS];
  if (
    resolved === resolver ||
    preboundPrefixes.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`))
  ) {
    return [];
  }

  const args: string[] = [];
  const segments = resolved.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments.slice(0, -1)) {
    current += `/${segment}`;
    args.push('--dir', current);
  }
  args.push('--ro-bind', resolved, resolved);
  return args;
};

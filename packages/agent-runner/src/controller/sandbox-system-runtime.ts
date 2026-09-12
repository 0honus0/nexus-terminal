import fs from 'node:fs';

const DIRECTORY_BINDINGS = ['/usr', '/etc'] as const;
const MERGED_USR_PATHS = ['/bin', '/sbin', '/lib', '/lib64'] as const;

export const sandboxSystemRuntimeArguments = (options: { includeEtc?: boolean } = {}): string[] => {
  const args: string[] = [];

  for (const source of DIRECTORY_BINDINGS) {
    if (source === '/etc' && options.includeEtc === false) continue;
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

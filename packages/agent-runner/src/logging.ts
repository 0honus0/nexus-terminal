export type RunnerLogLevel = 'debug' | 'info' | 'warn' | 'error';

type RunnerLogContext = Record<string, unknown>;

const write = (level: RunnerLogLevel, line: string): void => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const runnerLog = (level: RunnerLogLevel, message: string, context: RunnerLogContext = {}): void => {
  write(
    level,
    JSON.stringify({
      level,
      time: new Date().toISOString(),
      service: 'nexus-agent-runner',
      ...context,
      msg: message,
    }),
  );
};

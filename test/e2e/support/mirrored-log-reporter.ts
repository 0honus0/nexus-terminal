import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

function safeName(value: string): string {
  const normalized = value
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return normalized || 'unnamed-test';
}

export default class MirroredLogReporter implements Reporter {
  private testDir = '';
  private logRoot = '';
  private fileByTestId = new Map<string, string>();
  private unexpectedFirstAttempts = new Map<string, string>();
  private specDurationsMs = new Map<string, number>();
  private consoleEnabled = process.env.GITHUB_ACTIONS === 'true' || process.env.E2E_CONSOLE_LOGS === '1';
  private runStartedAt = 0;

  onBegin(config: FullConfig, suite: Suite) {
    this.runStartedAt = Date.now();
    this.testDir = config.projects[0]?.testDir || process.cwd();
    this.logRoot = path.resolve(this.testDir, '..', 'logs');
    fs.rmSync(this.logRoot, { recursive: true, force: true });
    fs.mkdirSync(this.logRoot, { recursive: true });
    this.consoleLog(`[E2E] Starting ${suite.allTests().length} tests with ${config.workers} worker(s)`);
  }

  onTestBegin(test: TestCase, result: TestResult) {
    const file = this.logFileFor(test, result.retry);
    this.fileByTestId.set(test.id, file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        `test: ${test.titlePath().filter(Boolean).join(' > ')}`,
        `source: ${path.relative(this.testDir, test.location.file)}:${test.location.line}`,
        `project: ${test.parent.project()?.name || 'unknown'}`,
        `retry: ${result.retry}`,
        `started: ${new Date().toISOString()}`,
        '',
      ].join('\n'),
      'utf8',
    );
    const retry = result.retry > 0 ? ` retry=${result.retry}` : '';
    this.consoleLog(`\n[E2E] ▶ ${this.consoleTitle(test)}${retry}`);
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    this.append(test, `[STEP START] ${step.title}\n`);
    if (step.category === 'test.step') {
      this.consoleLog(`[E2E]   → ${this.singleLine(step.title)}`);
    }
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    const suffix = step.error ? `FAILED: ${step.error.message}` : 'OK';
    this.append(test, `[STEP END] ${step.title} — ${suffix}\n`);
    if (step.category === 'test.step') {
      const marker = step.error ? '✗' : '✓';
      const duration = Number.isFinite(step.duration) ? ` (${this.formatDuration(step.duration)})` : '';
      this.consoleLog(`[E2E]   ${marker} ${this.singleLine(step.title)}${duration}`);
    }
  }

  onStdOut(chunk: string | Buffer, test?: TestCase) {
    if (!test) return;
    this.append(test, `[stdout] ${chunk.toString()}`);
  }

  onStdErr(chunk: string | Buffer, test?: TestCase) {
    if (!test) return;
    this.append(test, `[stderr] ${chunk.toString()}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.retry === 0) {
      const relativeSpec = path.relative(this.testDir, test.location.file).split(path.sep).join('/');
      const spec = path.posix.join('tests', relativeSpec);
      this.specDurationsMs.set(spec, (this.specDurationsMs.get(spec) || 0) + result.duration);
    }

    this.append(test, `\nstatus: ${result.status}\ndurationMs: ${result.duration}\nfinished: ${new Date().toISOString()}\n`);
    if (result.error) {
      this.append(test, `\n[ERROR]\n${result.error.stack || result.error.message}\n`);
    }
    if (result.attachments.length > 0) {
      this.append(test, '\n[ATTACHMENTS]\n');
      for (const attachment of result.attachments) {
        this.append(test, `${attachment.name}: ${attachment.path || attachment.contentType}\n`);
      }
    }

    if (
      result.retry === 0
      && test.expectedStatus === 'passed'
      && (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted')
    ) {
      this.unexpectedFirstAttempts.set(test.id, test.titlePath().filter(Boolean).join(' > '));
    }

    const marker = result.status === 'passed' ? '✓' : result.status === 'skipped' ? '○' : '✗';
    this.consoleLog(`[E2E] ${marker} ${this.consoleTitle(test)} — ${result.status} (${this.formatDuration(result.duration)})`);
    if (result.error) {
      this.consoleLog(`[E2E]   error: ${this.singleLine(result.error.message)}`);
    }
  }

  onEnd(result: FullResult) {
    const elapsed = this.runStartedAt > 0 ? Date.now() - this.runStartedAt : result.duration;
    this.consoleLog(`\n[E2E] Finished: ${result.status} in ${this.formatDuration(elapsed)}`);
    this.writeSpecTimings();
    if (this.unexpectedFirstAttempts.size === 0) return;

    const summaryFile = path.join(this.logRoot, '_flaky-tests.log');
    const summary = [
      'E2E run contained tests that failed on their first attempt.',
      'Retries are retained for diagnostics, but flaky tests fail CI.',
      '',
      ...Array.from(this.unexpectedFirstAttempts.values()).map((title) => `- ${title}`),
      '',
    ].join('\n');
    fs.writeFileSync(summaryFile, summary, 'utf8');

    // Playwright permits reporters to override the final run status. Keep retry
    // artifacts/logs for diagnosis while preventing a retry-pass from producing
    // a misleading green CI run.
    if (result.status === 'passed') return { status: 'failed' as const };
  }

  private writeSpecTimings(): void {
    if (this.specDurationsMs.size === 0) return;
    const output = process.env.E2E_TIMINGS_OUTPUT
      ? path.resolve(process.env.E2E_TIMINGS_OUTPUT)
      : path.resolve(this.testDir, '..', '.tmp', 'spec-timings.json');
    const specs = Object.fromEntries(
      [...this.specDurationsMs.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([spec, duration]) => [spec, Math.round(duration)]),
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify({ version: 1, specs }, null, 2)}\n`, 'utf8');
    this.consoleLog(`[E2E] Wrote spec timings: ${output}`);
  }

  private logFileFor(test: TestCase, retry = 0): string {
    const relativeSpec = path.relative(this.testDir, test.location.file);
    const parsed = path.parse(relativeSpec);
    const testFolder = path.join(this.logRoot, parsed.dir, parsed.name);
    const retrySuffix = retry > 0 ? `-retry-${retry}` : '';
    return path.join(testFolder, `${safeName(test.title)}${retrySuffix}.log`);
  }

  private append(test: TestCase, value: string) {
    const file = this.fileByTestId.get(test.id) || this.logFileFor(test);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, value, 'utf8');
  }

  private consoleTitle(test: TestCase): string {
    const project = test.parent.project()?.name || 'unknown';
    const title = test.titlePath().filter(Boolean).join(' > ');
    return `[${project}] ${this.singleLine(title)}`;
  }

  private consoleLog(value: string): void {
    if (!this.consoleEnabled) return;
    process.stdout.write(`${value}\n`);
  }

  private singleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private formatDuration(durationMs: number): string {
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }
}

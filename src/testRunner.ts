import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { TestResult } from './types';

export interface ExecResult {
  exitCode: number;
  output: string;
}

export type ExecFn = (command: string, cwd: string) => Promise<ExecResult>;

export interface FsLike {
  exists(path: string): boolean;
  read(path: string): string;
}

export const realFs: FsLike = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf8'),
};

const OUTPUT_TAIL_LINES = 60;
const OUTPUT_TAIL_CHARS = 4000;

export function tailOutput(output: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const lastLines = plain.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
  return lastLines.length > OUTPUT_TAIL_CHARS ? lastLines.slice(-OUTPUT_TAIL_CHARS) : lastLines;
}

/**
 * Best-effort detection of how to run this project's tests, used when the
 * `test-command` input is not provided.
 */
export function detectTestCommand(cwd: string, fs: FsLike): string | undefined {
  const at = (name: string) => `${cwd}/${name}`;

  if (fs.exists(at('package.json'))) {
    try {
      const pkg = JSON.parse(fs.read(at('package.json'))) as {
        scripts?: Record<string, string>;
      };
      const testScript = pkg.scripts?.['test'];
      if (testScript && !testScript.includes('no test specified')) {
        if (fs.exists(at('pnpm-lock.yaml'))) return 'pnpm test';
        if (fs.exists(at('yarn.lock'))) return 'yarn test';
        return 'npm test';
      }
    } catch {
      // Malformed package.json — fall through to other ecosystems.
    }
  }

  if (fs.exists(at('pytest.ini'))) return 'python -m pytest';
  if (fs.exists(at('pyproject.toml')) && /\bpytest\b/.test(fs.read(at('pyproject.toml')))) {
    return 'python -m pytest';
  }
  if (fs.exists(at('go.mod'))) return 'go test ./...';
  if (fs.exists(at('Cargo.toml'))) return 'cargo test';
  if (fs.exists(at('Gemfile')) && /\brspec\b/.test(fs.read(at('Gemfile')))) {
    return 'bundle exec rspec';
  }
  if (fs.exists(at('gradlew'))) return './gradlew test';
  if (fs.exists(at('pom.xml'))) return 'mvn -q test';

  return undefined;
}

export interface RunTestsOptions {
  command?: string;
  cwd: string;
  exec: ExecFn;
  fs: FsLike;
}

export async function runTests(opts: RunTestsOptions): Promise<TestResult> {
  const command = opts.command ?? detectTestCommand(opts.cwd, opts.fs);
  if (!command) {
    return {
      ran: false,
      skippedReason:
        'No test-command input provided and no test setup could be auto-detected',
    };
  }

  const start = Date.now();
  try {
    const { exitCode, output } = await opts.exec(command, opts.cwd);
    return {
      ran: true,
      command,
      passed: exitCode === 0,
      exitCode,
      durationMs: Date.now() - start,
      outputTail: tailOutput(output),
    };
  } catch (err) {
    // The command could not even be spawned; treat it as a failed run so the
    // verdict degrades to weak instead of crashing the whole action.
    return {
      ran: true,
      command,
      passed: false,
      durationMs: Date.now() - start,
      outputTail: String(err),
    };
  }
}

export const defaultExec: ExecFn = (command, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env: { ...process.env, CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    let output = '';
    const capture = (chunk: Buffer) => {
      output += chunk.toString();
      // Cap memory on extremely chatty suites; only the tail is reported anyway.
      if (output.length > 1_000_000) output = output.slice(-500_000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });

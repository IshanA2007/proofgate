import { describe, expect, it } from 'vitest';
import { detectTestCommand, runTests, type FsLike } from '../src/testRunner';

function fakeFs(files: Record<string, string>): FsLike {
  return {
    exists: (p) => p in files,
    read: (p) => files[p] ?? '',
  };
}

const PKG_WITH_TESTS = JSON.stringify({ scripts: { test: 'vitest run' } });
const PKG_PLACEHOLDER = JSON.stringify({
  scripts: { test: 'echo "Error: no test specified" && exit 1' },
});

describe('detectTestCommand', () => {
  it('detects npm test from package.json', () => {
    const fs = fakeFs({ '/repo/package.json': PKG_WITH_TESTS });
    expect(detectTestCommand('/repo', fs)).toBe('npm test');
  });

  it('prefers pnpm/yarn when their lockfiles are present', () => {
    expect(
      detectTestCommand(
        '/repo',
        fakeFs({ '/repo/package.json': PKG_WITH_TESTS, '/repo/pnpm-lock.yaml': '' }),
      ),
    ).toBe('pnpm test');
    expect(
      detectTestCommand(
        '/repo',
        fakeFs({ '/repo/package.json': PKG_WITH_TESTS, '/repo/yarn.lock': '' }),
      ),
    ).toBe('yarn test');
  });

  it('ignores the npm-init placeholder test script', () => {
    const fs = fakeFs({ '/repo/package.json': PKG_PLACEHOLDER });
    expect(detectTestCommand('/repo', fs)).toBeUndefined();
  });

  it('survives malformed package.json', () => {
    const fs = fakeFs({ '/repo/package.json': '{not json', '/repo/go.mod': 'module x' });
    expect(detectTestCommand('/repo', fs)).toBe('go test ./...');
  });

  it('detects pytest from pytest.ini or pyproject.toml', () => {
    expect(detectTestCommand('/repo', fakeFs({ '/repo/pytest.ini': '[pytest]' }))).toBe(
      'python -m pytest',
    );
    expect(
      detectTestCommand(
        '/repo',
        fakeFs({ '/repo/pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]' }),
      ),
    ).toBe('python -m pytest');
  });

  it('does not detect pytest from a pyproject.toml without pytest config', () => {
    const fs = fakeFs({ '/repo/pyproject.toml': '[tool.poetry]\nname = "x"' });
    expect(detectTestCommand('/repo', fs)).toBeUndefined();
  });

  it('detects go, cargo, rspec, gradle, and maven projects', () => {
    expect(detectTestCommand('/repo', fakeFs({ '/repo/go.mod': 'module x' }))).toBe(
      'go test ./...',
    );
    expect(detectTestCommand('/repo', fakeFs({ '/repo/Cargo.toml': '[package]' }))).toBe(
      'cargo test',
    );
    expect(
      detectTestCommand('/repo', fakeFs({ '/repo/Gemfile': "gem 'rspec-rails'" })),
    ).toBe('bundle exec rspec');
    expect(detectTestCommand('/repo', fakeFs({ '/repo/gradlew': '' }))).toBe('./gradlew test');
    expect(detectTestCommand('/repo', fakeFs({ '/repo/pom.xml': '<project/>' }))).toBe(
      'mvn -q test',
    );
  });

  it('returns undefined when nothing is recognized', () => {
    expect(detectTestCommand('/repo', fakeFs({}))).toBeUndefined();
  });
});

describe('runTests', () => {
  it('runs an explicit command and reports success', async () => {
    const calls: string[] = [];
    const result = await runTests({
      command: 'make check',
      cwd: '/repo',
      fs: fakeFs({}),
      exec: async (command) => {
        calls.push(command);
        return { exitCode: 0, output: 'all good' };
      },
    });
    expect(calls).toEqual(['make check']);
    expect(result).toMatchObject({ ran: true, command: 'make check', passed: true, exitCode: 0 });
    expect(result.outputTail).toContain('all good');
    expect(result.durationMs).toBeTypeOf('number');
  });

  it('reports failure with the exit code', async () => {
    const result = await runTests({
      command: 'npm test',
      cwd: '/repo',
      fs: fakeFs({}),
      exec: async () => ({ exitCode: 2, output: '1 test failed' }),
    });
    expect(result).toMatchObject({ ran: true, passed: false, exitCode: 2 });
  });

  it('falls back to auto-detection when no command is given', async () => {
    const calls: string[] = [];
    await runTests({
      cwd: '/repo',
      fs: fakeFs({ '/repo/go.mod': 'module x' }),
      exec: async (command) => {
        calls.push(command);
        return { exitCode: 0, output: '' };
      },
    });
    expect(calls).toEqual(['go test ./...']);
  });

  it('skips cleanly when nothing can be detected', async () => {
    const result = await runTests({
      cwd: '/repo',
      fs: fakeFs({}),
      exec: async () => {
        throw new Error('should not be called');
      },
    });
    expect(result.ran).toBe(false);
    expect(result.skippedReason).toContain('auto-detected');
  });

  it('keeps only the tail of long output', async () => {
    const longOutput = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const result = await runTests({
      command: 'npm test',
      cwd: '/repo',
      fs: fakeFs({}),
      exec: async () => ({ exitCode: 0, output: longOutput }),
    });
    expect(result.outputTail).toContain('line 499');
    expect(result.outputTail).not.toContain('line 0\n');
    expect((result.outputTail ?? '').length).toBeLessThanOrEqual(4000);
  });

  it('treats an exec crash as a failed run, not an action crash', async () => {
    const result = await runTests({
      command: 'npm test',
      cwd: '/repo',
      fs: fakeFs({}),
      exec: async () => {
        throw new Error('spawn ENOENT');
      },
    });
    expect(result).toMatchObject({ ran: true, passed: false });
    expect(result.outputTail).toContain('ENOENT');
  });
});

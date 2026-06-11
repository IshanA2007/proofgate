import { describe, expect, it } from 'vitest';
import {
  isCiFile,
  isSourceFile,
  isTestConfigFile,
  isTestFile,
  prModifiesSource,
} from '../src/classify';
import type { ChangedFile } from '../src/types';

function file(filename: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { filename, status, additions: 1, deletions: 1 };
}

describe('isTestFile', () => {
  it.each([
    'src/utils.test.ts',
    'src/utils.spec.tsx',
    'tests/integration/api.py',
    '__tests__/foo.js',
    'pkg/server_test.go',
    'tests/test_models.py',
    'app/test_views.py',
    'spec/models/user_spec.rb',
    'src/main/java/FooTest.java',
    'Sources/AppTests/AppTest.swift',
  ])('recognizes %s as a test file', (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each([
    'src/utils.ts',
    'pkg/server.go',
    'app/views.py',
    'README.md',
    'src/contest.py',
    'src/protester.rb',
  ])('does not flag %s', (path) => {
    expect(isTestFile(path)).toBe(false);
  });
});

describe('isCiFile', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/release.yaml',
    '.github/actions/setup/action.yml',
    '.circleci/config.yml',
    '.gitlab-ci.yml',
    'Jenkinsfile',
    '.travis.yml',
    'azure-pipelines.yml',
  ])('recognizes %s', (path) => {
    expect(isCiFile(path)).toBe(true);
  });

  it.each(['src/ci.ts', 'docs/.github/workflows/ci.yml', 'workflows/ci.yml'])(
    'does not flag %s',
    (path) => {
      expect(isCiFile(path)).toBe(false);
    },
  );
});

describe('isTestConfigFile', () => {
  it.each([
    'jest.config.js',
    'vitest.config.mts',
    'packages/app/jest.config.ts',
    'pytest.ini',
    'tox.ini',
    'codecov.yml',
    '.coveragerc',
    'phpunit.xml.dist',
    '.mocharc.json',
    '.rspec',
  ])('recognizes %s', (path) => {
    expect(isTestConfigFile(path)).toBe(true);
  });

  it.each(['next.config.js', 'tsconfig.json', 'src/config.ts'])(
    'does not flag %s',
    (path) => {
      expect(isTestConfigFile(path)).toBe(false);
    },
  );
});

describe('isSourceFile / prModifiesSource', () => {
  it('treats ordinary code as source', () => {
    expect(isSourceFile('src/index.ts')).toBe(true);
    expect(isSourceFile('lib/parser.py')).toBe(true);
  });

  it('excludes tests, CI, test configs, and docs', () => {
    expect(isSourceFile('src/index.test.ts')).toBe(false);
    expect(isSourceFile('.github/workflows/ci.yml')).toBe(false);
    expect(isSourceFile('jest.config.js')).toBe(false);
    expect(isSourceFile('README.md')).toBe(false);
  });

  it('prModifiesSource is true only when a source file changed', () => {
    expect(prModifiesSource([file('src/a.ts'), file('tests/a.test.ts')])).toBe(true);
    expect(prModifiesSource([file('tests/a.test.ts'), file('README.md')])).toBe(false);
  });
});

import type { ChangedFile } from './types';

const TEST_FILE_PATTERNS: RegExp[] = [
  /(^|\/)(tests?|__tests__|specs?)\//i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /_test\.(go|py|rb|ex|exs|c|cc|cpp)$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /Tests?\.(java|kt|kts|scala|cs|swift|php)$/,
  /(_spec|_test)\.rb$/i,
];

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

const CI_FILE_PATTERNS: RegExp[] = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/i,
  /^\.github\/actions\//i,
  /^\.circleci\//i,
  /^\.gitlab-ci\.ya?ml$/i,
  /^Jenkinsfile/,
  /^\.travis\.ya?ml$/i,
  /^azure-pipelines\.ya?ml$/i,
  /^\.buildkite\//i,
];

export function isCiFile(path: string): boolean {
  return CI_FILE_PATTERNS.some((re) => re.test(path));
}

const TEST_CONFIG_PATTERNS: RegExp[] = [
  /(^|\/)(jest|vitest|karma|playwright|cypress)\.config\.[cm]?[jt]s$/i,
  /(^|\/)pytest\.ini$/i,
  /(^|\/)tox\.ini$/i,
  /(^|\/)\.mocharc(\.[a-z]+)?$/i,
  /(^|\/)codecov\.ya?ml$/i,
  /(^|\/)\.coveragerc$/i,
  /(^|\/)phpunit\.xml(\.dist)?$/i,
  /(^|\/)\.rspec$/i,
];

export function isTestConfigFile(path: string): boolean {
  return TEST_CONFIG_PATTERNS.some((re) => re.test(path));
}

const DOC_PATTERNS: RegExp[] = [/\.(md|markdown|rst|txt|adoc)$/i, /^docs\//i, /^LICENSE/i];

/**
 * Anything that is not a test, CI config, test config, or documentation.
 * Used to decide whether suspicious test changes accompany behavior changes,
 * which is what separates gaming from routine test maintenance.
 */
export function isSourceFile(path: string): boolean {
  if (isTestFile(path) || isCiFile(path) || isTestConfigFile(path)) return false;
  if (DOC_PATTERNS.some((re) => re.test(path))) return false;
  return true;
}

export function prModifiesSource(files: ChangedFile[]): boolean {
  return files.some((f) => isSourceFile(f.filename));
}

/** Rough one-line summary of where a changeset concentrates. */
export function describeChangeSurface(files: string[]): string {
  const tests = files.filter((f) => isTestFile(f));
  const ci = files.filter((f) => isCiFile(f));
  if (tests.length > ci.length && tests.length > 0) {
    return `mostly tests (${tests.length} file(s))`;
  }
  if (ci.length > 0) {
    return `touches CI (${ci.length} file(s))`;
  }
  return 'source-only';
}

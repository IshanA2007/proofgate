# 🛡️ ProofGate

**Proof-of-work for pull requests.** ProofGate shifts the burden of proof from the maintainer back onto the contributor.

AI coding agents have made it nearly free to generate plausible-looking pull requests — and left maintainers manually verifying every one of them. Every existing tool tries to help maintainers review *faster*. ProofGate does the opposite: it makes the contributor *prove* their PR works before a maintainer spends a minute on it.

When a PR opens, ProofGate:

1. **Runs the project's test suite** in a clean CI environment (auto-detected, or your command).
2. **Diffs patch coverage** — every changed line must be exercised by tests, or the verdict degrades.
3. **Pins the base branch's tests** — reruns the suite with the base versions of any tests the PR modified; a pass→fail divergence means the PR rewrote tests to hide a regression.
4. **Scans the diff for test-gaming tricks** — deleted tests, skipped/focused tests, hollowed-out assertions, CI tampering, lowered coverage thresholds, neutered test scripts.
5. **Checks the contributor attestation** — a short AI-disclosure and comprehension checklist in the PR description.
6. **Posts one clear verdict** as a sticky PR comment, job summary, and (via the App) a Check Run:

| Verdict | Meaning |
| --- | --- |
| ✅ **STRONG** | Tests pass, no gaming signals, attestation complete. Review on the merits. |
| ⚠️ **WEAK** | Proof is incomplete — failing/unrunnable tests, missing attestation, or suspicious changes needing human eyes. |
| 🚨 **GAMING DETECTED** | The PR weakens its own verification. Don't trust its green checks. |

A maintainer triages in seconds instead of an hour.

## Quick start

```yaml
# .github/workflows/proofgate.yml
name: ProofGate

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write   # needed to post the verdict comment

# One run per PR at a time — avoids duplicate verdict comments from rapid pushes.
concurrency:
  group: proofgate-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  proofgate:
    runs-on: ubuntu-latest
    timeout-minutes: 15   # backstop for hanging test suites
    steps:
      - uses: actions/checkout@v4
      # Set up your toolchain and install dependencies so tests can run:
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - uses: IshanA2007/proofgate@v1
```

Then copy [`templates/pull_request_template.md`](templates/pull_request_template.md) to `.github/pull_request_template.md` so every PR starts with the attestation section.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token for reading the diff and posting the comment. |
| `test-command` | auto-detected | Command that runs your tests. Auto-detection covers npm/pnpm/yarn, pytest, `go test`, `cargo test`, rspec, gradle, and maven. |
| `coverage-command` | — | Runs **instead of** `test-command` and should emit a coverage report, e.g. `npx vitest run --coverage` or `pytest --cov --cov-report=lcov`. |
| `coverage-file` | auto-detected | Coverage report path (lcov or Go coverprofile). Auto-detects `lcov.info`, `coverage/lcov.info`, `coverage.lcov`, `coverage.out`. |
| `patch-coverage-threshold` | `50` | Minimum % of changed lines covered by tests; below it the verdict is WEAK. `0` disables. |
| `require-tests` | `true` | When coverage is unavailable, flag source-only PRs that touch no tests. |
| `base-test-pinning` | `auto` | Rerun the suite with base-branch test files: `auto` (only when the PR modified existing tests), `always`, `off`. |
| `require-attestation` | `true` | Require the "ProofGate Attestation" section in the PR description. |
| `fail-on` | `gaming` | When to fail the check: `gaming`, `weak`, or `never`. |
| `working-directory` | `.` | Directory in which tests are detected and run. |
| `mode` | `check` | `post` is for `workflow_run` relay jobs — see Fork PRs below. |
| `report-path` | `proofgate-report` | Where the downloaded artifact lives (`mode: post` only). |

## Outputs

| Output | Description |
| --- | --- |
| `verdict` | `strong`, `weak`, or `gaming-detected` |
| `tests-passed` | `"true"` / `"false"` |
| `findings` | JSON array of gaming-scan findings |
| `patch-coverage` | Percent of changed lines covered by tests (empty when not computed) |

## Patch coverage

With `coverage-command` (or a `coverage-file`) configured, ProofGate intersects the coverage report with the PR's added lines: a PR that adds code no test exercises cannot be STRONG, no matter how green the suite is. The comment shows the exact uncovered lines per file, plus any changed source file that never appears in the report at all (usually: never imported by any test). Supports lcov (vitest/jest/c8/nyc, pytest-cov, cargo-llvm-cov, simplecov-lcov) and Go's native coverprofile.

## Base-branch test pinning

The strongest anti-gaming measure: when a PR modifies or deletes existing test files, ProofGate restores the **base branch's versions** of those files, reruns the suite against the PR's source, then resets the worktree. The contributor can't weaken tests they don't control — so *"PR suite passes, base-pinned suite fails"* is direct evidence the PR rewrote tests to hide a regression, and yields 🚨 GAMING DETECTED. Costs a second test run only when tests were actually touched (`auto`).

## What the gaming scan catches

- **Deleted tests** — test files removed, or test cases stripped from existing files, while source changes.
- **Skipped / narrowed tests** — `it.skip`, `it.only`, `xdescribe`, `@pytest.mark.skip`, `t.Skip`, `#[ignore]`, focused tests that silently exclude the rest of the suite.
- **Weakened assertions** — net drops in assertion counts, and always-true assertions like `expect(true).toBe(true)` or `assert True`.
- **CI tampering** — workflow edits that remove test steps, add `continue-on-error: true` or `if: false`, delete CI files, lower coverage thresholds, or neuter the npm `test` script.

High-severity signals produce **GAMING DETECTED** regardless of test results — green checks mean nothing if the PR weakened the checks themselves. Medium signals (e.g. routine CI edits, test-only cleanups) produce **WEAK** so a human looks. Findings always include file, line, and evidence so false positives are cheap to dismiss.

## The attestation

ProofGate looks for this section in the PR description:

```markdown
### ProofGate Attestation

AI tools used: none

- [x] I have disclosed all AI assistance used to produce this PR above
- [x] I ran the project's full test suite locally and it passes
- [x] I understand this change and can explain every line of it
```

Using AI tools is fine — undisclosed AI use is not. An unchecked box, an empty disclosure, or a deleted checklist keeps the verdict at WEAK. Set `require-attestation: false` to disable.

## Fork PRs

On `pull_request` events from forks the default token is read-only, so the check job can't comment. ProofGate solves this without ever giving PR code a privileged token — every run uploads a `proofgate-report` artifact, and either of two relays delivers it:

1. **Relay workflow** (no hosting needed): copy [`templates/proofgate-comment.yml`](templates/proofgate-comment.yml) into `.github/workflows/`. It triggers on `workflow_run`, downloads the artifact, and runs the action in `mode: post`.
2. **The ProofGate App** (see [`app/`](app/README.md)): also publishes a proper **Check Run** you can require in branch protection, works org-wide, and needs no per-repo relay workflow.

Both relays **recompute the gaming scan and attestation from the API** and take only test/coverage/pinning outcomes from the artifact (labeled as CI-reported in the comment). PR code can fake its own test results — true of any CI — but it cannot launder a gamed diff into a STRONG verdict, because that decision never runs on PR-controlled infrastructure.

## Security

- **Do not** use `pull_request_target` with a checkout of the PR head — that runs untrusted code with access to secrets. The relay patterns above exist precisely so you never need to.
- ProofGate runs the repository's tests on the PR's merged code — the same exposure as any CI that tests contributions. Keep `permissions` minimal as in the quick start.
- `test-command` and `working-directory` are **maintainer-trusted inputs**: the command runs via the shell on the runner. Never derive them from PR content (title, body, labels, branch names).

## Development

```bash
npm ci
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # bundles src/main.ts to dist/ with ncc (commit dist/)
```

The analysis pipeline is pure functions over the PR diff (`src/detectors/`), the attestation parser (`src/attestation.ts`), the verdict engine (`src/verdict.ts`), and the report renderer (`src/report.ts`); `src/main.ts` is a thin shell over `@actions/core` and Octokit.

## Roadmap (not yet implemented)

- Semantic (LLM-assisted) diff review and comprehension challenges
- Contributor history / reputation signals via the App

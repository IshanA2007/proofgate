# 🛡️ ProofGate

**Proof-of-work for pull requests.** ProofGate shifts the burden of proof from the maintainer back onto the contributor.

AI coding agents have made it nearly free to generate plausible-looking pull requests — and left maintainers manually verifying every one of them. Every existing tool tries to help maintainers review *faster*. ProofGate does the opposite: it makes the contributor *prove* their PR works before a maintainer spends a minute on it.

When a PR opens, ProofGate:

1. **Runs the project's test suite** in a clean CI environment (auto-detected, or your command).
2. **Scans the diff for test-gaming tricks** — deleted tests, skipped/focused tests, hollowed-out assertions, CI tampering, lowered coverage thresholds, neutered test scripts.
3. **Checks the contributor attestation** — a short AI-disclosure and comprehension checklist in the PR description.
4. **Posts one clear verdict** as a sticky PR comment and job summary:

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
      - uses: your-org/proofgate@v1
```

Then copy [`templates/pull_request_template.md`](templates/pull_request_template.md) to `.github/pull_request_template.md` so every PR starts with the attestation section.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token for reading the diff and posting the comment. |
| `test-command` | auto-detected | Command that runs your tests. Auto-detection covers npm/pnpm/yarn, pytest, `go test`, `cargo test`, rspec, gradle, and maven. |
| `require-attestation` | `true` | Require the "ProofGate Attestation" section in the PR description. |
| `fail-on` | `gaming` | When to fail the check: `gaming`, `weak`, or `never`. |
| `working-directory` | `.` | Directory in which tests are detected and run. |

## Outputs

| Output | Description |
| --- | --- |
| `verdict` | `strong`, `weak`, or `gaming-detected` |
| `tests-passed` | `"true"` / `"false"` |
| `findings` | JSON array of gaming-scan findings |

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

## Fork PRs and security

- On `pull_request` events from **forks**, the default `GITHUB_TOKEN` is read-only: ProofGate still produces the verdict in the **job summary** and outputs, but cannot post the PR comment (you'll see a warning, not a failure).
- **Do not** switch to `pull_request_target` with a checkout of the PR head to work around this — that runs untrusted code with access to secrets. If you need comments on fork PRs, use a separate `workflow_run` workflow that posts the stored verdict with a privileged token.
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

- GitHub App for org-wide install and fork-PR comments
- Coverage diffing
- Semantic (LLM-assisted) diff review

_Currently validating ProofGate against its own pull requests._

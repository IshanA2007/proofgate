# ProofGate App

The hosted half of ProofGate. The Action analyzes PRs inside CI; this App delivers verdicts where the Action's token cannot:

- Posts the sticky **verdict comment on fork PRs** (the Action's `GITHUB_TOKEN` is read-only there).
- Publishes a proper **Check Run** (`ProofGate: strong | weak | gaming-detected`) you can require in branch protection.

## How it works

1. The Action (check mode) uploads a `proofgate-report` artifact on every run: the rendered report plus `meta.json` (test, coverage, and pinning results).
2. The App receives the `workflow_run.completed` webhook, finds the artifact, and resolves the PR **from the run's head SHA** — never from the artifact, which PR code could forge.
3. It **recomputes the gaming scan and attestation server-side** via the API, takes only test/coverage/pinning outcomes from the artifact (labeled "as reported by CI"), upserts the comment, and creates the Check Run.

A malicious PR can fake its own test results — that is true of every CI system — but it cannot launder a gamed diff into a STRONG verdict, because the scan that decides that never runs on PR-controlled infrastructure.

**Known limit of this model:** test, coverage, and base-pinning outcomes in `meta.json` are CI-attested, so PR-controlled CI could forge them (e.g. report `regression: false`). The diff scan and attestation are immune; results that depend on executing tests are only as trustworthy as the job that ran them. The comment labels them accordingly.

## Register the App (one-time, ~2 minutes)

```bash
npm ci
npm run app:dev          # starts the setup wizard on http://localhost:3000
```

Open http://localhost:3000 and click **Register GitHub App** — the manifest in `app.yml` pre-fills the name, permissions (`checks: write`, `pull_requests: write`, `contents: read`, `actions: read`), and the `workflow_run` event. Probot writes `APP_ID`, `PRIVATE_KEY`, and `WEBHOOK_SECRET` into `app/.env` and wires a smee.io webhook proxy for local development.

Then install the App on the repositories you want it to serve (GitHub → Settings → Applications).

## Deploy

Any Node 20 host works. With the Dockerfile (build from the **repo root**):

```bash
docker build -f app/Dockerfile -t proofgate-app .
docker run -p 3000:3000 -e APP_ID -e PRIVATE_KEY -e WEBHOOK_SECRET proofgate-app
```

Fly.io example:

```bash
fly launch --no-deploy --dockerfile app/Dockerfile
fly secrets set APP_ID=... WEBHOOK_SECRET=... PRIVATE_KEY="$(cat proofgate.private-key.pem)"
fly deploy
```

After deploying, update the App's **Webhook URL** (GitHub → Settings → Developer settings → GitHub Apps → proofgate) to `https://<your-host>/api/github/webhooks`.

## Local development

```bash
npm run app:typecheck   # tsc -p app
npm test                # handler tests run in the main vitest suite
npm run app:dev         # tsx watch + smee proxy (uses app/.env)
```

The webhook handler core (`src/handler.ts`) is framework-free and fully covered by `tests/app/handler.test.ts`; Probot only appears at the wiring edge (`src/index.ts`).

# r-universe-cron

A Cloudflare worker that keeps hourly GitHub Actions workflows running. GitHub's scheduler often
skips `schedule:` runs when it is busy, sometimes for hours. Every 15 minutes this worker checks the
latest run of each workflow in [`src/targets.js`](src/targets.js), and if it was created more than
`maxAge` minutes ago (default 55), it starts the workflow with a `workflow_dispatch` event.

The worker authenticates as a GitHub App owned by the `r-universe` org, which can be installed on
repositories in any organization. It only acts on the repositories listed in `src/targets.js`:
installing the app does nothing by itself.

## Add a workflow

1. The workflow needs a `workflow_dispatch:` trigger. Keep its `schedule:` as well: the worker
   only dispatches when the scheduled runs are missing. Add `concurrency:` to the workflow if two
   runs must never overlap.
2. Install the app on the repository (see below), choosing *Only select repositories*.
3. Add the repository, workflow file and branch to `src/targets.js`, and deploy.

## The GitHub App

Owned by the `r-universe` org, with its settings at
https://github.com/organizations/r-universe/settings/apps/r-universe-cron. It was created with:

 - **Name**: `r-universe-cron`, **Homepage URL**: this repository.
 - **Webhook**: uncheck *Active* (the worker needs no events).
 - **Repository permissions**: *Actions: Read and write*. (*Metadata: Read-only* is added
   automatically.) Nothing else.
 - **Where can this GitHub App be installed?**: *Any account*. A private app can only be installed
   on `r-universe` itself, not on e.g. `r-devel`.

Afterwards, on the app's page:

 - Note the **App ID** and put it in `GITHUB_APP_ID` in `wrangler.toml`.
 - *Generate a private key*, which downloads a `.pem` file (see below).
 - *Install App* (public page: https://github.com/apps/r-universe-cron) on each repository in
   `src/targets.js`. Installing in another organization needs an owner of that organization.

## Deploy

```sh
npx wrangler login     # an account with access to rOpenSci Main
npx wrangler deploy
```

The private key is a [secret](https://developers.cloudflare.com/workers/configuration/secrets/)
of the worker, never part of the code or `wrangler.toml`:

```sh
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < r-universe-cron.2026-11-07.private-key.pem
rm r-universe-cron.*.private-key.pem
```

The key can be stored as downloaded (`BEGIN RSA PRIVATE KEY`, PKCS#1). The worker converts it
for WebCrypto, so you don't need `openssl`. Secrets are encrypted, can't be read back, and are
kept when the worker is redeployed. Delete the `.pem` file afterwards: you can generate a new key on
GitHub at any time.

To rotate the key: generate a new key on the app's page, `wrangler secret put` it, then delete the
old key on GitHub. An app can have multiple keys, so the worker keeps working throughout.

## Logs

Each run logs what it did per workflow (`skipped`, with the age of the latest run, or
`dispatched`). If a workflow fails (e.g. the app isn't installed on the repository, or the workflow
has no `workflow_dispatch:`), the others still run, but the invocation fails with the errors. See
the worker in the Cloudflare dashboard (*Logs* and *Cron events*), or follow live with:

```sh
npx wrangler tail r-universe-cron
```

## Test

```sh
npm test
```

The tests use a fake GitHub API and run in Node. To run the actual worker locally against GitHub
(this dispatches real workflows), put the secret in `.dev.vars`, e.g. with
`printf 'GITHUB_APP_PRIVATE_KEY="%s"\n' "$(cat key.pem)" > .dev.vars`, then:

```sh
npm run dev
curl "http://localhost:8787/__scheduled"
```

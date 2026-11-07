// Workflows to keep running. A workflow is dispatched when its latest run (of any kind: schedule,
// dispatch, push) was created more than `maxAge` minutes ago. The GitHub App must be installed on
// the repository, and the workflow must have a `workflow_dispatch:` trigger.
export const TARGETS = [
  { repo: 'r-devel/linux-arm64-checks', workflow: 'updates.yml', ref: 'main', maxAge: 90 },
  { repo: 'r-universe-org/control-room', workflow: 'sync.yml', ref: 'main', maxAge: 90 }
];

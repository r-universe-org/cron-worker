import { TARGETS } from './targets.js';
import { appJwt, github, installationTokens } from './github.js';

export default {
  async scheduled(event, env, ctx) {
    await run(env, TARGETS);
  }
};

// Dispatch every target whose latest run is too old. Errors of one target do not stop the others,
// but fail the invocation afterwards, so that they show up in the cron events of the worker.
export async function run(env, targets, { fetch = globalThis.fetch, now = Date.now() } = {}) {
  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, now);
  const tokenFor = installationTokens(jwt, fetch);
  const results = await Promise.allSettled(targets.map(async target => {
    const { repo, workflow, ref, maxAge = 55 } = target;
    const token = await tokenFor(repo);
    const { workflow_runs } = await github(`/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`, { token, fetch });
    const latest = workflow_runs[0];
    const age = latest ? (now - Date.parse(latest.created_at)) / 60000 : Infinity;
    if (age < maxAge) {
      console.log(`${repo} ${workflow}: latest run ${Math.round(age)} min ago (${latest.event}, ${latest.status}), skipping`);
      return 'skipped';
    }
    await github(`/repos/${repo}/actions/workflows/${workflow}/dispatches`, { token, method: 'POST', body: { ref }, fetch });
    console.log(`${repo} ${workflow}: ${latest ? `latest run ${Math.round(age)} min ago` : 'no runs'}, dispatched`);
    return 'dispatched';
  }));
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
  if (errors.length) {
    throw new Error(`${errors.length} of ${targets.length} targets failed: ${errors.map(e => e.message).join('; ')}`);
  }
  return results.map(r => r.value);
}

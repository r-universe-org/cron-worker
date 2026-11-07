import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { appJwt } from '../src/github.js';
import { run } from '../src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' });
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' });

function verify(jwt) {
  const [header, payload, sig] = jwt.split('.');
  const ok = createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, Buffer.from(sig, 'base64url'));
  return ok && JSON.parse(Buffer.from(payload, 'base64url'));
}

test('signs a JWT with a PKCS#1 key (as downloaded from GitHub)', async () => {
  const claims = verify(await appJwt(123, pkcs1, 1_000_000_000_000));
  assert.deepEqual(claims, { iat: 999_999_940, exp: 1_000_000_540, iss: '123' });
});

test('signs a JWT with a PKCS#8 key', async () => {
  assert.ok(verify(await appJwt(123, pkcs8)));
});

// Fake GitHub API: one installation per owner, and the time of the latest run per repository.
function fakeGitHub(latest) {
  const calls = [];
  const fetch = async (url, { method, headers, body }) => {
    const path = new URL(url).pathname;
    calls.push(`${method} ${path}`);
    const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
    let m;
    if ((m = path.match(/^\/repos\/([^/]+)\/[^/]+\/installation$/))) {
      assert.ok(verify(headers.Authorization.replace('Bearer ', '')));
      return json({ id: `inst-${m[1]}` });
    }
    if ((m = path.match(/^\/app\/installations\/(.+)\/access_tokens$/))) {
      return json({ token: `token-${m[1]}` }, 201);
    }
    if ((m = path.match(/^\/repos\/([^/]+\/[^/]+)\/actions\/workflows\/[^/]+\/runs$/))) {
      if (!(m[1] in latest)) return json({ message: 'Not Found' }, 404);
      const runs = latest[m[1]] ? [{ created_at: latest[m[1]], event: 'schedule', status: 'completed' }] : [];
      return json({ workflow_runs: runs });
    }
    if ((m = path.match(/^\/repos\/([^/]+)\/[^/]+\/actions\/workflows\/[^/]+\/dispatches$/))) {
      assert.equal(headers.Authorization, `Bearer token-inst-${m[1]}`);
      assert.deepEqual(JSON.parse(body), { ref: 'main' });
      return json(null, 204);
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { fetch, calls };
}

const env = { GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY: pkcs1 };
const now = Date.parse('2026-11-07T12:00:00Z');

test('dispatches only workflows without a recent run', async () => {
  const { fetch, calls } = fakeGitHub({
    'a/old': '2026-11-07T10:30:00Z',
    'a/recent': '2026-11-07T11:30:00Z',
    'b/never': null
  });
  const targets = ['a/old', 'a/recent', 'b/never'].map(repo => ({ repo, workflow: 'x.yml', ref: 'main', maxAge: 55 }));
  assert.deepEqual(await run(env, targets, { fetch, now }), ['dispatched', 'skipped', 'dispatched']);
  // One installation token per owner
  assert.equal(calls.filter(c => c.endsWith('/access_tokens')).length, 2);
  assert.equal(calls.filter(c => c.endsWith('/dispatches')).length, 2);
});

test('a failing target does not stop the others, but fails the run', async () => {
  const { fetch, calls } = fakeGitHub({ 'a/old': '2026-11-07T10:30:00Z' });
  const targets = ['a/gone', 'a/old'].map(repo => ({ repo, workflow: 'x.yml', ref: 'main' }));
  await assert.rejects(run(env, targets, { fetch, now }), /1 of 2 targets failed: GET \/repos\/a\/gone.*404/);
  assert.ok(calls.includes('POST /repos/a/old/actions/workflows/x.yml/dispatches'));
});

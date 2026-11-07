// Authentication as a GitHub App: sign a JWT with the app's private key, and exchange it for an
// installation token (valid 1 hour) of the installation on a repository.

const API = 'https://api.github.com';

export async function github(path, { token, method = 'GET', body, fetch = globalThis.fetch } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'r-universe-cron',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body && { 'Content-Type': 'application/json' })
    },
    body: body && JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function appJwt(appId, pem, now = Date.now()) {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000) - 60; // allow for clock drift
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 600, iss: String(appId) }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

// Installation tokens, one per installation (repositories of the same owner usually share one).
export function installationTokens(jwt, fetch) {
  const tokens = new Map();
  return async function (repo) {
    const { id } = await github(`/repos/${repo}/installation`, { token: jwt, fetch });
    if (!tokens.has(id)) {
      tokens.set(id, github(`/app/installations/${id}/access_tokens`, { token: jwt, method: 'POST', fetch })
        .then(res => res.token));
    }
    return tokens.get(id);
  };
}

// GitHub hands out keys in PKCS#1 (BEGIN RSA PRIVATE KEY), WebCrypto only imports PKCS#8
// (BEGIN PRIVATE KEY). Accept both: wrap a PKCS#1 key in a PKCS#8 structure.
export function pemToPkcs8(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  if (!pem.includes('BEGIN RSA PRIVATE KEY')) {
    return der;
  }
  const version = [0x02, 0x01, 0x00];
  const rsaEncryption = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return asn1(0x30, [...version, ...rsaEncryption, ...asn1(0x04, der)]);
}

function asn1(tag, content) {
  const len = [];
  for (let n = content.length; n > 0; n >>= 8) len.unshift(n & 0xff);
  const header = content.length < 128 ? [tag, content.length] : [tag, 0x80 | len.length, ...len];
  return Uint8Array.from([...header, ...content]);
}

function b64url(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

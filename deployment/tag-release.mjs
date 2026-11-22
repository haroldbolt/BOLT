import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [environment, address, revision] = process.argv.slice(2);
assert(['production', 'demo'].includes(environment), 'Use production or demo.');
assert(/^[a-f0-9]{40}$/.test(revision), 'Use the full deployed Git commit.');
const origin = new URL(address);
assert(origin.protocol === 'https:' && origin.origin === address, 'Use the exact HTTPS origin.');
const response = await fetch(new URL('/api/v1/health', origin), { redirect: 'error', signal: AbortSignal.timeout(10000) });
assert(response.ok, 'Health check failed.');
const health = await response.json();
assert(health.status === 'ok' && health.service === 'Bolt Pets Authoritative Backend' && health.revision === revision, 'Live release does not match.');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
git('cat-file', '-e', revision + '^{commit}');
if (environment === 'production') {
  git('fetch', 'origin', 'refs/heads/main');
  git('merge-base', '--is-ancestor', revision, 'FETCH_HEAD');
}
const tag = 'bolt-' + environment + '-' + revision;
const ref = 'refs/tags/' + tag;
const remote = git('ls-remote', 'origin', ref);
if (remote) {
  assert.equal(remote.split(/\s+/)[0], revision, 'Remote tag conflict.');
} else {
  git('push', 'origin', revision + ':' + ref);
}
assert.equal(git('ls-remote', 'origin', ref).split(/\s+/)[0], revision);
console.log(tag);

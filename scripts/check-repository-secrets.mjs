import path from 'node:path';
import { spawnSync } from 'node:child_process';

const envTemplates = new Set(['.env.example', '.env.customer.example']);
const privateDirectories = new Set(['.bolt-private', '.bolt-storage', 'private-entrance-photos']);
const privateFilename = /^(?:\.env(?:$|[.-])|\.bolt-admin-volume\.json$|persisted-.*\.json$)|\.(?:p8|p12|pfx|key)$/i;
const protectedVariable = /(?:_API_KEY|_SECRET|_PASSWORD|_SETUP_TOKEN|_ACCESS_TOKEN|_USER_TOKEN|_DATABASE_URL|_PRIVATE_KEY|_WEBHOOK_URL|_ADMIN_EMAIL|_BOOTSTRAP_EMAIL)$/;
const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

// POSIX extended expressions for git grep. It returns filenames only, never matching lines.
const credentialPattern = [
  'AIza[A-Za-z0-9_-]{35}',
  'shp(at|ca|pa|ss)_[A-Fa-f0-9]{32}',
  'sk-(proj-|svcacct-)?[A-Za-z0-9_-]{36,}',
  're_[A-Za-z0-9]{8}_[A-Za-z0-9]{24,}',
  'prv_(prod|test)_[A-Za-z0-9_-]{24,}',
  'GOCSPX-[A-Za-z0-9_-]{20,}',
  'gh[pousr]_[A-Za-z0-9]{36,}',
  '^[[:space:]]*-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[[:space:]]*$',
  '"(passwordHash|accountDigest)"[[:space:]]*:[[:space:]]*"[A-Fa-f0-9]{64,128}"',
  '"guestSecret"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]{35,}"',
  '"secretDeliveryCode"[[:space:]]*:[[:space:]]*"[0-9]{4,8}"',
].join('|');

function git(args, allowNoMatch = false) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && !(allowNoMatch && result.status === 1))) {
    throw new Error('No se pudo comprobar el contenido de Git.');
  }
  return result.stdout;
}

function paths(output) {
  return output.split('\0').filter(Boolean);
}

function scan(revision) {
  const staged = revision === undefined;
  const files = paths(staged
    ? git(['ls-files', '--cached', '-z'])
    : git(['ls-tree', '-r', '-z', '--name-only', revision]));
  const privatePaths = files.filter(file => !envTemplates.has(file) && (
    file.split('/').some(part => privateDirectories.has(part)) || privateFilename.test(path.posix.basename(file))
  ));
  const credentialFiles = paths(git([
    'grep', ...(staged ? ['--cached'] : []), '-I', '-l', '-z', '-E', '-e', credentialPattern,
    ...(staged ? [] : [revision]), '--', '.',
  ], true));

  let secretDefaults = 0;
  for (const file of envTemplates) {
    if (!files.includes(file)) continue;
    const body = git(['show', (revision ?? '') + ':' + file]);
    for (const line of body.split(/\r?\n/)) {
      const entry = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (entry && protectedVariable.test(entry[1]) && !/^(?:""|'')?(?:\s*#.*)?$/.test(entry[2])) secretDefaults++;
    }
  }

  // A filename may itself contain private data. Suppress filenames, values and raw Git errors.
  if (privatePaths.length || credentialFiles.length || secretDefaults) {
    const context = staged ? 'índice' : revision.slice(0, 12);
    throw new Error(context + ' — rutas privadas: ' + privatePaths.length +
      ', archivos con material de credencial: ' + credentialFiles.length +
      ', valores sensibles en plantillas: ' + secretDefaults + '.');
  }
}

try {
  const args = process.argv.slice(2);
  scan();
  if (args.length) {
    if (args.length !== 3 || args[0] !== '--pr' || !objectId.test(args[1]) || !objectId.test(args[2])) {
      throw new Error('Uso: node scripts/check-repository-secrets.mjs [--pr <sha-base> <sha-rama>]');
    }
    const commits = git(['rev-list', '--reverse', args[1] + '..' + args[2]]).trim().split('\n').filter(Boolean);
    for (const revision of commits) scan(revision);
  }
  console.log('Control de archivos privados y credenciales de Git completado.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

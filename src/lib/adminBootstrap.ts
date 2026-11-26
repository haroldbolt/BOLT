import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ADMIN_VOLUME_MARKER = '.bolt-admin-volume.json';
const HOUR = 60 * 60 * 1000;
const GRANT = 'installation.json';
type Stage = 'armed' | 'reserved' | 'closed';
type Mode = 'prepare' | 'adopt';

export interface AdminBinding {
  installationId: string;
  volumeId: string;
  accountDigest: string;
}

interface Grant extends AdminBinding {
  version: 1;
  mode: Mode;
  authPath: string;
  expiresAt: number;
  legacyDigest?: string;
}

function recovery(): never {
  throw Error('Alta administrativa cerrada. Verifica el registro externo y recupera la instalación autorizada.');
}

function digest(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function accountDigest(volumeId: string, email: string) {
  return digest(volumeId + '\0' + email.trim().toLowerCase());
}

function bindingOf(grant: AdminBinding): AdminBinding {
  const { installationId, volumeId, accountDigest } = grant;
  return { installationId, volumeId, accountDigest };
}

function grantDigest(grant: Grant) {
  return digest(JSON.stringify([grant.version, grant.installationId, grant.volumeId, grant.accountDigest,
    grant.mode, grant.authPath, grant.expiresAt, grant.legacyDigest ?? null]));
}

function sameBinding(a: AdminBinding, b: AdminBinding) {
  return a?.installationId === b.installationId && a.volumeId === b.volumeId && a.accountDigest === b.accountDigest;
}

function entry(file: string) {
  return fs.lstatSync(file, { throwIfNoEntry: false });
}

function location(file: string): string {
  // Resolve existing ancestors too: the pilot checks its path before creating the runtime tree.
  if (entry(file)) return fs.realpathSync(file);
  return path.join(location(path.dirname(file)), path.basename(file));
}

function isWithin(file: string, directory: string) {
  const rel = path.relative(directory, file);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

// realpath resolves symbolic links, but bind mounts may give a directory two distinct paths.
function containsDirectory(directory: string, candidate: string) {
  const parent = fs.statSync(directory, {bigint:true});
  for (let current = candidate; ; current = path.dirname(current)) {
    const stat = fs.statSync(current, {bigint:true});
    if (stat.dev === parent.dev && stat.ino === parent.ino) return true;
    if (current === path.dirname(current)) return false;
  }
}

function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function privateJson(file: string): any {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 8192) recovery();
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch { return recovery(); } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Publish complete data without overwriting any winning process or existing installation. */
function createOnce(file: string, data: object) {
  const tmp = path.join(path.dirname(file), '.init-' + crypto.randomUUID());
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.linkSync(tmp, file);
    syncDirectory(path.dirname(file));
  } finally { fs.unlinkSync(tmp); }
}

/** An operator arms an empty installation or explicitly adopts an existing v1 store.
 * Immutable state markers are published with fail-if-exists links. Only the local account
 * write is permitted between reservation and closure. A reserved grant never opens again.
 */
export class AdminBootstrap {
  private constructor(
    private readonly installationId: string,
    private readonly control: string | undefined,
    private readonly volume: string,
    private readonly authFile: string,
    private readonly receipt?: string,
  ) {}

  static fromEnvironment(env: NodeJS.ProcessEnv, authFile: string) {
    const id = env.BOLT_ADMIN_INSTALLATION_ID;
    const directory = env.BOLT_ADMIN_CONTROL_DIR;
    const mount = env.BOLT_PILOT_VOLUME || env.BOLT_ADMIN_VOLUME_DIR;
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) || !mount || !path.isAbsolute(mount) ||
        !path.isAbsolute(authFile)) return recovery();
    if (!entry(mount)?.isDirectory() || entry(authFile)?.isSymbolicLink()) return recovery();
    const volume = fs.realpathSync(mount), auth = location(authFile);
    if (auth === volume || !isWithin(auth, volume)) return recovery();
    if (env.BOLT_ADMIN_CLOSED_RECEIPT !== undefined) {
      const receipt = env.BOLT_ADMIN_CLOSED_RECEIPT.trim();
      if (!/^[0-9a-f]{64}$/.test(receipt)) return recovery();
      return new AdminBootstrap(id, undefined, volume, auth, receipt);
    }
    if (!directory || !path.isAbsolute(directory)) return recovery();
    const stat = entry(directory);
    if (!stat?.isDirectory() || (stat.mode & 0o077) !== 0) return recovery();
    const control = fs.realpathSync(directory);
    if (containsDirectory(control, volume) || containsDirectory(volume, control)) return recovery();
    return new AdminBootstrap(id, control, volume, auth);
  }

  private get directory(): string {
    return this.control ?? recovery();
  }

  private readGrant(): Grant {
    const grant = privateJson(path.join(this.directory, GRANT));
    if (grant?.version !== 1 || grant.installationId !== this.installationId ||
        grant.authPath !== path.relative(this.volume, this.authFile) ||
        !/^[0-9a-f-]{36}$/.test(grant.volumeId) || !/^[0-9a-f]{64}$/.test(grant.accountDigest) ||
        !Number.isSafeInteger(grant.expiresAt) || !['prepare','adopt'].includes(grant.mode) ||
        (grant.mode === 'adopt' && !/^[0-9a-f]{64}$/.test(grant.legacyDigest))) return recovery();
    return grant;
  }

  private hasStage(stage: Stage, grant: Grant) {
    const file = path.join(this.directory, stage + '.json');
    if (!entry(file)) return false;
    const record = privateJson(file);
    if (record?.version !== 1 || record.stage !== stage || !Number.isSafeInteger(record.recordedAt) ||
        record.grantDigest !== grantDigest(grant)) recovery();
    return true;
  }

  private stage(stage: Stage, grant: Grant, allowExisting: boolean) {
    const file = path.join(this.directory, stage + '.json');
    if (allowExisting && this.hasStage(stage, grant)) return;
    try { createOnce(file, {version:1, stage, recordedAt:Date.now(), grantDigest:grantDigest(grant)}); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !allowExisting || !this.hasStage(stage, grant)) return recovery();
    }
    syncDirectory(this.directory);
  }

  private state() {
    const grant = this.readGrant();
    const marker = privateJson(path.join(this.volume, ADMIN_VOLUME_MARKER));
    if (marker?.version !== 1 || !sameBinding(marker, grant) || !this.hasStage('armed', grant)) return recovery();
    const reserved = this.hasStage('reserved', grant), closed = this.hasStage('closed', grant);
    if (closed && !reserved) return recovery();
    return {grant, reserved, closed};
  }

  /** Maintenance operation, never called by a web request or by ordinary application startup. */
  prepare(mode: Mode, email: string): void {
    if (!this.control || !['prepare','adopt'].includes(mode) || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) return recovery();
    const existing = entry(this.authFile);
    if (mode === 'prepare' ? !!existing : !existing?.isFile()) return recovery();
    let legacyDigest: string | undefined;
    if (mode === 'adopt') {
      const raw = fs.readFileSync(this.authFile, 'utf8');
      let data;
      try { data = JSON.parse(raw); } catch { return recovery(); }
      if (data?.version !== '1.0.0' || !Array.isArray(data.admins) ||
          !data.admins.some((a: any) => a?.role === 'ADMINISTRADOR' &&
            typeof a.email === 'string' && a.email.trim().toLowerCase() === email.trim().toLowerCase())) return recovery();
      legacyDigest = digest(raw);
    }
    const grantFile = path.join(this.directory, GRANT), markerFile = path.join(this.volume, ADMIN_VOLUME_MARKER);
    if (!entry(grantFile)) {
      // Remnants at either end require recovery even when the operator repeats preparation.
      if (entry(markerFile) || ['armed','reserved','closed'].some(s => entry(path.join(this.directory, s + '.json')))) return recovery();
      const volumeId = crypto.randomUUID();
      createOnce(grantFile, {
        version: 1, mode, installationId: this.installationId, volumeId, accountDigest: accountDigest(volumeId, email),
        authPath: path.relative(this.volume, this.authFile), expiresAt: Date.now() + HOUR, legacyDigest,
      } satisfies Grant);
    }
    const grant = this.readGrant();
    if (grant.mode !== mode || !this.matchesAccount(grant, email) || legacyDigest !== grant.legacyDigest ||
        grant.expiresAt <= Date.now() || this.hasStage('reserved', grant) || this.hasStage('closed', grant)) return recovery();
    if (!entry(markerFile)) {
      if (this.hasStage('armed', grant)) return recovery();
      createOnce(markerFile, {version: 1, ...bindingOf(grant)});
    }
    const marker = privateJson(markerFile);
    if (marker?.version !== 1 || !sameBinding(marker, grant)) return recovery();
    this.stage('armed', grant, true);
  }

  matchesAccount(binding: AdminBinding, email: string) {
    return typeof email === 'string' && binding.accountDigest === accountDigest(binding.volumeId, email);
  }

  inspect(binding?: AdminBinding, legacyRaw?: string): 'open' | 'closed' | 'adopt' {
    if (this.receipt) {
      if (!binding || legacyRaw !== undefined || binding.installationId !== this.installationId) return recovery();
      const marker = privateJson(path.join(this.volume, ADMIN_VOLUME_MARKER));
      if (marker?.version !== 1 || !sameBinding(marker, binding) ||
          this.calculateReceipt(binding, this.storedOwnerId(binding)) !== this.receipt) return recovery();
      return 'closed';
    }
    const {grant, reserved, closed} = this.state();
    if (binding !== undefined) {
      if (!reserved || !sameBinding(binding, grant)) return recovery();
      return 'closed';
    }
    if (legacyRaw !== undefined) {
      if (closed || grant.mode !== 'adopt' || digest(legacyRaw) !== grant.legacyDigest ||
          (!reserved && Date.now() >= grant.expiresAt)) return recovery();
      return 'adopt';
    }
    if (entry(this.authFile) || reserved || closed || grant.mode !== 'prepare' || Date.now() >= grant.expiresAt) return recovery();
    return 'open';
  }

  reserve(email: string): AdminBinding {
    this.inspect();
    const grant = this.readGrant();
    if (!this.matchesAccount(grant, email)) return recovery();
    this.stage('reserved', grant, false);
    return bindingOf(grant);
  }

  adopt(legacyRaw: string): AdminBinding {
    this.inspect(undefined, legacyRaw);
    const grant = this.readGrant();
    this.stage('reserved', grant, true);
    return bindingOf(grant);
  }

  private storedOwnerId(binding: AdminBinding): string {
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.authFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      if (!fs.fstatSync(fd).isFile()) return recovery();
      const local = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (local?.version !== '2.0.0' || !sameBinding(local.bootstrap, binding) || !Array.isArray(local.admins)) return recovery();
      const owners = local.admins.filter((a: any) => a?.role === 'ADMINISTRADOR' && this.matchesAccount(binding, a.email));
      if (owners.length !== 1 || typeof owners[0].id !== 'string' || !owners[0].id.trim()) return recovery();
      return owners[0].id;
    } catch { return recovery(); } finally { if (fd !== undefined) fs.closeSync(fd); }
  }

  private calculateReceipt(binding: AdminBinding, ownerId: string) {
    const relativePath = path.relative(this.volume, this.authFile).split(path.sep).join('/');
    return digest(JSON.stringify(['bolt:admin:closed:v2', binding.installationId, binding.volumeId,
      binding.accountDigest, relativePath, ownerId]));
  }

  /** This fingerprint can be pinned outside the volume and authorizes only the closed state. */
  closedReceipt(binding: AdminBinding, email: string): string {
    if (!this.control) return recovery();
    const {grant, closed} = this.state();
    if (!closed || !sameBinding(binding, grant) || !this.matchesAccount(grant, email)) return recovery();
    return this.calculateReceipt(binding, this.storedOwnerId(binding));
  }

  complete(binding: AdminBinding, email: string): void {
    this.inspect(binding);
    if (!this.matchesAccount(binding, email)) return recovery();
    if (this.receipt) return;
    // A crash after reserve must not close the grant until the bound account really exists.
    this.storedOwnerId(binding);
    const grant = this.readGrant();
    this.stage('closed', grant, true);
  }
}

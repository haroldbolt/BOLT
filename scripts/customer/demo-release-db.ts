import { createHash } from 'node:crypto';
import { constants, createReadStream, lstatSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { connectCustomerDatabase } from '../../src/customer/database';
import { demoDBTransition, railwayDemoDatabaseTarget, type Action } from './demo-db-transition';
import { backupDemoDatabase } from '../../deployment/demo-db-backup.mjs';

async function run() {
  const action = process.argv[2] as Action;
  if (process.argv.length !== 3 || !['upgrade','rollback','status'].includes(action)) throw Error('DEMO_DB_ACTION_REQUIRED');
  const connectionString = railwayDemoDatabaseTarget(process.env);
  const directory = process.env.BOLT_DEMO_DB_BACKUP_DIR || '';
  const db = connectCustomerDatabase(connectionString);
  try {
    const result = await demoDBTransition(db, action, {
      databaseName: 'bolt_customers_demo',
      backup: async () => {
        if (!path.isAbsolute(directory)) throw Error('DEMO_DB_BACKUP_DIRECTORY_REQUIRED');
        const {file, sha256} = await backupDemoDatabase({connectionString, directory});
        if (path.dirname(file) !== directory) throw Error('DEMO_DB_BACKUP_WRONG_DIRECTORY');
        return {file: path.basename(file), sha256};
      },
      verifyBackup: async ({file, sha256}) => {
        if (!path.isAbsolute(directory) || !file || file === '.' || file === '..' || file !== path.basename(file)) throw Error('DEMO_DB_BACKUP_WRONG_DIRECTORY');
        const target = path.join(directory,file);
        if (!lstatSync(target).isFile()) throw Error('DEMO_DB_INVALID_BACKUP');
        const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const sum = createHash('sha256');
          for await (const chunk of createReadStream(target, {fd, autoClose: false})) sum.update(chunk);
          if (sum.digest('hex') !== sha256) throw Error('DEMO_DB_BACKUP_CHECKSUM_MISMATCH');
        } finally {closeSync(fd);}
      },
    });
    console.log('[Demo customer database]', JSON.stringify(result));
  } finally { await db.destroy(); }
}
run().catch(error => {
  const code = error instanceof Error && /^DEMO_DB_[A-Z_]{1,64}$/.test(error.message) ? error.message : 'DEMO_DB_OPERATION_FAILED';
  console.error('[Demo customer database]', code);
  process.exitCode = 1;
});

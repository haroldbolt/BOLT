import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [
  'localStartup.test.mjs',
  'addressSelectionSession.test.ts', 'addressGeocoding.test.ts',
  'customerDeliveryAddress.test.ts', 'customerCartActions.test.ts', 'customerAddressJourney.test.ts',
  'testInventorySeed.test.ts',
  'authorizedInventoryImport.test.ts',
  'addressPickerEmptyState.test.ts', 'addressCustomerSurfaces.test.ts',
  'checkoutPolicyIntegration.test.ts', 'checkoutPolicyView.test.ts',
  'bogotaLocalities.test.ts', 'scheduledDispatch.test.ts', 'scheduledDispatchIntegration.test.ts', 'deliverySelection.test.ts',
  'deliveryQuote.test.ts', 'foldableResponsive.test.ts', 'orderStateMachine.test.ts',
  'orderReservations.test.ts', 'gpsTelemetry.test.ts', 'gpsTransmission.test.ts', 'apiIntegration.test.ts',
  'catalogVariants.test.ts', 'adminRepository.test.ts', 'adminProductFields.test.ts', 'adminIntegration.test.ts',
  'adminAdversarial.test.ts', 'splitPlanBounds.test.ts',
];
const isBun = !!process.versions.bun;
for (const file of files) {
  const dir = mkdtempSync(join(tmpdir(), 'bolt-pets-test-'));
  try {
    const args = isBun ? ['src/tests/' + file] : ['--import', 'tsx', 'src/tests/' + file];
    const result = spawnSync(process.execPath, args, {
      stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', BOLT_DATA_DIR: dir },
    });
    if (result.status !== 0) process.exitCode = 1;
    if (result.error) console.error(result.error.message);
  } finally {
    // Solo se elimina el directorio temporal creado por esta ejecución.
    const checked = resolve(dir);
    if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.split(sep).at(-1).startsWith('bolt-pets-test-')) {
      throw new Error('Ruta temporal de pruebas inválida');
    }
    rmSync(checked, { recursive: true, force: true });
  }
}

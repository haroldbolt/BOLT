import { RappiCargoSandboxProvider, type RappiCargoSandboxConfig } from './rappiCargoProvider';
import type { ProviderShipmentContext } from './dispatchProviders';

type Settings = Omit<RappiCargoSandboxConfig, 'fetch' | 'now' | 'token'> & {
  externalBudgetCOP: number;
  testDestination: ProviderShipmentContext['destination'];
};

export function configureRappiCargoSandbox(env: NodeJS.ProcessEnv, isolatedSimulation: boolean) {
  if (env.BOLT_RAPPI_CARGO_SANDBOX !== '1') return undefined;
  if (!isolatedSimulation) throw Error('Rappi Cargo sandbox requiere una simulación aislada de BOLT.');

  let settings: Settings;
  let provider: RappiCargoSandboxProvider;
  try {
    settings = JSON.parse(env.BOLT_RAPPI_CARGO_SANDBOX_SETTINGS ?? '');
    const { testDestination } = settings;
    if (!Number.isSafeInteger(settings.externalBudgetCOP) || settings.externalBudgetCOP <= 0 ||
        !testDestination?.address?.trim() || !testDestination.city?.trim() ||
        !Number.isFinite(testDestination.coordinates?.lat) || Math.abs(testDestination.coordinates.lat) > 90 ||
        !Number.isFinite(testDestination.coordinates?.lng) || Math.abs(testDestination.coordinates.lng) > 180 ||
        !['BIKE', 'CAR'].includes(settings.vehicleType))
      throw Error('Configuración inválida.');
    const { pickingPoints, vehicle, vehicleType, testClient } = settings;
    provider = new RappiCargoSandboxProvider({
      pickingPoints, vehicle, vehicleType, testClient, token: env.BOLT_RAPPI_CARGO_SANDBOX_TOKEN ?? '',
    });
  } catch {
    throw Error('Revisa las credenciales, sede, contacto de prueba, vehículo y presupuesto de Rappi Cargo sandbox.');
  }
  return { provider, externalBudgetCOP: settings.externalBudgetCOP, testDestination: settings.testDestination };
}

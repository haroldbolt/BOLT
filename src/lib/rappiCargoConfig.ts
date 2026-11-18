import { RappiCargoProvider, type RappiCargoSite } from './rappiCargoProvider';

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function parseSite(storeId: string, raw: unknown): RappiCargoSite {
  if (!isJson(raw)) throw Error('Sede sin configuración.');
  const { pickingPointId, vehicleType, maxLoadGrams, cargoDimensionsCm, maxVolumeCm3, packagingGrams } = raw;
  const pointValid = typeof pickingPointId === 'string'
    ? pickingPointId.trim().length > 0 && pickingPointId.trim() === pickingPointId
    : positiveInteger(pickingPointId);
  if (!pointValid || (vehicleType !== 'BIKE' && vehicleType !== 'CAR') ||
      !positiveInteger(maxLoadGrams) || !positiveInteger(maxVolumeCm3) ||
      typeof packagingGrams !== 'number' || !Number.isSafeInteger(packagingGrams) || packagingGrams < 0 || packagingGrams >= maxLoadGrams ||
      !Array.isArray(cargoDimensionsCm) || cargoDimensionsCm.length !== 3 ||
      cargoDimensionsCm.some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0) ||
      maxVolumeCm3 > cargoDimensionsCm.reduce((volume, dimension) => volume * dimension, 1)) {
    throw Error('Sede, vehículo o capacidad sin verificar.');
  }
  const [length, width, height] = cargoDimensionsCm;
  return {
    pickingPointId: pickingPointId as number | string,
    vehicleType,
    vehicle: {
      enabled: true,
      driverId: 'rappi-cargo-' + storeId,
      storeIds: [storeId],
      modes: ['TURBO'],
      maxLoadGrams,
      maxVolumeCm3,
      packagingGrams,
      cargoDimensionsCm: [length, width, height],
      scheduledSlots: [],
    },
  };
}

export function configureRappiCargo(env: NodeJS.ProcessEnv, operationalStoreIds: readonly string[]) {
  if (env.BOLT_RAPPI_CARGO_ENABLED !== '1') return undefined;

  try {
    const settings: unknown = JSON.parse(env.BOLT_RAPPI_CARGO_SETTINGS ?? '');
    const token = env.BOLT_RAPPI_CARGO_USER_TOKEN;
    if (!isJson(settings) || !token || /\s/.test(token) ||
        settings.cashCollectionApproved !== true ||
        typeof settings.cashApprovalReference !== 'string' || !settings.cashApprovalReference.trim() ||
        !positiveInteger(settings.maxCashCOP) || !positiveInteger(settings.externalBudgetCOP) ||
        !isJson(settings.sites) || !operationalStoreIds.length ||
        Object.keys(settings.sites).length !== operationalStoreIds.length) {
      throw Error('Falta confirmación comercial, credencial o configuración de las sedes del piloto.');
    }
    const rawSites = settings.sites;
    const sites = Object.fromEntries(operationalStoreIds.map(storeId => [storeId, parseSite(storeId, rawSites[storeId])]));
    const points = Object.values(sites).map(site => String(site.pickingPointId));
    if (new Set(points).size !== points.length) throw Error('El punto de recogida debe corresponder a cada sede.');
    return {
      provider: new RappiCargoProvider({ token, sites, maxCashCOP: settings.maxCashCOP }),
      maxCashCOP: settings.maxCashCOP,
      externalBudgetCOP: settings.externalBudgetCOP,
    };
  } catch {
    // Do not surface parsed settings or provider credentials in startup logs.
    throw Error('Revisa la aprobación de efectivo de Rappi Cargo, sus credenciales de producción y los puntos y capacidades de todas las sedes.');
  }
}

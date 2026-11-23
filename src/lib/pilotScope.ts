const supportedStoreIds = new Set(['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA']);

export function pilotScope(env: NodeJS.ProcessEnv) {
  const { BOLT_PILOT_STORE_ID: single, BOLT_PILOT_STORE_IDS: multiple } = env;
  if (single === undefined && multiple === undefined) return undefined;
  if (single !== undefined && multiple !== undefined) {
    throw Error('Configura una sola variable para las sedes del piloto de BOLT.');
  }
  if (single !== undefined) {
    if (single !== 'HUB_SUBA') throw Error('BOLT_PILOT_STORE_ID admite únicamente HUB_SUBA.');
    return {
      storeIds: ['HUB_SUBA'],
      directory: 'bolt-piloto-suba',
      marker: { version: 1, kind: 'BOLT_PILOT', storeId: 'HUB_SUBA' },
    };
  }

  const storeIds = multiple!.split(',').map(id => id.trim()).sort();
  if (storeIds.length !== supportedStoreIds.size || new Set(storeIds).size !== supportedStoreIds.size ||
      storeIds.some(id => !supportedStoreIds.has(id))) {
    throw Error('BOLT_PILOT_STORE_IDS debe contener HUB_ALAMOS, HUB_KENNEDY y HUB_SUBA.');
  }
  return { storeIds, directory: 'bolt-operacion', marker: { version: 2, kind: 'BOLT_PILOT', storeIds } };
}

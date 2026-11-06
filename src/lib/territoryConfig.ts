/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * BOLT PETS — CONFIGURACIÓN Y ASIGNACIÓN TERRITORIAL AUTORITATIVA
 * 
 * Reglas de distribución territorial para pedidos PROGRAMADOS:
 * 
 * 1. BODEGA KENNEDY (HUB_KENNEDY):
 *    - 12 Localidades de Bogotá:
 *      1. Kennedy
 *      2. Bosa
 *      3. Ciudad Bolívar
 *      4. Tunjuelito
 *      5. Usme
 *      6. Rafael Uribe Uribe
 *      7. San Cristóbal
 *      8. Antonio Nariño
 *      9. Puente Aranda
 *      10. Los Mártires
 *      11. Santa Fe (y variante Santafé)
 *      12. La Candelaria
 *    - Municipio adicional asignado a Kennedy:
 *      - Soacha (zona urbana y cobertura habilitada)
 *      * IMPORTANTE: Soacha es un municipio independiente, NO es localidad de Bogotá.
 * 
 * 2. BODEGA ÁLAMOS (HUB_ALAMOS):
 *    - 5 Localidades de Bogotá:
 *      1. Engativá
 *      2. Fontibón
 *      3. Teusaquillo
 *      4. Barrios Unidos
 *      5. Chapinero
 * 
 * 3. BODEGA SUBA (HUB_SUBA):
 *    - 2 Localidades de Bogotá:
 *      1. Suba
 *      2. Usaquén
 * 
 * 4. EXCLUSIÓN DE COBERTURA:
 *    - Sumapaz: queda fuera de la cobertura estándar inicial.
 *    - Otros municipios de Cundinamarca (Chía, Cota, Cajicá, Mosquera, Funza, etc.):
 *      quedan fuera de cobertura estándar.
 */

export const TERRITORIAL_WAREHOUSES = {
  KENNEDY: {
    id: 'HUB_KENNEDY',
    name: 'Bolt Pets Kennedy',
    address: 'Carrera 79A #2-05, Bogotá, Colombia',
  },
  ALAMOS: {
    id: 'HUB_ALAMOS',
    name: 'Bolt Pets Álamos',
    address: 'Calle 72 #97A-18, Bogotá, Colombia',
  },
  SUBA: {
    id: 'HUB_SUBA',
    name: 'Bolt Pets Suba',
    address: 'Carrera 107 #143-31, Bogotá, Colombia',
  },
} as const;

export type TerritorialWarehouseId = 'HUB_KENNEDY' | 'HUB_ALAMOS' | 'HUB_SUBA';

// 12 Localidades oficiales de Bogotá asignadas a Kennedy
export const KENNEDY_LOCALITIES = [
  'Kennedy',
  'Bosa',
  'Ciudad Bolívar',
  'Tunjuelito',
  'Usme',
  'Rafael Uribe Uribe',
  'San Cristóbal',
  'Antonio Nariño',
  'Puente Aranda',
  'Los Mártires',
  'Santa Fe',
  'La Candelaria',
] as const;

// 5 Localidades oficiales de Bogotá asignadas a Álamos
export const ALAMOS_LOCALITIES = [
  'Engativá',
  'Fontibón',
  'Teusaquillo',
  'Barrios Unidos',
  'Chapinero',
] as const;

// 2 Localidades oficiales de Bogotá asignadas a Suba
export const SUBA_LOCALITIES = [
  'Suba',
  'Usaquén',
] as const;

// Localidades de Bogotá no cubiertas
export const EXCLUDED_BOGOTA_LOCALITIES = [
  'Sumapaz',
] as const;

// Municipios habilitados
export const SUPPORTED_MUNICIPALITIES = [
  'Bogotá D.C.',
  'Soacha',
] as const;

export type BogotaCoveredLocality =
  | typeof KENNEDY_LOCALITIES[number]
  | typeof ALAMOS_LOCALITIES[number]
  | typeof SUBA_LOCALITIES[number];

export type AllBogotaLocality = BogotaCoveredLocality | 'Sumapaz';

export interface TerritorialAssignmentResult {
  status: 'ASSIGNED' | 'OUT_OF_COVERAGE' | 'NEEDS_CONFIRMATION';
  assignedStoreId: TerritorialWarehouseId | null;
  assignedStoreName: string | null;
  municipality: string;
  locality?: string;
  isCovered: boolean;
  reason?: string;
}

/**
 * Normaliza cadenas de texto para comparación tolerante a acentos y mayúsculas
 */
export function normalizeTerritoryString(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,\-_#/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canónica de nombres de localidad en Bogotá
 */
export function canonicalizeBogotaLocality(raw?: string | null): AllBogotaLocality | null {
  if (!raw) return null;
  const clean = normalizeTerritoryString(raw);

  // Kennedy y afines
  if (clean === 'kennedy' || clean === 'localidad kennedy' || clean.startsWith('kennedy ')) return 'Kennedy';
  if (clean === 'bosa' || clean === 'localidad bosa') return 'Bosa';
  if (clean === 'ciudad bolivar' || clean === 'localidad ciudad bolivar') return 'Ciudad Bolívar';
  if (clean === 'tunjuelito' || clean === 'localidad tunjuelito') return 'Tunjuelito';
  if (clean === 'usme' || clean === 'localidad usme') return 'Usme';
  if (clean === 'rafael uribe uribe' || clean === 'rafael uribe' || clean === 'localidad rafael uribe uribe') return 'Rafael Uribe Uribe';
  if (clean === 'san cristobal' || clean === 'localidad san cristobal') return 'San Cristóbal';
  if (clean === 'antonio narino' || clean === 'localidad antonio narino') return 'Antonio Nariño';
  if (clean === 'puente aranda' || clean === 'localidad puente aranda') return 'Puente Aranda';
  if (clean === 'los martires' || clean === 'martires' || clean === 'localidad los martires') return 'Los Mártires';
  if (clean === 'santa fe' || clean === 'santafe' || clean === 'santa fe bogota' || clean === 'localidad santa fe') return 'Santa Fe';
  if (clean === 'la candelaria' || clean === 'candelaria' || clean === 'localidad la candelaria') return 'La Candelaria';

  // Álamos y afines
  if (clean === 'engativa' || clean === 'localidad engativa') return 'Engativá';
  if (clean === 'fontibon' || clean === 'localidad fontibon') return 'Fontibón';
  if (clean === 'teusaquillo' || clean === 'localidad teusaquillo') return 'Teusaquillo';
  if (clean === 'barrios unidos' || clean === 'localidad barrios unidos') return 'Barrios Unidos';
  if (clean === 'chapinero' || clean === 'localidad chapinero') return 'Chapinero';

  // Suba y afines
  if (clean === 'suba' || clean === 'localidad suba') return 'Suba';
  if (clean === 'usaquen' || clean === 'localidad usaquen') return 'Usaquén';

  // Fuera de cobertura estándar
  if (clean === 'sumapaz' || clean === 'localidad sumapaz') return 'Sumapaz';

  return null;
}

/**
 * Detecta si la referencia corresponde a Soacha
 */
export function isSoachaMunicipality(text?: string | null): boolean {
  if (!text) return false;
  const clean = normalizeTerritoryString(text);
  return (
    clean === 'soacha' ||
    clean.includes('municipio de soacha') ||
    clean.includes('soacha cundinamarca') ||
    clean.includes('soacha centro') ||
    clean.includes('ciudad verde') ||
    clean.includes('san mateo') ||
    clean.includes('compartir') ||
    clean.includes('cazuca') ||
    clean.includes('la despensa') ||
    clean.startsWith('soacha') ||
    clean.endsWith('soacha')
  );
}

/**
 * Extrae de forma segura municipio y localidad a partir de componentes estructurados
 * o dirección completa SIN confundir nombres de calles aislados.
 */
export function extractTerritoryFromInput(input: {
  municipality?: string | null;
  locality?: string | null;
  address?: string | null;
  coordinates?: { lat: number; lng: number } | null;
}): {
  municipality: string;
  locality?: string;
  isConfirmed: boolean;
  rawMatched?: string;
} {
  const explicitMun = input.municipality?.trim();
  const explicitLoc = input.locality?.trim();
  const addressText = input.address || '';

  // 1. Caso Soacha explícito
  if (explicitMun && isSoachaMunicipality(explicitMun)) {
    return {
      municipality: 'Soacha',
      locality: explicitLoc || undefined,
      isConfirmed: true,
      rawMatched: 'Soacha',
    };
  }

  // 2. Si la dirección menciona explícitamente el municipio Soacha
  if (isSoachaMunicipality(addressText)) {
    return {
      municipality: 'Soacha',
      locality: undefined,
      isConfirmed: true,
      rawMatched: 'Soacha',
    };
  }

  // 3. Localidad explícita proporcionada en Bogotá
  if (explicitLoc) {
    const canonical = canonicalizeBogotaLocality(explicitLoc);
    if (canonical) {
      return {
        municipality: explicitMun || 'Bogotá D.C.',
        locality: canonical,
        isConfirmed: true,
        rawMatched: canonical,
      };
    }
  }

  // 4. Extracción desde la dirección escrita separada por comas (ej: "Calle 72 #97-18, Engativá, Bogotá")
  // Regla estricta: NO buscar palabras sueltas dentro de la calle (ej: "Calle Chapinero").
  // Se requiere que la localidad aparezca delimitada por comas, paréntesis o prefijo de localidad.
  const segments = addressText.split(/[,;\(\)]/).map(s => s.trim());
  for (const seg of segments) {
    const canonical = canonicalizeBogotaLocality(seg);
    if (canonical) {
      return {
        municipality: explicitMun || 'Bogotá D.C.',
        locality: canonical,
        isConfirmed: true,
        rawMatched: canonical,
      };
    }
  }

  // Comprobar prefijos formales como "Localidad Chapinero", "Barrio Cedritos, Usaquén"
  const normAddress = normalizeTerritoryString(addressText);
  for (const loc of [
    ...KENNEDY_LOCALITIES,
    ...ALAMOS_LOCALITIES,
    ...SUBA_LOCALITIES,
    ...EXCLUDED_BOGOTA_LOCALITIES,
  ]) {
    const normLoc = normalizeTerritoryString(loc);
    // Buscar límites de palabra o patrones formales como "localidad de ..." o "... bogota"
    const regex = new RegExp(`(?:localidad(?:\\s+de)?\\s+${normLoc}|\\b${normLoc}\\s+bogota|\\bbogota\\s+${normLoc})`, 'i');
    if (regex.test(normAddress)) {
      return {
        municipality: explicitMun || 'Bogotá D.C.',
        locality: loc,
        isConfirmed: true,
        rawMatched: loc,
      };
    }
  }

  // 5. Coordenadas geográficas como sugerencia secundaria cuando la dirección no lo indica
  // Nota: Las coordenadas solo ayudan a sugerir, no sobreescriben la dirección escrita.
  if (input.coordinates && typeof input.coordinates.lat === 'number' && typeof input.coordinates.lng === 'number') {
    const { lat, lng } = input.coordinates;
    // Soacha urbano aproximado
    if (lat >= 4.540 && lat <= 4.605 && lng >= -74.240 && lng <= -74.195) {
      return {
        municipality: 'Soacha',
        isConfirmed: false, // Requiere confirmación si solo vino por coordenadas
      };
    }
  }

  return {
    municipality: explicitMun || 'Bogotá D.C.',
    locality: undefined,
    isConfirmed: false,
  };
}

/**
 * Resuelve autoritativamente la asignación territorial para pedidos PROGRAMADOS:
 * - Kennedy: 12 localidades de Bogotá + Soacha
 * - Álamos: 5 localidades de Bogotá
 * - Suba: 2 localidades de Bogotá
 * - Sumapaz: Fuera de cobertura estándar
 * - Municipios no cubiertos (Chía, etc.): Fuera de cobertura
 */
export function resolveTerritorialAssignment(input: {
  municipality?: string | null;
  locality?: string | null;
  address?: string | null;
  coordinates?: { lat: number; lng: number } | null;
}): TerritorialAssignmentResult {
  const extracted = extractTerritoryFromInput(input);

  // 1. Validación de Soacha
  if (extracted.municipality === 'Soacha' || isSoachaMunicipality(input.address) || isSoachaMunicipality(input.municipality)) {
    return {
      status: 'ASSIGNED',
      assignedStoreId: TERRITORIAL_WAREHOUSES.KENNEDY.id,
      assignedStoreName: TERRITORIAL_WAREHOUSES.KENNEDY.name,
      municipality: 'Soacha',
      locality: undefined,
      isCovered: true,
      reason: 'Pedido programado en Soacha asignado autoritativamente a Bodega Kennedy.',
    };
  }

  // 2. Validación de otros municipios fuera de Bogotá / Soacha
  const normMun = normalizeTerritoryString(extracted.municipality);
  const isBogota = normMun.includes('bogota') || normMun === '' || normMun === 'bogota d c';
  if (!isBogota && !isSoachaMunicipality(extracted.municipality)) {
    // Municipios como Chía, Cota, Mosquera, etc.
    return {
      status: 'OUT_OF_COVERAGE',
      assignedStoreId: null,
      assignedStoreName: null,
      municipality: extracted.municipality || 'Municipio no cubierto',
      isCovered: false,
      reason: `El municipio "${extracted.municipality}" se encuentra fuera del área de cobertura estándar habilitada. Actualmente atendemos Bogotá D.C. y Soacha.`,
    };
  }

  // 3. Validación de localidad en Bogotá
  const canonicalLoc = canonicalizeBogotaLocality(extracted.locality);

  if (!canonicalLoc) {
    return {
      status: 'NEEDS_CONFIRMATION',
      assignedStoreId: null,
      assignedStoreName: null,
      municipality: 'Bogotá D.C.',
      isCovered: false,
      reason: 'No fue posible identificar la localidad de Bogotá con certeza. Por favor selecciona tu localidad antes de confirmar el pedido.',
    };
  }

  // 4. Caso Sumapaz (exclusión explícita)
  if (canonicalLoc === 'Sumapaz') {
    return {
      status: 'OUT_OF_COVERAGE',
      assignedStoreId: null,
      assignedStoreName: null,
      municipality: 'Bogotá D.C.',
      locality: 'Sumapaz',
      isCovered: false,
      reason: 'Sumapaz queda fuera de la cobertura estándar inicial para entregas programadas.',
    };
  }

  // 5. Asignación a Bodega Kennedy (12 localidades)
  if ((KENNEDY_LOCALITIES as readonly string[]).includes(canonicalLoc)) {
    return {
      status: 'ASSIGNED',
      assignedStoreId: TERRITORIAL_WAREHOUSES.KENNEDY.id,
      assignedStoreName: TERRITORIAL_WAREHOUSES.KENNEDY.name,
      municipality: 'Bogotá D.C.',
      locality: canonicalLoc,
      isCovered: true,
      reason: `Localidad ${canonicalLoc} asignada autoritativamente a Bodega Kennedy.`,
    };
  }

  // 6. Asignación a Bodega Álamos (5 localidades)
  if ((ALAMOS_LOCALITIES as readonly string[]).includes(canonicalLoc)) {
    return {
      status: 'ASSIGNED',
      assignedStoreId: TERRITORIAL_WAREHOUSES.ALAMOS.id,
      assignedStoreName: TERRITORIAL_WAREHOUSES.ALAMOS.name,
      municipality: 'Bogotá D.C.',
      locality: canonicalLoc,
      isCovered: true,
      reason: `Localidad ${canonicalLoc} asignada autoritativamente a Bodega Álamos.`,
    };
  }

  // 7. Asignación a Bodega Suba (2 localidades)
  if ((SUBA_LOCALITIES as readonly string[]).includes(canonicalLoc)) {
    return {
      status: 'ASSIGNED',
      assignedStoreId: TERRITORIAL_WAREHOUSES.SUBA.id,
      assignedStoreName: TERRITORIAL_WAREHOUSES.SUBA.name,
      municipality: 'Bogotá D.C.',
      locality: canonicalLoc,
      isCovered: true,
      reason: `Localidad ${canonicalLoc} asignada autoritativamente a Bodega Suba.`,
    };
  }

  return {
    status: 'NEEDS_CONFIRMATION',
    assignedStoreId: null,
    assignedStoreName: null,
    municipality: 'Bogotá D.C.',
    isCovered: false,
    reason: 'Localidad no reconocida. Por favor selecciona tu localidad de entrega.',
  };
}

/**
 * Lista consolidada de todas las localidades y municipios para selectores en UI
 */
export const TERRITORY_OPTIONS = [
  {
    group: 'Bodega Kennedy (12 localidades + Soacha)',
    storeId: 'HUB_KENNEDY',
    storeName: 'Bolt Pets Kennedy',
    items: [
      { municipality: 'Soacha', locality: '', label: 'Soacha (Municipio)' },
      ...KENNEDY_LOCALITIES.map(loc => ({ municipality: 'Bogotá D.C.', locality: loc, label: `${loc} (Bogotá)` })),
    ],
  },
  {
    group: 'Bodega Álamos (5 localidades)',
    storeId: 'HUB_ALAMOS',
    storeName: 'Bolt Pets Álamos',
    items: ALAMOS_LOCALITIES.map(loc => ({ municipality: 'Bogotá D.C.', locality: loc, label: `${loc} (Bogotá)` })),
  },
  {
    group: 'Bodega Suba (2 localidades)',
    storeId: 'HUB_SUBA',
    storeName: 'Bolt Pets Suba',
    items: SUBA_LOCALITIES.map(loc => ({ municipality: 'Bogotá D.C.', locality: loc, label: `${loc} (Bogotá)` })),
  },
];

/**
 * Test unitario para verificar las especificaciones de pantalla del iPhone Duo
 * en Bolt Pets Colombia para Safari 27.1 y navegadores móviles / escritorio.
 */

interface FoldDimensionTest {
  width: number;
  height: number;
  expectedState: {
    isFoldedClosed: boolean;
    isHalfFolded: boolean;
    isExpanded: boolean;
    isDualScreen: boolean;
    orientation: 'portrait' | 'landscape';
    description: string;
  };
}

function evaluateFoldable(w: number, h: number, segments = 1) {
  const isDualScreen = segments === 2 || w >= 800;
  const isExpanded = w >= 669;
  const isFoldedClosed = w <= 420;
  const isHalfFolded = (w > 420 && w < 800);
  const orientation: 'portrait' | 'landscape' = w > h ? 'landscape' : 'portrait';

  return {
    isDualScreen,
    isExpanded,
    isFoldedClosed,
    isHalfFolded,
    orientation,
  };
}

const TEST_CASES: FoldDimensionTest[] = [
  {
    width: 382,
    height: 844,
    expectedState: {
      isFoldedClosed: true,
      isHalfFolded: false,
      isExpanded: false,
      isDualScreen: false,
      orientation: 'portrait',
      description: 'Pantalla externa compacta cerrada (iPhone Duo Cover 382px)',
    },
  },
  {
    width: 385,
    height: 852,
    expectedState: {
      isFoldedClosed: true,
      isHalfFolded: false,
      isExpanded: false,
      isDualScreen: false,
      orientation: 'portrait',
      description: 'Pantalla externa alternativa cerrada (iPhone Duo Cover 385px)',
    },
  },
  {
    width: 594,
    height: 844,
    expectedState: {
      isFoldedClosed: false,
      isHalfFolded: true,
      isExpanded: false,
      isDualScreen: false,
      orientation: 'portrait',
      description: 'Ventana dividida / split screen parcial (594px)',
    },
  },
  {
    width: 669,
    height: 844,
    expectedState: {
      isFoldedClosed: false,
      isHalfFolded: true,
      isExpanded: true,
      isDualScreen: false,
      orientation: 'portrait',
      description: 'Modo semi-plegado / Book Posture desplegado portrait (669px)',
    },
  },
  {
    width: 951,
    height: 844,
    expectedState: {
      isFoldedClosed: false,
      isHalfFolded: false,
      isExpanded: true,
      isDualScreen: true,
      orientation: 'landscape',
      description: 'Pantalla interna desplegada completa de doble segmento (951px)',
    },
  },
];

console.log('--- INICIANDO VERIFICACIÓN RESPONSIVA IPHONE DUO (SAFARI 27.1) ---');
let passed = 0;
let failed = 0;

for (const t of TEST_CASES) {
  const result = evaluateFoldable(t.width, t.height);
  let ok = true;
  for (const [key, val] of Object.entries(t.expectedState)) {
    if (key === 'description') continue;
    if ((result as any)[key] !== val) {
      console.error(`❌ FALLO en ${t.width}px (${t.expectedState.description}): esperado ${key}=${val}, obtenido ${(result as any)[key]}`);
      ok = false;
      failed++;
      break;
    }
  }
  if (ok) {
    console.log(`✅ PASS [${t.width}px]: ${t.expectedState.description} -> clasificado correctamente`);
    passed++;
  }
}

// Probar segmentos horizontales explícitos (Safari 27.1 Viewport Segments API)
const segmentTest = evaluateFoldable(669, 844, 2);
if (segmentTest.isDualScreen) {
  console.log('✅ PASS: Viewport Segments API (horizontal-viewport-segments: 2) activa modo dual-screen');
  passed++;
} else {
  console.error('❌ FALLO: Viewport Segments API no activó modo dual');
  failed++;
}

console.log('========================================');
console.log(`PRUEBAS IPHONE DUO: ${passed} aprobadas, ${failed} fallidas`);
console.log('========================================');

if (failed > 0) process.exit(1);

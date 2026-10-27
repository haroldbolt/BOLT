import { useState, useEffect } from 'react';

export interface FoldableState {
  width: number;
  height: number;
  isDualScreen: boolean;
  isExpanded: boolean;
  isFoldedClosed: boolean;
  isHalfFolded: boolean;
  orientation: 'portrait' | 'landscape';
  posture: 'continuous' | 'folded' | 'none';
  hasSegmentsSupport: boolean;
}

/**
 * Hook para detectar el estado de plegado del dispositivo,
 * compatible con iPhone Duo, Safari 27.1, Viewport Segments API y Device Posture API
 * con fallback progresivo y seguro en navegadores estándar.
 */
export function useFoldable(): FoldableState {
  const [state, setState] = useState<FoldableState>(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 385;
    const h = typeof window !== 'undefined' ? window.innerHeight : 844;
    return {
      width: w,
      height: h,
      isDualScreen: w >= 800,
      isExpanded: w >= 669,
      isFoldedClosed: w <= 420,
      isHalfFolded: w > 420 && w < 800,
      orientation: w > h ? 'landscape' : 'portrait',
      posture: 'none',
      hasSegmentsSupport: false,
    };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkFoldable = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const orientation: 'portrait' | 'landscape' = w > h ? 'landscape' : 'portrait';

      // 1. Verificación de Viewport Segments API (CSS Media Queries)
      const segmentsQuery = window.matchMedia?.('(horizontal-viewport-segments: 2)');
      const spanningQuery = window.matchMedia?.('(screen-spanning: single-fold-vertical)');
      const hasSegments = !!(segmentsQuery?.matches || spanningQuery?.matches);

      // 2. Verificación de Device Posture API (si está habilitada en Safari 27.1)
      const navPosture = (navigator as any)?.devicePosture?.type as ('continuous' | 'folded' | undefined);
      const posture = navPosture || (hasSegments ? 'continuous' : 'none');

      // 3. iPhone Duo viewports:
      // - 382px / 385px: pantalla externa cerrada
      // - 594px: split window / media vista
      // - 669px: medio abierto o book posture
      // - 951px: doble pantalla interna desplegada
      const isDualScreen = hasSegments || w >= 800;
      const isExpanded = w >= 669;
      const isFoldedClosed = w <= 420;
      const isHalfFolded = (w > 420 && w < 800) || posture === 'folded';

      setState({
        width: w,
        height: h,
        isDualScreen,
        isExpanded,
        isFoldedClosed,
        isHalfFolded,
        orientation,
        posture,
        hasSegmentsSupport: hasSegments,
      });
    };

    checkFoldable();

    // Event listeners
    window.addEventListener('resize', checkFoldable, { passive: true });
    window.addEventListener('orientationchange', checkFoldable, { passive: true });

    // Escuchar cambios en segments si está disponible
    const segQuery = window.matchMedia?.('(horizontal-viewport-segments: 2)');
    const spanQuery = window.matchMedia?.('(screen-spanning: single-fold-vertical)');
    segQuery?.addEventListener?.('change', checkFoldable);
    spanQuery?.addEventListener?.('change', checkFoldable);

    // Escuchar Device Posture API si está disponible
    const postureObj = (navigator as any)?.devicePosture;
    postureObj?.addEventListener?.('change', checkFoldable);

    // Visual Viewport para redimensionamientos suaves en Safari iOS
    window.visualViewport?.addEventListener('resize', checkFoldable);

    return () => {
      window.removeEventListener('resize', checkFoldable);
      window.removeEventListener('orientationchange', checkFoldable);
      segQuery?.removeEventListener?.('change', checkFoldable);
      spanQuery?.removeEventListener?.('change', checkFoldable);
      postureObj?.removeEventListener?.('change', checkFoldable);
      window.visualViewport?.removeEventListener('resize', checkFoldable);
    };
  }, []);

  return state;
}

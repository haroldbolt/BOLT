import React, { useState, useEffect, useCallback } from 'react';
import { Search, Zap, X, ChevronRight, ChevronLeft, Sparkles, Compass, Check } from 'lucide-react';

export interface CoachMarkTourProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface TourStep {
  targetId: string;
  badge: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  position: 'top' | 'bottom';
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: 'tour-search-bar',
    badge: 'Paso 1 de 2',
    title: 'Buscador inteligente Bolt Pets',
    description: 'Encuentra al instante alimentos, marcas favoritas, antipulgas y fórmulas de farmacia veterinaria con stock en vivo en Bogotá.',
    icon: <Search className="w-5 h-5 text-red-600" />,
    position: 'bottom', // card appears below search bar
  },
  {
    targetId: 'tour-bottom-nav',
    badge: 'Paso 2 de 2',
    title: 'Navegación rápida y entrega Turbo 25 min',
    description: 'Explora compras inmediatas Turbo, tus favoritos guardados, ofertas relámpago, categorías completas y el carrito desde cualquier pantalla.',
    icon: <Zap className="w-5 h-5 text-yellow-500 fill-yellow-400" />,
    position: 'top', // card appears above bottom nav
  },
];

interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export const CoachMarkTour: React.FC<CoachMarkTourProps> = ({
  isOpen,
  onClose,
  onComplete,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<ElementRect | null>(null);

  const step = TOUR_STEPS[currentStepIndex];

  // Update target element coordinates
  const updateTargetRect = useCallback(() => {
    if (!isOpen || !step) return;

    const el = document.getElementById(step.targetId);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        right: rect.right,
      });

      // Smooth scroll target into view if needed
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } else {
      setTargetRect(null);
    }
  }, [isOpen, step]);

  // Recalculate position on step change, resize or scroll
  useEffect(() => {
    if (!isOpen) return;

    updateTargetRect();
    const handleReposition = () => {
      requestAnimationFrame(updateTargetRect);
    };

    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, { passive: true });

    // Slight delay to ensure DOM is settled
    const timeout = setTimeout(updateTargetRect, 80);

    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition);
      clearTimeout(timeout);
    };
  }, [isOpen, currentStepIndex, updateTargetRect]);

  // Handle keyboard events (Esc to close, Right/Enter for next, Left for back)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (currentStepIndex < TOUR_STEPS.length - 1) {
          setCurrentStepIndex(prev => prev + 1);
        } else {
          onComplete();
        }
      } else if (e.key === 'ArrowLeft' && currentStepIndex > 0) {
        setCurrentStepIndex(prev => prev - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStepIndex, onClose, onComplete]);

  // Reset step index when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isLastStep = currentStepIndex === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStepIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  // Calculate card position relative to viewport
  const getCardStyle = (): React.CSSProperties => {
    if (!targetRect) {
      // Centered fallback if element not yet measured
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const cardWidth = Math.min(380, window.innerWidth - 32);
    // Center horizontally relative to target, clamped to screen
    let left = targetRect.left + targetRect.width / 2 - cardWidth / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - cardWidth - 16));

    if (step.position === 'bottom') {
      // Below target
      const top = Math.min(targetRect.bottom + 14, window.innerHeight - 260);
      return {
        position: 'fixed',
        top: `${Math.max(16, top)}px`,
        left: `${left}px`,
        width: `${cardWidth}px`,
      };
    } else {
      // Above target
      const bottom = Math.max(16, window.innerHeight - targetRect.top + 14);
      return {
        position: 'fixed',
        bottom: `${bottom}px`,
        left: `${left}px`,
        width: `${cardWidth}px`,
      };
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tour guiado de bienvenida Bolt Pets"
      className="fixed inset-0 z-50 overflow-hidden pointer-events-auto"
    >
      {/* 1. Backdrop Spotlight Focus Hole */}
      {targetRect ? (
        <div
          className="fixed transition-all duration-300 ease-out pointer-events-none rounded-2xl sm:rounded-full border-2 border-white/80 ring-4 ring-yellow-400/70"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.72)',
          }}
        >
          {/* Subtle glowing beacon dot on active spotlight */}
          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-yellow-500 border border-white"></span>
          </span>
        </div>
      ) : (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs transition-opacity duration-300" />
      )}

      {/* 2. Floating Coach Mark Card */}
      <div
        style={getCardStyle()}
        className="bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200 z-50 pointer-events-auto"
      >
        {/* Top Header: Badge, Step indicator, Close Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-red-50 text-red-700 text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-red-100 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-red-600" />
              <span>{step.badge}</span>
            </span>
            <div className="flex items-center gap-1 ml-1">
              {TOUR_STEPS.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === currentStepIndex
                      ? 'w-5 bg-red-600'
                      : 'w-1.5 bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition"
            title="Omitir tour"
            aria-label="Cerrar tour guiado"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Card Body: Icon + Title + Description */}
        <div className="flex items-start gap-3 mt-0.5">
          <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
            {step.icon}
          </div>
          <div className="space-y-1">
            <h4 className="font-black text-slate-900 text-sm leading-snug">
              {step.title}
            </h4>
            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              {step.description}
            </p>
          </div>
        </div>

        {/* Footer Actions: Skip / Prev / Next */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 mt-1">
          <button
            onClick={onClose}
            className="text-xs font-bold text-slate-400 hover:text-slate-600 transition px-1 py-1"
          >
            Omitir
          </button>

          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                onClick={handlePrev}
                className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Anterior</span>
              </button>
            )}

            <button
              onClick={handleNext}
              className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 active:scale-95 rounded-xl shadow-md transition flex items-center gap-1.5"
            >
              {isLastStep ? (
                <>
                  <span>¡Empezar a comprar!</span>
                  <Check className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>Siguiente</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

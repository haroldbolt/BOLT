import React from 'react';
import { Sparkles, Truck } from 'lucide-react';
import { formatCOP } from '../../lib/formatters';

interface BenefitProgressBarProps {
  subtotal: number;
  threshold?: number;
}

export const BenefitProgressBar: React.FC<BenefitProgressBarProps> = ({
  subtotal,
  threshold = 70000,
}) => {
  const percentage = Math.min(100, Math.round((subtotal / threshold) * 100));
  const remaining = Math.max(0, threshold - subtotal);
  const isUnlocked = subtotal >= threshold;

  return (
    <div className="bg-white rounded-2xl p-3.5 shadow-xs border border-slate-100">
      <div className="flex items-center justify-between text-xs font-bold mb-2">
        <div className="flex items-center gap-1.5 text-slate-800">
          {isUnlocked ? (
            <Sparkles className="w-4 h-4 text-emerald-600" />
          ) : (
            <Truck className="w-4 h-4 text-red-600" />
          )}
          <span>
            {isUnlocked ? (
              <span className="text-emerald-700 font-extrabold">
                🎉 ¡Felicidades! Tienes Envío Turbo GRATIS
              </span>
            ) : (
              <span>
                Agrega <strong className="text-red-600 font-extrabold">{formatCOP(remaining)}</strong> más para <strong className="text-slate-900">Envío GRATIS</strong>
              </span>
            )}
          </span>
        </div>
        <span className="text-slate-500 font-semibold">{percentage}%</span>
      </div>

      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden p-0.5">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isUnlocked ? 'bg-emerald-500' : 'bg-linear-to-r from-red-500 to-yellow-400'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

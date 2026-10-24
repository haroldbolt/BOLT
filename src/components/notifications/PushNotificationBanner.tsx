import React, { useEffect, useState } from 'react';
import { X, ArrowRight, Zap, CheckCircle2, Bike, Package, AlertCircle, FileText } from 'lucide-react';
import { PushNotification, pushService } from '../../lib/notifications';

interface PushNotificationBannerProps {
  onNavigateToOrder: (orderId: string) => void;
}

export const PushNotificationBanner: React.FC<PushNotificationBannerProps> = ({
  onNavigateToOrder,
}) => {
  const [activeNotification, setActiveNotification] = useState<PushNotification | null>(null);

  useEffect(() => {
    const unsubscribe = pushService.subscribe(notification => {
      setActiveNotification(notification);

      // Auto dismiss after 7 seconds
      const timer = setTimeout(() => {
        setActiveNotification(prev => (prev?.id === notification.id ? null : prev));
      }, 7000);

      return () => clearTimeout(timer);
    });

    return unsubscribe;
  }, []);

  if (!activeNotification) return null;

  const getIcon = () => {
    switch (activeNotification.type) {
      case 'ORDER_ON_THE_WAY':
        return <Zap className="w-5 h-5 text-yellow-400 fill-yellow-400" />;
      case 'ORDER_DELIVERED':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'DRIVER_ASSIGNED':
        return <Bike className="w-5 h-5 text-yellow-400" />;
      case 'ORDER_PREPARING':
        return <Package className="w-5 h-5 text-blue-400" />;
      case 'PRESCRIPTION_APPROVED':
        return <FileText className="w-5 h-5 text-emerald-400" />;
      default:
        return <Zap className="w-5 h-5 text-yellow-400" />;
    }
  };

  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none animate-in slide-in-from-top-4 duration-300">
      <div className="pointer-events-auto max-w-md w-full bg-slate-900/95 backdrop-blur-md text-white rounded-3xl p-4 shadow-2xl border border-slate-700/80 flex flex-col gap-2.5">
        {/* App Title & Time */}
        <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <img
              src="/assets/aistudio/Bolt_Pets_logo_original__1__ce47c0d5.jpg"
              alt="Bolt Pets"
              className="w-4 h-4 rounded-md object-cover"
            />
            <span className="font-bold text-slate-200">Bolt Pets • Notificación en vivo</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium">Ahora</span>
            <button
              onClick={() => setActiveNotification(null)}
              className="w-5 h-5 rounded-full hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition"
              title="Descartar notificación"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
            {getIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black text-white leading-tight">
              {activeNotification.title}
            </h4>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {activeNotification.message}
            </p>
          </div>
        </div>

        {/* Action Button */}
        {activeNotification.actionUrl && (
          <button
            onClick={() => {
              setActiveNotification(null);
              onNavigateToOrder(activeNotification.orderId);
            }}
            className="w-full bg-red-600 hover:bg-red-700 active:scale-98 text-white text-xs font-black py-2.5 px-4 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-red-600/30 transition mt-1"
          >
            <span>Ver seguimiento en mapa en vivo</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

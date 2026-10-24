import React, { useState, useEffect } from 'react';
import { X, Bell, Zap, CheckCircle2, Bike, Package, FileText, ArrowRight, Sparkles, RefreshCw } from 'lucide-react';
import { PushNotification, pushService } from '../../lib/notifications';
import { timeAgoSpanish } from '../../lib/formatters';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToOrder: (orderId: string) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  onNavigateToOrder,
}) => {
  const [notifications, setNotifications] = useState<PushNotification[]>([]);

  useEffect(() => {
    if (isOpen) {
      setNotifications(pushService.getNotifications());
      pushService.markAllAsRead();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const triggerTestNotification = (status: string) => {
    pushService.simulateOrderTransition('#BP-8941', 'ORD-2026-8941', status, 'Carlos Rodríguez', '4892');
    setNotifications(pushService.getNotifications());
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'ORDER_ON_THE_WAY':
        return <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />;
      case 'ORDER_DELIVERED':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      case 'DRIVER_ASSIGNED':
        return <Bike className="w-4 h-4 text-amber-600" />;
      case 'ORDER_PREPARING':
        return <Package className="w-4 h-4 text-blue-600" />;
      case 'PRESCRIPTION_APPROVED':
        return <FileText className="w-4 h-4 text-emerald-600" />;
      default:
        return <Zap className="w-4 h-4 text-red-600" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm">Centro de Notificaciones</h3>
              <p className="text-[11px] text-slate-500">Alertas push de tus pedidos en tiempo real</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Simulator Bar for testing */}
        <div className="p-3 bg-red-50/70 border-b border-red-100 space-y-1.5">
          <span className="text-[11px] font-black text-red-950 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-red-600" />
            Simulador de Estados Push (Probar Alertas):
          </span>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold">
            <button
              onClick={() => triggerTestNotification('EN_ALISTAMIENTO')}
              className="py-1.5 px-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-800 transition"
            >
              1. Alistando
            </button>
            <button
              onClick={() => triggerTestNotification('EN_CAMINO')}
              className="py-1.5 px-2 bg-yellow-400 hover:bg-yellow-500 text-red-950 rounded-lg transition"
            >
              2. En camino ⚡
            </button>
            <button
              onClick={() => triggerTestNotification('ENTREGADO')}
              className="py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition"
            >
              3. Entregado ✓
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {notifications.length === 0 ? (
            <div className="py-10 text-center text-slate-400 space-y-2">
              <Bell className="w-10 h-10 mx-auto text-slate-300" />
              <p className="font-bold text-xs text-slate-600">No tienes notificaciones aún</p>
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                onClick={() => {
                  if (n.orderId) {
                    onClose();
                    onNavigateToOrder(n.orderId);
                  }
                }}
                className="bg-white p-3.5 rounded-2xl border border-slate-200/90 hover:border-slate-300 shadow-xs cursor-pointer transition space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      {getIcon(n.type)}
                    </div>
                    <span className="font-black text-xs text-slate-900 leading-snug">
                      {n.title}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                    {timeAgoSpanish(n.timestamp)}
                  </span>
                </div>

                <p className="text-xs text-slate-600 pl-9 leading-relaxed">
                  {n.message}
                </p>

                {n.orderId && (
                  <div className="pl-9 pt-1 flex items-center gap-1 text-[11px] font-bold text-red-600 hover:underline">
                    <span>Ver mapa de entrega</span>
                    <ArrowRight className="w-3 h-3" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

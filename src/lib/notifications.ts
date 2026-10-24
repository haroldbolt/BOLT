export interface PushNotification {
  id: string;
  orderId: string;
  orderNumber: string;
  title: string;
  message: string;
  type:
    | 'ORDER_CONFIRMED'
    | 'ORDER_PREPARING'
    | 'DRIVER_ASSIGNED'
    | 'ORDER_ON_THE_WAY'
    | 'ORDER_DELIVERED'
    | 'PRESCRIPTION_APPROVED'
    | 'PRESCRIPTION_REJECTED';
  timestamp: number;
  read: boolean;
  actionUrl?: string;
  driverName?: string;
  secretDeliveryCode?: string;
}

type NotificationListener = (notification: PushNotification) => void;

class PushNotificationService {
  private listeners: Set<NotificationListener> = new Set();
  private notifications: PushNotification[] = [
    {
      id: 'notif-seed-1',
      orderId: 'ORD-2026-8941',
      orderNumber: '#BP-8941',
      title: '⚡ ¡Tu pedido va en camino!',
      message: 'Carlos Rodríguez recogió tu paquete en Sede Kennedy y viaja hacia tu dirección. Llega en aprox. 7 min.',
      type: 'ORDER_ON_THE_WAY',
      timestamp: Date.now() - 3 * 60 * 1000,
      read: false,
      actionUrl: '/pedido/ORD-2026-8941',
      driverName: 'Carlos Rodríguez',
      secretDeliveryCode: '4892',
    },
    {
      id: 'notif-seed-2',
      orderId: 'ORD-2026-8942',
      orderNumber: '#BP-8942',
      title: '📋 Fórmula veterinaria en revisión',
      message: 'Nuestro equipo farmacéutico está validando la receta médica de Apoquel antes del despacho.',
      type: 'ORDER_PREPARING',
      timestamp: Date.now() - 20 * 60 * 1000,
      read: true,
      actionUrl: '/pedido/ORD-2026-8942',
    },
  ];

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getNotifications(): PushNotification[] {
    return [...this.notifications];
  }

  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  markAllAsRead(): void {
    this.notifications = this.notifications.map(n => ({ ...n, read: true }));
  }

  markAsRead(id: string): void {
    this.notifications = this.notifications.map(n => n.id === id ? { ...n, read: true } : n);
  }

  // Play gentle push notification chime using Web Audio API
  private playChime(): void {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Pleasant melodic two-tone chime (E5 -> G#5)
      osc.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc.frequency.setValueAtTime(830.61, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch {
      // Audio context might be restricted before user gesture
    }
  }

  // Dispatch a simulated push notification
  send(notification: Omit<PushNotification, 'id' | 'timestamp' | 'read'>): PushNotification {
    const fullNotification: PushNotification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      read: false,
    };

    this.notifications.unshift(fullNotification);
    if (this.notifications.length > 30) {
      this.notifications.pop();
    }

    this.playChime();

    // Notify all active subscribers
    for (const listener of this.listeners) {
      try {
        listener(fullNotification);
      } catch (err) {
        console.error('Error invoking notification listener:', err);
      }
    }

    return fullNotification;
  }

  // Quick helper to simulate order state notifications
  simulateOrderTransition(orderNumber: string, orderId: string, status: string, driverName?: string, code?: string): void {
    switch (status) {
      case 'CONFIRMADO':
        this.send({
          orderId,
          orderNumber,
          title: `✓ ¡Pedido ${orderNumber} confirmado!`,
          message: 'Tu pago fue aprobado exitosamente. Hemos transferido tu pedido al equipo de alistamiento.',
          type: 'ORDER_CONFIRMED',
          actionUrl: `/pedido/${orderId}`,
        });
        break;

      case 'EN_ALISTAMIENTO':
        this.send({
          orderId,
          orderNumber,
          title: `📦 Preparando tu pedido ${orderNumber}`,
          message: 'El equipo en bodega está seleccionando y empacando tus productos con precintos de seguridad.',
          type: 'ORDER_PREPARING',
          actionUrl: `/pedido/${orderId}`,
        });
        break;

      case 'REPARTIDOR_ASIGNADO':
        this.send({
          orderId,
          orderNumber,
          title: `🛵 Repartidor asignado para ${orderNumber}`,
          message: `${driverName || 'Carlos Rodríguez'} ha sido asignado y se dirige a recoger tu paquete.`,
          type: 'DRIVER_ASSIGNED',
          actionUrl: `/pedido/${orderId}`,
          driverName: driverName || 'Carlos Rodríguez',
        });
        break;

      case 'EN_CAMINO':
        this.send({
          orderId,
          orderNumber,
          title: `⚡ ¡Tu pedido ${orderNumber} va en camino!`,
          message: `${driverName || 'Carlos Rodríguez'} ya inició el recorrido. Recuerda tu código secreto: ${code || '4892'}.`,
          type: 'ORDER_ON_THE_WAY',
          actionUrl: `/pedido/${orderId}`,
          driverName: driverName || 'Carlos Rodríguez',
          secretDeliveryCode: code || '4892',
        });
        break;

      case 'ENTREGADO':
        this.send({
          orderId,
          orderNumber,
          title: `🎉 ¡Pedido ${orderNumber} entregado con éxito!`,
          message: 'El repartidor validó tu código de entrega. ¡Gracias por confiar en Bolt Pets Bogotá!',
          type: 'ORDER_DELIVERED',
          actionUrl: `/pedido/${orderId}`,
        });
        break;

      case 'PRESCRIPTION_APPROVED':
        this.send({
          orderId,
          orderNumber,
          title: `💊 Fórmula veterinaria aprobada (${orderNumber})`,
          message: 'El químico farmacéutico veterinario validó tu receta. Tus medicamentos están listos para despacho.',
          type: 'PRESCRIPTION_APPROVED',
          actionUrl: `/pedido/${orderId}`,
        });
        break;
    }
  }
}

export const pushService = new PushNotificationService();

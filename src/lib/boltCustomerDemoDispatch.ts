import crypto from 'node:crypto';
import type { Order, OrderActor, Store } from '../types';
import { boltCustomerDemoVehicle, isBoltCustomerDemoOrder } from './boltAdminDemo';
import { DispatchError, type DispatchService } from './dispatchService';
import type { OrdersRepository } from './ordersRepository';

const pulseIntervalMs = 5000;

export function createCustomerDemoDispatch(repo: OrdersRepository, dispatch: DispatchService, stores: () => Store[]) {
  const starting = new Map<string, Promise<Order>>();

  function pulse(order: Order, now = Date.now()) {
    if (!isBoltCustomerDemoOrder(order) || order.fulfillmentStatus !== 'EN_CAMINO' ||
        order.payment.cashToCollect !== 0 || !order.assignmentId || !order.tripId) return;
    const run = repo.dispatchState.runs[order.assignmentId];
    const candidate = boltCustomerDemoVehicle(order);
    const store = stores().find(entry => entry.id === order.storeId);
    if (!run?.pickedUpAt || run.orderId !== order.id || run.status !== 'PICKED_UP' ||
        !candidate || candidate.driverId !== run.driverId || run.transfer || !store ||
        repo.dispatchState.accounts[candidate.driverId]?.activeDispatchId !== run.id) return;
    const last = repo.getLatestTelemetry(order.id);
    const deadline = Date.parse(order.originalPromiseWindow.end);
    if (!Number.isFinite(deadline) || now >= deadline || (last && now - last.timestamp < pulseIntervalMs)) return;
    const origin = store.verifiedEntrance ?? store.coordinates;
    const destination = order.deliveryAddress.coordinates;
    const progress = Math.max(0, Math.min(1, (now - run.pickedUpAt) / Math.max(1, deadline - run.pickedUpAt)));
    const result = repo.recordTelemetry({
      orderId: order.id,
      assignmentId: run.id,
      tripId: order.tripId,
      driverId: candidate.driverId,
      latitude: origin.lat + (destination.lat - origin.lat) * progress,
      longitude: origin.lng + (destination.lng - origin.lng) * progress,
      timestamp: now,
      sequenceNumber: (last?.sequenceNumber ?? 0) + 1,
      accuracy: 5,
      speed: 0,
      heading: 0,
    }, { role: 'CONDUCTOR', id: candidate.driverId });
    if (!result.success) throw new DispatchError(result.code ?? 409, 'SIMULATION_LOCATION_FAILED', result.error ?? 'No se pudo publicar la posición de prueba.');
  }

  async function start(order: Order, actor: OrderActor) {
    if (!isBoltCustomerDemoOrder(order) || order.payment.cashToCollect !== 0 || order.payment.transactionId ||
        order.deliveryReview?.status !== 'CONFIRMED' || order.deliveryMode !== 'TURBO' || order.isSplitOrder) {
      throw new DispatchError(409, 'SIMULATION_DISPATCH_NOT_READY', 'Confirma primero el pedido Turbo de prueba sin cobro.');
    }
    const vehicle = boltCustomerDemoVehicle(order)!;
    const driverId = vehicle.driverId;
    const run = order.assignmentId && repo.dispatchState.runs[order.assignmentId];
    const store = stores().find(candidate => candidate.id === order.storeId && candidate.isActive);
    if (!run || !store || run.orderId !== order.id || run.cashDue !== 0) {
      throw new DispatchError(409, 'SIMULATION_DISPATCH_NOT_READY', 'El despacho de prueba aún no está disponible en Suba.');
    }
    if (run.driverId === driverId && ['PICKED_UP', 'DELIVERED'].includes(run.status)) return order;
    if (order.fulfillmentStatus !== 'LISTO_PARA_DESPACHO') {
      throw new DispatchError(409, 'SIMULATION_DISPATCH_NOT_READY', 'Marca primero el pedido listo para despacho en BOLT Admin.');
    }
    if (!['PENDING', 'SEARCHING', 'OFFER_PENDING', 'ASSIGNED'].includes(run.status) || run.external ||
        (run.driverId && run.driverId !== driverId)) {
      throw new DispatchError(409, 'SIMULATION_DISPATCH_NOT_READY', 'El estado actual no permite iniciar este despacho de prueba.');
    }

    const email = driverId.toLowerCase() + '@demo.invalid';
    const account = repo.dispatchState.accounts[driverId];
    if ((account && account.email !== email) || (!account && repo.getDriverById(driverId)) ||
        (account?.activeDispatchId && account.activeDispatchId !== run.id)) {
      throw new DispatchError(409, 'SIMULATION_DRIVER_UNAVAILABLE', 'El conductor de prueba no está disponible.');
    }
    const entrance = store.verifiedEntrance ?? store.coordinates;
    repo.transaction(() => {
      if (!account) {
        dispatch.provision({
          email,
          password: crypto.randomBytes(32).toString('base64url'),
          storeIds: [store.id],
          driver: {
            id: driverId,
            name: 'Repartidor de prueba BOLT',
            phone: '0000000000',
            vehicleType: 'CARRO',
            vehiclePlate: 'SIMULADO',
            maxWeightKg: vehicle.maxLoadGrams / 1000,
            rating: 0,
            photo: '',
            isOnline: false,
            currentStatus: 'FUERA_DE_TURNO',
            currentLocation: { ...entrance, updatedAt: new Date(0).toISOString() },
            cashBalance: 0,
          },
        }, actor.id ?? 'BOLT_ADMIN');
      }
      if (repo.dispatchState.accounts[driverId].status === 'OFF_DUTY') dispatch.shift(driverId, 'START');
      dispatch.location(driverId, { latitude: entrance.lat, longitude: entrance.lng, accuracy: 5, timestamp: Date.now() });
      if (run.status === 'PENDING') run.attempted = run.attempted.filter(id => id !== driverId);
    });

    if (run.status === 'PENDING' || run.status === 'SEARCHING') await dispatch.search(run.id, actor.id);
    return repo.transaction(() => {
      const current = repo.dispatchState.runs[run.id];
      if (current.status === 'OFFER_PENDING') {
        const offer = current.offerId && repo.dispatchState.offers[current.offerId];
        if (offer && offer.driverId === driverId) dispatch.respond(driverId, offer.id, 'accept');
      }
      if (current.status !== 'ASSIGNED' || current.driverId !== driverId) {
        throw new DispatchError(409, 'SIMULATION_DRIVER_UNAVAILABLE', 'El conductor de prueba no pudo aceptar el despacho.');
      }
      if (!current.arrivedAt) dispatch.arrived(driverId, current.id);
      dispatch.pickup(driverId, current.id, order.items.reduce((count, item) => count + item.quantity, 0));
      const updated = repo.getOrderById(order.id)!;
      pulse(updated);
      return updated;
    });
  }

  return {
    isStarting: (orderId: string) => starting.has(orderId),
    start(order: Order, actor: OrderActor) {
      const active = starting.get(order.id);
      if (active) return active;
      // The worker may search this order only during this authenticated action.
      const task = Promise.resolve().then(() => start(order, actor)).finally(() => starting.delete(order.id));
      starting.set(order.id, task);
      return task;
    },
    tick() {
      for (const run of Object.values(repo.dispatchState.runs)) {
        if (run.status !== 'PICKED_UP') continue;
        const order = repo.getOrderById(run.orderId);
        if (order) pulse(order);
      }
    },
  };
}

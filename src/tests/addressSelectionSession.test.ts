import assert from 'node:assert/strict';
import { AddressSelectionSession } from '../lib/addressSelectionSession';
import type { AddressLocation, AddressSelectionState } from '../lib/addressSelectionSession';

let checks = 0;
function check(value: unknown, description: string) { assert.ok(value, description); checks++; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const A: AddressLocation = { address: 'Dirección A, Bogotá', coordinates: { lat: 4.63, lng: -74.14 } };
const B: AddressLocation = { address: 'Dirección B, Bogotá', coordinates: { lat: 4.74, lng: -74.09 } };

function harness() {
  const states: AddressSelectionState<string>[] = [];
  const forwards: { address: string; signal: AbortSignal; result: ReturnType<typeof deferred<AddressLocation>> }[] = [];
  const reverses: { coordinates: AddressLocation['coordinates']; signal: AbortSignal; result: ReturnType<typeof deferred<AddressLocation>> }[] = [];
  const quotes: { location: AddressLocation; cart: string; signal: AbortSignal; result: ReturnType<typeof deferred<string>> }[] = [];
  const cart = { value: 'carrito inicial' };
  const session = new AddressSelectionSession<string>({
    debounceMs: 0,
    forward: (address, signal) => {
      const result = deferred<AddressLocation>(); forwards.push({ address, signal, result }); return result.promise;
    },
    reverse: (coordinates, signal) => {
      const result = deferred<AddressLocation>(); reverses.push({ coordinates, signal, result }); return result.promise;
    },
    quote: (location, signal) => {
      const result = deferred<string>(); quotes.push({ location, cart: cart.value, signal, result }); return result.promise;
    },
    onChange: state => states.push(state),
  });
  return { session, states, forwards, reverses, quotes, cart };
}

{
  const h = harness();
  h.session.initialize(A.address, A.coordinates);
  const pending = h.session.state;
  check(pending.status === 'quoting' && pending.quote === null, 'Abrir requiere cotizar la pareja existente antes de confirmar');
  h.quotes[0].result.resolve('cotización A'); await tick();
  check(h.session.state.status === 'ready' && h.session.state.quote === 'cotización A', 'La pareja existente queda lista únicamente tras recibir su cotización');
  check(pending.status === 'quoting' && pending.quote === null, 'Las actualizaciones no mutan snapshots anteriores');
  h.session.typeAddress(B.address);
  check(h.session.state.status === 'resolving' && h.session.state.quote === null && h.session.state.address === B.address, 'Escribir invalida inmediatamente la cotización anterior');
  check(h.session.state.coordinates?.lat === A.coordinates.lat, 'El pin anterior puede seguir visible mientras no sea confirmable');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(A.address); await tick();
  h.session.typeAddress(B.address); await tick();
  check(h.forwards[0].signal.aborted, 'La dirección B aborta la búsqueda de A');
  h.forwards[1].result.resolve(B); await tick();
  h.forwards[0].result.resolve(A); await tick();
  check(h.quotes.length === 1 && h.quotes[0].location.address === B.address, 'Una respuesta de A tardía no inicia cotización ni sustituye B');
  h.quotes[0].result.resolve('entrega B'); await tick();
  check(h.session.state.address === B.address && h.session.state.coordinates?.lat === B.coordinates.lat && h.session.state.quote === 'entrega B', 'Texto, coordenadas y cotización corresponden a la última dirección');
  h.session.dispose();
}

{
  const h = harness();
  h.session.initialize(A.address, A.coordinates);
  h.session.initialize(B.address, B.coordinates);
  check(h.quotes[0].signal.aborted, 'Cambiar de ubicación aborta una cotización pendiente');
  h.quotes[1].result.resolve('entrega B'); await tick();
  h.quotes[0].result.resolve('entrega A'); await tick();
  check(h.session.state.address === B.address && h.session.state.quote === 'entrega B', 'Las cotizaciones fuera de orden no restauran la dirección antigua');
  h.session.dispose();
}

{
  const h = harness();
  h.session.selectCoordinates(A.coordinates);
  h.session.typeAddress(B.address); await tick();
  check(h.reverses[0].signal.aborted, 'Escribir cancela la consulta inversa de un pin anterior');
  h.forwards[0].result.resolve(B); await tick();
  h.reverses[0].result.resolve(A); await tick();
  h.quotes[0].result.resolve('entrega B'); await tick();
  check(h.session.state.address === B.address && h.session.state.quote === 'entrega B', 'Pin seguido de texto respeta la última intención del cliente');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(A.address); await tick();
  h.session.selectCoordinates(B.coordinates);
  check(h.forwards[0].signal.aborted && h.session.state.coordinates?.lat === B.coordinates.lat, 'Mover el pin cancela la búsqueda escrita y muestra el nuevo punto');
  h.reverses[0].result.resolve(B); await tick();
  h.forwards[0].result.reject(new Error('Falló A, ya obsoleta')); await tick();
  h.quotes[0].result.resolve('entrega B'); await tick();
  check(h.session.state.status === 'ready' && h.session.state.address === B.address, 'Texto seguido de pin ignora incluso errores antiguos');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(A.address);
  h.session.selectCoordinates(B.coordinates); await tick();
  check(h.forwards.length === 0 && h.reverses.length === 1, 'Mover el pin también cancela la búsqueda escrita todavía en espera');
  h.reverses[0].result.reject(new Error('No se encontró una vía reconocida')); await tick();
  check(h.session.state.status === 'error' && h.session.state.quote === null && h.session.state.error?.includes('vía reconocida'), 'Un fallo inverso informa el error y no deja confirmar texto antiguo');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(A.address); await tick();
  h.forwards[0].result.reject(new Error('Dirección ambigua. Elige un resultado.')); await tick();
  check(h.session.state.address === A.address && h.session.state.status === 'error' && h.session.state.error?.includes('ambigua'), 'El error conserva el texto que necesita corrección');
  h.session.refreshQuote();
  check(h.quotes.length === 0, 'Reintentar cotización no utiliza una ubicación que nunca se resolvió');
  h.session.typeAddress('   '); await tick();
  check(h.session.state.status === 'error' && !!h.session.state.error && h.forwards.length === 1, 'La dirección vacía no consulta servicios ni queda confirmable');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(A.address); await tick();
  h.forwards[0].result.resolve({ ...A, coordinates: { lat: NaN, lng: -74 } }); await tick();
  check(h.session.state.status === 'error' && h.quotes.length === 0, 'No se cotizan coordenadas inválidas devueltas por el proveedor');
  h.session.selectCoordinates({ lat: 100, lng: 1 });
  check(h.session.state.status === 'error' && h.reverses.length === 0, 'Un pin inválido no se envía a geocodificación');
  h.session.initialize(A.address, null);
  check(h.session.state.status === 'error' && h.quotes.length === 0, 'Abrir sin coordenadas válidas no inventa un destino');
  h.session.dispose();
}

{
  const h = harness();
  h.session.initialize(A.address, A.coordinates);
  h.quotes[0].result.reject(new Error('No fue posible consultar la entrega')); await tick();
  check(h.session.state.status === 'error' && h.session.state.quote === null, 'El fallo de cotización impide confirmar aunque la ubicación sea válida');
  h.session.refreshQuote();
  check(h.quotes.length === 2 && h.session.state.status === 'quoting', 'La cotización de una ubicación resuelta admite reintento');
  h.quotes[1].result.resolve('entrega recuperada'); await tick();
  check(h.session.state.status === 'ready' && h.session.state.quote === 'entrega recuperada', 'Un reintento exitoso habilita la misma ubicación sin geocodificarla otra vez');
  h.session.refreshQuote();
  h.quotes[2].result.reject(new Error('Nuevo fallo de entrega')); await tick();
  check(h.session.state.status === 'error' && h.session.state.quote === null, 'Un refresco fallido nunca conserva una cotización vieja como confirmable');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(B.address); await tick();
  h.cart.value = 'carrito actualizado';
  h.session.refreshQuote();
  check(h.session.state.address === B.address && h.session.state.status === 'resolving' && !h.forwards[0].signal.aborted, 'Cambiar carrito o detalles durante la búsqueda no reinicia ni cancela la dirección escrita');
  h.forwards[0].result.resolve(B); await tick();
  check(h.quotes.length === 1 && h.quotes[0].cart === 'carrito actualizado', 'La búsqueda cotiza con los datos más recientes al resolverse');
  h.session.refreshQuote();
  check(h.quotes[0].signal.aborted && h.quotes.length === 2, 'Refrescar durante una cotización reemplaza únicamente la cotización obsoleta');
  h.quotes[1].result.resolve('entrega actualizada'); await tick();
  h.quotes[0].result.resolve('entrega vieja'); await tick();
  check(h.session.state.quote === 'entrega actualizada' && h.session.state.address === B.address, 'El refresco mantiene la ubicación actual y descarta cotizaciones tardías');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(A.address); await tick();
  const countBeforeClose = h.states.length;
  h.session.dispose();
  check(h.forwards[0].signal.aborted && h.session.state.status === 'idle', 'Cerrar cancela solicitudes y elimina el borrador confirmable');
  h.forwards[0].result.resolve(A); await tick();
  check(h.states.length === countBeforeClose && h.quotes.length === 0, 'Una respuesta después de cerrar no emite cambios ni cotiza');
  h.session.initialize(B.address, B.coordinates);
  h.quotes[0].result.resolve('entrega reapertura'); await tick();
  check(h.session.state.status === 'ready' && h.session.state.address === B.address, 'La misma instancia puede abrirse de nuevo sin heredar solicitudes anteriores');
  h.session.dispose();
}

{
  const h = harness();
  h.session.typeAddress(A.address); await tick();
  h.session.dispose();
  h.session.initialize(B.address, B.coordinates);
  h.forwards[0].result.resolve(A); await tick();
  check(h.quotes.length === 1 && h.session.state.address === B.address, 'Una respuesta de la sesión cerrada tampoco afecta una reapertura ya iniciada');
  h.session.dispose();
  const count = h.states.length;
  h.session.typeAddress(A.address); h.session.selectCoordinates(A.coordinates); h.session.refreshQuote(); await tick();
  check(h.states.length === count && h.forwards.length === 1 && h.reverses.length === 0, 'Las acciones accidentales de un modal cerrado permanecen inactivas');
}

{
  const h = harness();
  h.session.typeAddress(A.address); h.session.dispose(); await tick();
  check(h.forwards.length === 0, 'Cerrar antes del debounce elimina el temporizador pendiente');
}

console.log(`${checks} comprobaciones de sincronización de dirección, mapa y cotización aprobadas.`);

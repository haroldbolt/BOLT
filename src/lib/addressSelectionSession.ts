import type { LatLng } from './deliveryService';

export type AddressSelectionStatus = 'idle' | 'resolving' | 'quoting' | 'ready' | 'error';

export interface AddressLocation {
  address: string;
  coordinates: LatLng;
}

export interface AddressSelectionState<Q> {
  address: string;
  coordinates: LatLng | null;
  quote: Q | null;
  status: AddressSelectionStatus;
  error: string | null;
}

export interface AddressSelectionDependencies<Q> {
  forward: (address: string, signal: AbortSignal) => Promise<AddressLocation>;
  reverse: (coordinates: LatLng, signal: AbortSignal) => Promise<AddressLocation>;
  quote: (location: AddressLocation, signal: AbortSignal) => Promise<Q>;
  onChange: (state: AddressSelectionState<Q>) => void;
  debounceMs?: number;
}

function validCoordinates(value: LatLng | null | undefined): value is LatLng {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
    value.lat >= -90 && value.lat <= 90 && value.lng >= -180 && value.lng <= 180;
}

function copyLocation(location: AddressLocation): AddressLocation {
  return { address: location.address, coordinates: { ...location.coordinates } };
}

/** A single address draft. Text, map and quotes share one latest-intent revision. */
export class AddressSelectionSession<Q> {
  private current: AddressSelectionState<Q> = {
    address: '', coordinates: null, quote: null, status: 'idle', error: null,
  };
  private resolved: AddressLocation | null = null;
  private revision = 0;
  private active = true;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly dependencies: AddressSelectionDependencies<Q>) {}

  get state(): AddressSelectionState<Q> {
    return this.snapshot();
  }

  private snapshot(): AddressSelectionState<Q> {
    return Object.freeze({
      ...this.current,
      coordinates: this.current.coordinates ? Object.freeze({ ...this.current.coordinates }) : null,
    });
  }

  private publish(state: AddressSelectionState<Q>) {
    this.current = { ...state, coordinates: state.coordinates ? { ...state.coordinates } : null };
    if (this.active) this.dependencies.onChange(this.snapshot());
  }

  private begin() {
    this.revision++;
    this.controller?.abort();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller = new AbortController();
    return { revision: this.revision, signal: this.controller.signal };
  }

  private isCurrent(revision: number) {
    return this.active && revision === this.revision && !this.controller?.signal.aborted;
  }

  private fail(revision: number, error: unknown, fallback: string) {
    if (!this.isCurrent(revision)) return;
    const message = error instanceof Error && error.message.trim() ? error.message : fallback;
    this.publish({ ...this.current, quote: null, status: 'error', error: message });
  }

  private validateLocation(location: AddressLocation): AddressLocation {
    if (!location || typeof location.address !== 'string' || !location.address.trim() || !validCoordinates(location.coordinates)) {
      throw new Error('No fue posible validar esta dirección. Comprueba el texto o ajusta el pin del mapa.');
    }
    return { address: location.address.trim(), coordinates: { ...location.coordinates } };
  }

  private async requestQuote(location: AddressLocation, revision: number, signal: AbortSignal) {
    if (!this.isCurrent(revision)) return;
    this.resolved = copyLocation(location);
    this.publish({ ...copyLocation(location), quote: null, status: 'quoting', error: null });
    if (!this.isCurrent(revision)) return;
    try {
      const quote = await this.dependencies.quote(copyLocation(location), signal);
      if (!this.isCurrent(revision)) return;
      if (quote === null || quote === undefined) throw new Error('No fue posible calcular la entrega para esta dirección. Intenta nuevamente.');
      this.publish({ ...copyLocation(location), quote, status: 'ready', error: null });
    } catch (error) {
      this.fail(revision, error, 'No fue posible calcular la entrega. Intenta nuevamente.');
    }
  }

  /** Reopens the draft with an existing address/coordinate pair and a fresh quote. */
  initialize(address: string, coordinates: LatLng | null | undefined) {
    this.active = true;
    const { revision, signal } = this.begin();
    this.resolved = null;
    const text = address.trim();
    this.publish({ address, coordinates: validCoordinates(coordinates) ? coordinates : null, quote: null, status: 'idle', error: null });
    if (!this.isCurrent(revision)) return;
    if (!text || !validCoordinates(coordinates)) {
      this.fail(revision, null, 'Escribe y valida una dirección para continuar.');
      return;
    }
    void this.requestQuote({ address: text, coordinates: { ...coordinates } }, revision, signal);
  }

  typeAddress(address: string) {
    if (!this.active) return;
    const { revision, signal } = this.begin();
    this.resolved = null;
    this.publish({ ...this.current, address, quote: null, status: 'resolving', error: null });
    if (!this.isCurrent(revision)) return;
    if (!address.trim()) {
      this.fail(revision, null, 'Escribe una dirección para continuar.');
      return;
    }
    const delay = Math.max(0, this.dependencies.debounceMs ?? 500);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.resolveLocation(() => this.dependencies.forward(address, signal), revision, signal);
    }, delay);
  }

  selectCoordinates(coordinates: LatLng) {
    if (!this.active) return;
    const { revision, signal } = this.begin();
    this.resolved = null;
    if (!validCoordinates(coordinates)) {
      this.publish({ ...this.current, quote: null, status: 'error', error: 'El punto seleccionado no tiene coordenadas válidas.' });
      return;
    }
    const selected = { ...coordinates };
    this.publish({ ...this.current, coordinates: selected, quote: null, status: 'resolving', error: null });
    if (!this.isCurrent(revision)) return;
    void this.resolveLocation(() => this.dependencies.reverse({ ...selected }, signal), revision, signal);
  }

  private async resolveLocation(resolve: () => Promise<AddressLocation>, revision: number, signal: AbortSignal) {
    if (!this.isCurrent(revision)) return;
    try {
      const result = await resolve();
      if (!this.isCurrent(revision)) return;
      const location = this.validateLocation(result);
      await this.requestQuote(location, revision, signal);
    } catch (error) {
      this.fail(revision, error, 'No fue posible identificar esta dirección. Comprueba el texto o ajusta el pin.');
    }
  }

  /** New cart/details data can refresh a quote without resetting an address being typed. */
  refreshQuote() {
    if (!this.active || this.current.status === 'resolving' || !this.resolved) return;
    const location = copyLocation(this.resolved);
    const { revision, signal } = this.begin();
    void this.requestQuote(location, revision, signal);
  }

  /** Stops timers and makes every in-flight response from the closed modal obsolete. */
  dispose() {
    this.active = false;
    this.begin();
    this.controller?.abort();
    this.controller = null;
    this.resolved = null;
    this.current = { address: '', coordinates: null, quote: null, status: 'idle', error: null };
  }
}

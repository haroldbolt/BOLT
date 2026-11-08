import type { TransportVehicle } from "../types/transport";
import type { PickupEstimate } from "../types/dispatch";
export interface ProviderQuote {
  id: string;
  providerId: string;
  expiresAt: number;
  costCOP: number;
  estimate: PickupEstimate;
  vehicle: TransportVehicle;
  canCollectCash: boolean;
  simulation: boolean;
}
export interface ProviderResult {
  status: "UNKNOWN" | "ACCEPTED" | "ASSIGNED" | "REJECTED" | "CANCELLED";
  reference?: string;
  driver?: { id: string; name: string };
}
export interface DispatchProvider {
  id: string;
  name: string;
  simulation: boolean;
  capabilities: {
    quote: boolean;
    request: boolean;
    status: boolean;
    cancel: boolean;
    cashCollection: boolean;
  };
  quote(input: {
    dispatchId: string;
    storeId: string;
    mode: string;
    cashCOP: number;
  }): Promise<ProviderQuote | null>;
  request(input: {
    idempotencyKey: string;
    quote: ProviderQuote;
    dispatchId: string;
  }): Promise<ProviderResult>;
  status(referenceOrKey: string): Promise<ProviderResult>;
  cancel(referenceOrKey: string): Promise<ProviderResult>;
}
/** No credentials, network calls or live services. State is keyed by the durable idempotency key. */
export class SimulatedDispatchProvider implements DispatchProvider {
  simulation = true;
  capabilities = {
    quote: true,
    request: true,
    status: true,
    cancel: true,
    cashCollection: false,
  };
  constructor(
    public id: string,
    public name: string,
    private fixture: ProviderQuote,
    public response: ProviderResult = {
      status: "ASSIGNED",
      driver: { id: "SIM-DRIVER", name: "Conductor simulado" },
    },
    public cancelResponse: ProviderResult = { status: "CANCELLED" },
  ) {}
  async quote() {
    return structuredClone(this.fixture);
  }
  async request(input: { idempotencyKey: string }) {
    return {
      ...structuredClone(this.response),
      reference: input.idempotencyKey,
    };
  }
  async status(key: string) {
    return { ...structuredClone(this.response), reference: key };
  }
  async cancel(key: string) {
    return { ...structuredClone(this.cancelResponse), reference: key };
  }
}
export const DISABLED_LIVE_PROVIDERS = [
  {
    id: "rappi",
    name: "Rappi",
    enabled: false,
    reason:
      "Pendientes convenio, credenciales, capacidades verificadas y homologación",
  },
  {
    id: "indrive",
    name: "inDrive",
    enabled: false,
    reason:
      "Pendientes convenio, credenciales, capacidades verificadas y homologación",
  },
];

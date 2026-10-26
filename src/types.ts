/**
 * BOLT PETS — DEFINICIONES DE TIPOS Y CONFIGURACIÓN HORARIA
 */

// Re-exportar tipos base desde index
export * from './types/index';

// ============================================================================
// DEFINICIÓN DE VENTANAS Y CONFIGURACIÓN AUTORITATIVA DE ENTREGA PROGRAMADA
// ============================================================================

export type ScheduledWindowId = 'HORARIO_1' | 'HORARIO_2' | 'HORARIO_3';

export interface ScheduledDeliveryWindow {
  slotId: string;
  windowId?: ScheduledWindowId;
  windowName?: string;
  date: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  displayWindow: string;
  displayWindowShort?: string;
  bookingCutoffTime?: string;
  bookingCutoffLabel?: string;
  commercialHook?: string;
  countdownNotice?: string;
  minutesUntilCutoff?: number;
  availableCapacity?: number;
  maxCapacity?: number;
  cutoffPassed?: boolean;
  price?: number;
}

export interface ScheduledWindowDefinition {
  id: ScheduledWindowId;
  name: string;
  interval: {
    start: string;
    end: string;
  };
  cutoff: {
    hour: number;
    minute: number;
    label: string;
  };
  displayInterval: string;
  displayIntervalText: string;
  commercialHook: string;
}

export interface ScheduledDeliveryConfig {
  timezone: string;
  maxDaysAhead: number;
  maxCapacityPerSlot: number;
  coverageRadiusMeters: number;
  windows: ScheduledWindowDefinition[];
}

export const SCHEDULED_DELIVERY_CONFIG: ScheduledDeliveryConfig = {
  timezone: 'America/Bogota',
  maxDaysAhead: 3,
  maxCapacityPerSlot: 10,
  coverageRadiusMeters: 25000,
  windows: [
    {
      id: 'HORARIO_1',
      name: 'Horario 1',
      interval: {
        start: '09:00',
        end: '14:00',
      },
      cutoff: {
        hour: 10,
        minute: 0,
        label: '10:00 a. m.',
      },
      displayInterval: '09:00–14:00',
      displayIntervalText: '9:00 a. m. a 2:00 p. m.',
      commercialHook: 'Pide antes de las 10:00 a. m. y recibe hoy de 9:00 a. m. a 2:00 p. m.',
    },
    {
      id: 'HORARIO_2',
      name: 'Horario 2',
      interval: {
        start: '14:00',
        end: '18:00',
      },
      cutoff: {
        hour: 12,
        minute: 0,
        label: '12:00 m.',
      },
      displayInterval: '14:00–18:00',
      displayIntervalText: '2:00 p. m. a 6:00 p. m.',
      commercialHook: 'Pide antes de las 12:00 m. y recibe hoy de 2:00 p. m. a 6:00 p. m.',
    },
    {
      id: 'HORARIO_3',
      name: 'Horario 3',
      interval: {
        start: '18:00',
        end: '22:00',
      },
      cutoff: {
        hour: 16,
        minute: 0,
        label: '4:00 p. m.',
      },
      displayInterval: '18:00–22:00',
      displayIntervalText: '6:00 p. m. a 10:00 p. m.',
      commercialHook: 'Pide antes de las 4:00 p. m. y recibe hoy de 6:00 p. m. a 10:00 p. m.',
    },
  ],
};

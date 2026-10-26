/**
 * BOLT PETS — UTILIDADES DE TIEMPO Y DISPONIBILIDAD HORARIA EN BOGOTÁ
 * Timezone autoritativo: America/Bogota (COT, UTC-5 todo el año)
 */

import {
  SCHEDULED_DELIVERY_CONFIG,
  ScheduledDeliveryConfig,
  ScheduledWindowDefinition,
  ScheduledDeliveryWindow,
  ScheduledWindowId,
} from '../types';

export interface BogotaTimeParts {
  year: number;
  month: number; // 0-indexed (0 = Enero, 11 = Diciembre)
  day: number;
  hour: number;
  minute: number;
  dateString: string; // "YYYY-MM-DD"
  totalMinutes: number; // hora * 60 + minuto
}

const SPANISH_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SPANISH_MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Obtiene la hora y fecha locales exactas en la zona horaria America/Bogota.
 * Es inmune al huso horario del servidor o del navegador cliente.
 */
export function getCurrentBogotaTime(referenceDate: Date = new Date()): BogotaTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULED_DELIVERY_CONFIG.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(referenceDate);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10) - 1;
  const day = parseInt(map.day, 10);
  const rawHour = parseInt(map.hour, 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = parseInt(map.minute, 10);
  const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const totalMinutes = hour * 60 + minute;

  return { year, month, day, hour, minute, dateString, totalMinutes };
}

export interface WindowAvailabilityCheck {
  isAvailable: boolean;
  cutoffPassed: boolean;
  minutesUntilCutoff?: number;
  countdownNotice?: string;
  reason?: string;
}

/**
 * Evalúa si una franja de entrega programada puede reservarse para el día de HOY.
 */
export function checkWindowAvailabilityToday(
  windowDef: ScheduledWindowDefinition,
  referenceDate: Date = new Date()
): WindowAvailabilityCheck {
  const bogota = getCurrentBogotaTime(referenceDate);
  const cutoffTotalMinutes = windowDef.cutoff.hour * 60 + windowDef.cutoff.minute;
  const minutesRemaining = cutoffTotalMinutes - bogota.totalMinutes;

  if (minutesRemaining <= 0) {
    return {
      isAvailable: false,
      cutoffPassed: true,
      reason: `La franja ${windowDef.name} cerró a las ${windowDef.cutoff.label} para entrega hoy.`,
    };
  }

  // Faltan minutos para el corte
  let countdownNotice: string | undefined = undefined;
  if (minutesRemaining <= 60) {
    countdownNotice = `⏰ Últimos ${minutesRemaining} minutos para elegir esta franja`;
  }

  return {
    isAvailable: true,
    cutoffPassed: false,
    minutesUntilCutoff: minutesRemaining,
    countdownNotice,
  };
}

export interface FilterWindowsOptions {
  referenceDate?: Date;
  includeExpired?: boolean;
  maxDays?: number;
  config?: ScheduledDeliveryConfig;
}

/**
 * Función principal que calcula la disponibilidad basándose en el tiempo actual en America/Bogota
 * para filtrar las ventanas válidas de entrega programada.
 *
 * Reglas de negocio para entrega el MISMO DÍA en Bogotá:
 * - Antes de las 10:00 a. m. -> Horarios 1, 2 y 3 disponibles (Horario 1 muestra cuenta regresiva si < 60 min).
 * - Después de las 10:00 a. m. (primer corte) -> Horario 1 oculto para hoy; Horarios 2 y 3 disponibles.
 * - Después de las 12:00 m. -> Horarios 1 y 2 ocultos para hoy; solo Horario 3 disponible.
 * - Después de las 4:00 p. m. (16:00) -> 0 horarios para hoy; se muestran las fechas futuras completas.
 * - Días futuros -> Siempre disponibles los 3 horarios completos (el corte de hoy no afecta a mañana).
 */
export function getAvailableScheduledWindows(
  options: FilterWindowsOptions = {}
): ScheduledDeliveryWindow[] {
  const {
    referenceDate = new Date(),
    includeExpired = false,
    maxDays = SCHEDULED_DELIVERY_CONFIG.maxDaysAhead,
    config = SCHEDULED_DELIVERY_CONFIG,
  } = options;

  const validWindows: ScheduledDeliveryWindow[] = [];
  const bogota = getCurrentBogotaTime(referenceDate);

  for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
    const baseDate = new Date(Date.UTC(bogota.year, bogota.month, bogota.day + dayOffset, 12, 0, 0));
    const yyyy = baseDate.getUTCFullYear();
    const mm = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(baseDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dayOfWeek = baseDate.getUTCDay();

    let dayPrefix = '';
    if (dayOffset === 0) dayPrefix = 'Hoy, ';
    else if (dayOffset === 1) dayPrefix = 'Mañana, ';
    else dayPrefix = `${SPANISH_DAYS[dayOfWeek]}, `;

    const dateLabel = `${dayPrefix}${baseDate.getUTCDate()} de ${SPANISH_MONTHS[baseDate.getUTCMonth()]}`;

    for (const winDef of config.windows) {
      const isToday = dayOffset === 0;
      let isAvailable = true;
      let cutoffPassed = false;
      let minutesUntilCutoff: number | undefined = undefined;
      let countdownNotice: string | undefined = undefined;
      let commercialHook = '';

      if (isToday) {
        const check = checkWindowAvailabilityToday(winDef, referenceDate);
        isAvailable = check.isAvailable;
        cutoffPassed = check.cutoffPassed;
        minutesUntilCutoff = check.minutesUntilCutoff;
        countdownNotice = check.countdownNotice;
        commercialHook = winDef.commercialHook;
      } else {
        // Días futuros: nunca son expirados por el corte del día de hoy
        isAvailable = true;
        cutoffPassed = false;
        commercialHook = `Recibe el ${dateLabel} de ${winDef.displayIntervalText}`;
      }

      // Si la franja ya cerró hoy y no se pidió auditoría operativa, se filtra y no se muestra
      if (!isAvailable && !includeExpired) {
        continue;
      }

      validWindows.push({
        slotId: `SLOT-${dateStr}-${winDef.id}`,
        windowId: winDef.id,
        windowName: winDef.name,
        date: dateStr,
        dateLabel,
        startTime: winDef.interval.start,
        endTime: winDef.interval.end,
        displayWindow: winDef.displayInterval,
        displayWindowShort: winDef.displayIntervalText,
        bookingCutoffTime: `${String(winDef.cutoff.hour).padStart(2, '0')}:${String(winDef.cutoff.minute).padStart(2, '0')}`,
        bookingCutoffLabel: winDef.cutoff.label,
        commercialHook,
        countdownNotice,
        minutesUntilCutoff,
        availableCapacity: cutoffPassed ? 0 : (isToday ? 8 : config.maxCapacityPerSlot),
        maxCapacity: config.maxCapacityPerSlot,
        cutoffPassed,
        price: 0,
      });
    }
  }

  return validWindows;
}

/**
 * Valida si una franja de entrega programada es válida y puede reservarse en la fecha objetivo.
 */
export function validateScheduledBookingWindow(
  slot: { date: string; windowId?: ScheduledWindowId; startTime?: string; slotId?: string },
  referenceDate: Date = new Date(),
  config: ScheduledDeliveryConfig = SCHEDULED_DELIVERY_CONFIG
): { valid: boolean; reason?: string } {
  const bogota = getCurrentBogotaTime(referenceDate);
  const isToday = slot.date === bogota.dateString;

  if (!isToday) {
    if (slot.date < bogota.dateString) {
      return { valid: false, reason: 'No es posible programar entregas en fechas pasadas.' };
    }
    return { valid: true };
  }

  const winDef = config.windows.find(
    w => w.id === slot.windowId || slot.slotId?.includes(w.id) || slot.startTime === w.interval.start
  );

  if (!winDef) {
    return { valid: false, reason: 'Franja horaria programada no reconocida.' };
  }

  const check = checkWindowAvailabilityToday(winDef, referenceDate);
  if (!check.isAvailable) {
    return {
      valid: false,
      reason: `La franja ${winDef.name} para entrega hoy cerró a las ${winDef.cutoff.label}. Por favor selecciona otra franja disponible o para mañana.`,
    };
  }

  return { valid: true };
}

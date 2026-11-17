import type { CustomerTrackingTiming } from '../types/customerTracking';

function readDate(value: string | null | undefined) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

export function readDeliveryClock(
  timing: Pick<CustomerTrackingTiming, 'startedAt' | 'dueAt' | 'source'> | undefined,
  now: number,
  terminalAt?: string | null,
) {
  const start = readDate(timing?.startedAt);
  const end = terminalAt === undefined ? now : readDate(terminalAt);
  const elapsedSeconds = start === null || end === null || !Number.isFinite(end) || end < start
    ? null : Math.floor((end - start) / 1000);
  const due = timing?.source === 'VERIFIED_QUOTE' || timing?.source === 'BOOKED_WINDOW'
    ? readDate(timing.dueAt) : null;
  const remainingSeconds = terminalAt !== undefined || due === null || !Number.isFinite(now) || (start !== null && due < start)
    ? null : Math.max(0, Math.ceil((due - now) / 1000));
  return { elapsedSeconds, remainingSeconds, overdue: remainingSeconds === 0 && due !== null && now >= due };
}

export function formatDeliveryClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

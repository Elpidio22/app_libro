export const SESSION_STATES = Object.freeze({
  ACTIVE: 'activa',
  PENDING: 'pendiente',
  COMPLETED: 'completada',
});

export const SESSION_ORIGINS = Object.freeze({
  TIMER: 'cronometro',
  MANUAL: 'manual',
});

export const MAX_SESSION_SECONDS = 12 * 60 * 60;

export function normalizeLocalDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function normalizeLocalTime(value) {
  const time = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? time : null;
}

export function calculateReadPages(startPage, endPage, totalPages = null) {
  const start = Number(startPage);
  const end = Number(endPage);
  const total = totalPages === null || totalPages === undefined || totalPages === '' ? null : Number(totalPages);
  if (!Number.isInteger(start) || start < 0) throw new Error('La página inicial no es válida.');
  if (!Number.isInteger(end) || end < 0) throw new Error('La página final no es válida.');
  if (end < start) throw new Error('La página final no puede ser menor que la inicial.');
  if (total !== null && (!Number.isInteger(total) || total < 0 || end > total)) {
    throw new Error('La página final no puede superar el total del libro.');
  }
  return end - start;
}

export function validateDurationSeconds(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration <= 0) throw new Error('La duración debe ser mayor que cero.');
  if (duration > MAX_SESSION_SECONDS) throw new Error('La duración no puede superar 12 horas.');
  return duration;
}

export function elapsedSessionSeconds(session, now = new Date()) {
  const accumulated = Math.max(0, Number(session?.duracion_acumulada_segundos) || 0);
  if (!session || session.estado !== SESSION_STATES.ACTIVE || session.pausada_en) return accumulated;
  const lastStart = Date.parse(session.ultimo_inicio || session.hora_inicio);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(lastStart) || !Number.isFinite(nowMs) || nowMs <= lastStart) return accumulated;
  return accumulated + Math.floor((nowMs - lastStart) / 1000);
}

export function validateReadingDates(startDate, finishDate) {
  const start = startDate ? normalizeLocalDate(startDate) : null;
  const finish = finishDate ? normalizeLocalDate(finishDate) : null;
  if (startDate && !start) throw new Error('La fecha de inicio no es válida.');
  if (finishDate && !finish) throw new Error('La fecha de finalización no es válida.');
  if (start && finish && finish < start) {
    throw new Error('La fecha de finalización no puede ser anterior a la fecha de inicio.');
  }
  return { start, finish };
}

export function readingCalendarDays(startDate, finishDate) {
  const { start, finish } = validateReadingDates(startDate, finishDate);
  if (!start || !finish) return null;
  return Math.round((Date.parse(`${finish}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;
}

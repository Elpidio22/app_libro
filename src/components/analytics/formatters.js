const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(number(seconds) / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-AR', { month: 'short' })
    .format(new Date(`${value}-15T12:00:00`))
    .replace('.', '');
}

export function formatPercent(value) {
  return `${Math.round(Math.max(0, number(value)) * 100)}%`;
}

export function formatComparison(current, previous, suffix = '') {
  const currentValue = number(current);
  const previousValue = number(previous);
  if (previousValue <= 0) return currentValue > 0 ? 'Primer registro del período' : 'Sin cambios';
  const change = Math.round(((currentValue - previousValue) / previousValue) * 100);
  if (!change) return 'Igual que el mes anterior';
  return `${change > 0 ? '+' : ''}${change}%${suffix ? ` ${suffix}` : ''} vs. mes anterior`;
}

export function dayName(value) {
  if (value === null || value === undefined || value === '') return null;
  return DAY_NAMES[number(value)] || null;
}

export function buildMonthlyNarrative(data) {
  const summary = data?.resumen || {};
  const pages = Math.max(0, number(summary.paginas));
  const duration = formatDuration(summary.duracion_segundos);
  if (!pages && !number(summary.duracion_segundos)) {
    return 'Todavía no hay actividad de lectura registrada este mes. Tu próxima sesión empezará a escribir esta crónica.';
  }
  const sentences = [`Este mes leíste ${pages} ${pages === 1 ? 'página' : 'páginas'} durante ${duration}.`];
  const activeDay = dayName(summary.dia_semana_mas_lector);
  const highlightedBook = data?.librosDestacados?.[0]?.titulo;
  if (activeDay && highlightedBook) {
    sentences.push(`Tu día más activo fue el ${activeDay} y el libro al que más te dedicaste fue ${highlightedBook}.`);
  } else if (activeDay) {
    sentences.push(`Tu día más activo fue el ${activeDay}.`);
  } else if (highlightedBook) {
    sentences.push(`El libro al que más te dedicaste fue ${highlightedBook}.`);
  }
  return sentences.join(' ');
}

export function revisionsKey(revisions = {}) {
  return [
    revisions.sessionsRevision,
    revisions.booksRevision,
    revisions.tagsRevision,
    revisions.wishlistRevision,
  ].map(number).join(':');
}

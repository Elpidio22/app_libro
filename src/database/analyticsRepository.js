import { getDatabase } from '../database';
import { getDatabaseRevisions } from './revisions';

// Una sesión analítica válida debe estar cerrada, durar entre 1 segundo y 12 horas
// y no contener páginas negativas o un rango de páginas invertido.
const MAX_SESSION_SECONDS = 12 * 60 * 60;
const VALID_ACTIVITY_SQL = `
  hora_fin IS NOT NULL
  AND paginas_leidas >= 0
  AND (pagina_inicio IS NULL OR pagina_fin IS NULL OR pagina_fin >= pagina_inicio)
  AND (duracion_segundos IS NULL OR duracion_segundos BETWEEN 1 AND ${MAX_SESSION_SECONDS})
`;
const VALID_SESSION_SQL = `${VALID_ACTIVITY_SQL}
  AND duracion_segundos BETWEEN 1 AND ${MAX_SESSION_SECONDS}
`;

function duracionRealSegundos(sesion) {
  const guardada = Number(sesion?.duracion_segundos);
  if (sesion?.duracion_segundos !== null && sesion?.duracion_segundos !== undefined) {
    return Number.isFinite(guardada) ? guardada : null;
  }
  const inicio = Date.parse(sesion?.hora_inicio);
  const fin = Date.parse(sesion?.hora_fin);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return null;
  return Math.round((fin - inicio) / 1000);
}

export function esSesionValidaParaResumen(sesion) {
  const paginas = Number(sesion?.paginas_leidas);
  const paginaInicio = sesion?.pagina_inicio == null ? null : Number(sesion.pagina_inicio);
  const paginaFin = sesion?.pagina_fin == null ? null : Number(sesion.pagina_fin);
  const duracion = duracionRealSegundos(sesion);
  return Boolean(
    sesion?.hora_fin
    && /^\d{4}-\d{2}-\d{2}$/.test(String(sesion?.fecha || ''))
    && Number.isFinite(paginas)
    && paginas >= 0
    && (paginaInicio === null || paginaFin === null || paginaFin >= paginaInicio)
    && duracion !== null
    && duracion >= 1
    && duracion <= MAX_SESSION_SECONDS
  );
}

export function calcularDiasCalendario(primeraFecha, ultimaFecha) {
  if (!primeraFecha || !ultimaFecha) return null;
  const inicio = Date.parse(`${primeraFecha}T12:00:00Z`);
  const fin = Date.parse(`${ultimaFecha}T12:00:00Z`);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio) return null;
  return Math.round((fin - inicio) / 86400000) + 1;
}

export function calcularRachaMaxima(fechas = []) {
  const dias = [...new Set(fechas.filter((fecha) => /^\d{4}-\d{2}-\d{2}$/.test(String(fecha))))].sort();
  let maxima = 0;
  let actual = 0;
  let anterior = null;
  for (const fecha of dias) {
    const timestamp = Date.parse(`${fecha}T12:00:00Z`);
    actual = anterior !== null && timestamp - anterior === 86400000 ? actual + 1 : 1;
    maxima = Math.max(maxima, actual);
    anterior = timestamp;
  }
  return maxima;
}

export function construirResumenesLectura(libros, sesiones, etiquetas) {
  const sesionesPorLibro = new Map();
  const totalSesionesPorLibro = new Map();
  for (const sesion of sesiones) {
    totalSesionesPorLibro.set(sesion.libro_uuid, (totalSesionesPorLibro.get(sesion.libro_uuid) || 0) + 1);
    if (!esSesionValidaParaResumen(sesion)) continue;
    const acumuladas = sesionesPorLibro.get(sesion.libro_uuid) || [];
    acumuladas.push({ ...sesion, duracion_calculada: duracionRealSegundos(sesion) });
    sesionesPorLibro.set(sesion.libro_uuid, acumuladas);
  }

  const etiquetasPorLibro = new Map();
  for (const etiqueta of etiquetas) {
    const acumuladas = etiquetasPorLibro.get(etiqueta.libro_uuid) || [];
    acumuladas.push({ uuid: etiqueta.uuid, nombre: etiqueta.nombre });
    etiquetasPorLibro.set(etiqueta.libro_uuid, acumuladas);
  }

  return libros.map((libro) => {
    const validas = sesionesPorLibro.get(libro.uuid) || [];
    const fechas = validas.map((sesion) => sesion.fecha).sort();
    const diasActivos = new Set(fechas).size;
    const primeraSesion = fechas[0] || null;
    const ultimaSesion = fechas[fechas.length - 1] || null;
    const diasCalendario = calcularDiasCalendario(primeraSesion, ultimaSesion);
    const paginasRegistradas = validas.reduce((total, sesion) => total + numero(sesion.paginas_leidas), 0);
    const duracionSegundos = validas.reduce((total, sesion) => total + numero(sesion.duracion_calculada), 0);
    const paginasTotales = libro.paginas_totales == null ? null : numero(libro.paginas_totales);
    const cobertura = paginasTotales > 0 ? Math.min(1, paginasRegistradas / paginasTotales) : null;
    const totalSesiones = totalSesionesPorLibro.get(libro.uuid) || 0;

    return {
      ...libro,
      etiquetas: etiquetasPorLibro.get(libro.uuid) || [],
      actividad: validas.length ? {
        sesiones: validas.length,
        sesiones_excluidas: Math.max(0, totalSesiones - validas.length),
        primera_sesion: primeraSesion,
        ultima_sesion: ultimaSesion,
        dias_calendario: diasCalendario,
        dias_activos: diasActivos,
        racha_maxima: calcularRachaMaxima(fechas),
        regularidad: diasCalendario ? diasActivos / diasCalendario : null,
        paginas_registradas: paginasRegistradas,
        duracion_segundos: duracionSegundos,
        paginas_promedio_sesion: paginasRegistradas / validas.length,
        minutos_promedio_sesion: (duracionSegundos / 60) / validas.length,
        velocidad_paginas_hora: duracionSegundos > 0 ? (paginasRegistradas * 3600) / duracionSegundos : null,
        cobertura_sesiones: cobertura,
        cobertura_parcial: cobertura !== null && cobertura < 1,
      } : null,
      sesiones_registradas_total: totalSesiones,
    };
  });
}

function sqlConAlias(sql, alias) {
  return sql.replace(/\b(hora_fin|duracion_segundos|paginas_leidas|pagina_inicio|pagina_fin)\b/g, `${alias}.$1`);
}

let cache = null;
let requestGeneration = 0;
let latestCompletedGeneration = 0;

function fechaLocalISO(fecha = new Date()) {
  const offset = fecha.getTimezoneOffset() * 60000;
  return new Date(fecha.getTime() - offset).toISOString().slice(0, 10);
}

function desplazarMeses(fecha, cantidad) {
  const resultado = new Date(`${fechaLocalISO(fecha)}T12:00:00`);
  resultado.setDate(1);
  resultado.setMonth(resultado.getMonth() + cantidad);
  return fechaLocalISO(resultado);
}

function validarRango({ desde, hasta } = {}) {
  const hoy = fechaLocalISO();
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const desdeFinal = desde || inicioMes;
  const hastaFinal = hasta || hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desdeFinal) || !/^\d{4}-\d{2}-\d{2}$/.test(hastaFinal)) {
    throw new Error('El rango analítico debe usar fechas YYYY-MM-DD.');
  }
  if (desdeFinal > hastaFinal) throw new Error('La fecha inicial no puede superar la fecha final.');
  return { desde: desdeFinal, hasta: hastaFinal, hoy };
}

function mismasRevisiones(a, b) {
  return a && b && Object.keys(a).every((key) => a[key] === b[key]);
}

function numero(value) {
  return Number(value) || 0;
}

function mapearMeses(desdeMes, cantidad, sesiones, terminados) {
  const sesionesPorMes = new Map(sesiones.map((item) => [item.mes, item]));
  const terminadosPorMes = new Map(terminados.map((item) => [item.mes, numero(item.libros_terminados)]));
  return Array.from({ length: cantidad }, (_, index) => {
    const mes = desplazarMeses(new Date(`${desdeMes}T12:00:00`), index).slice(0, 7);
    const item = sesionesPorMes.get(mes) || {};
    return {
      mes,
      paginas: numero(item.paginas),
      duracion_segundos: numero(item.duracion_segundos),
      dias_activos: numero(item.dias_activos),
      libros_terminados: terminadosPorMes.get(mes) || 0,
    };
  });
}

async function ejecutarSnapshot(db, callback) {
  if (typeof db.withTransactionAsync === 'function') {
    let resultado;
    await db.withTransactionAsync(async () => { resultado = await callback(db); });
    return resultado;
  }
  return callback(db);
}

async function consultarDashboard(db, rango) {
  const actividadDesde = desplazarMeses(new Date(`${rango.hoy}T12:00:00`), -5);
  const tendenciaDesde = desplazarMeses(new Date(`${rango.hoy}T12:00:00`), -11);
  const hace30 = fechaLocalISO(new Date(new Date(`${rango.hoy}T12:00:00`).getTime() - 29 * 86400000));
  const hace7 = fechaLocalISO(new Date(new Date(`${rango.hoy}T12:00:00`).getTime() - 6 * 86400000));

  const [
    resumenSesiones,
    velocidadRaw,
    librosTerminados,
    actividadDiaria,
    sesionesMensuales,
    terminadosMensuales,
    etiquetas,
    librosDestacados,
    wishlistRaw,
    consistenciaRaw,
    horarioRaw,
    diaSemanaRaw,
    estadoLibros,
    librosLeyendo,
    librosParaResumen,
    sesionesParaResumen,
    etiquetasParaResumen,
  ] = await Promise.all([
    db.getFirstAsync(`
      SELECT COALESCE(SUM(paginas_leidas), 0) AS paginas,
             COALESCE(SUM(COALESCE(duracion_segundos, 0)), 0) AS duracion_segundos,
             COUNT(*) AS sesiones,
             COUNT(DISTINCT fecha) AS dias_activos,
             COALESCE(AVG(duracion_segundos), 0) AS sesion_promedio_segundos,
             COALESCE(AVG(paginas_leidas), 0) AS sesion_promedio_paginas
      FROM sesiones_lectura
      WHERE fecha BETWEEN ? AND ? AND ${VALID_ACTIVITY_SQL}`,
    rango.desde, rango.hasta),
    db.getFirstAsync(`
      SELECT COALESCE(SUM(paginas_leidas), 0) AS paginas,
             COALESCE(SUM(duracion_segundos), 0) AS duracion_segundos,
             COUNT(*) AS sesiones
      FROM sesiones_lectura
      WHERE fecha BETWEEN ? AND ? AND ${VALID_SESSION_SQL}`,
    rango.desde, rango.hasta),
    db.getFirstAsync(`
      SELECT COUNT(*) AS cantidad FROM mis_libros
      WHERE estado = 'terminado' AND fecha_fin BETWEEN ? AND ?`,
    rango.desde, rango.hasta),
    db.getAllAsync(`
      SELECT fecha, COUNT(*) AS sesiones,
             COALESCE(SUM(paginas_leidas), 0) AS paginas,
             COALESCE(SUM(COALESCE(duracion_segundos, 0)), 0) AS duracion_segundos
      FROM sesiones_lectura
      WHERE fecha BETWEEN ? AND ? AND ${VALID_ACTIVITY_SQL}
      GROUP BY fecha ORDER BY fecha ASC`,
    actividadDesde, rango.hoy),
    db.getAllAsync(`
      SELECT substr(fecha, 1, 7) AS mes,
             COALESCE(SUM(paginas_leidas), 0) AS paginas,
             COALESCE(SUM(COALESCE(duracion_segundos, 0)), 0) AS duracion_segundos,
             COUNT(DISTINCT fecha) AS dias_activos
      FROM sesiones_lectura
      WHERE fecha BETWEEN ? AND ? AND ${VALID_ACTIVITY_SQL}
      GROUP BY substr(fecha, 1, 7) ORDER BY mes ASC`,
    tendenciaDesde, rango.hoy),
    db.getAllAsync(`
      SELECT substr(fecha_fin, 1, 7) AS mes, COUNT(*) AS libros_terminados
      FROM mis_libros
      WHERE estado = 'terminado' AND fecha_fin BETWEEN ? AND ?
      GROUP BY substr(fecha_fin, 1, 7)`,
    tendenciaDesde, rango.hoy),
    db.getAllAsync(`
      SELECT e.uuid, e.nombre, COUNT(s.id) AS sesiones,
             COALESCE(SUM(s.paginas_leidas), 0) AS paginas,
             COALESCE(SUM(COALESCE(s.duracion_segundos, 0)), 0) AS duracion_segundos
      FROM etiquetas e
      JOIN libro_etiquetas le ON le.etiqueta_uuid = e.uuid
      JOIN sesiones_lectura s ON s.libro_uuid = le.libro_uuid
      WHERE s.fecha BETWEEN ? AND ? AND ${sqlConAlias(VALID_ACTIVITY_SQL, 's')}
      GROUP BY e.uuid, e.nombre ORDER BY paginas DESC, e.nombre COLLATE NOCASE`,
    rango.desde, rango.hasta),
    db.getAllAsync(`
      SELECT l.uuid, l.id, l.titulo, l.autor,
             COUNT(s.id) AS sesiones,
             COALESCE(SUM(s.paginas_leidas), 0) AS paginas,
             COALESCE(SUM(COALESCE(s.duracion_segundos, 0)), 0) AS duracion_segundos
      FROM mis_libros l
      JOIN sesiones_lectura s ON s.libro_uuid = l.uuid
      WHERE s.fecha BETWEEN ? AND ? AND ${sqlConAlias(VALID_ACTIVITY_SQL, 's')}
      GROUP BY l.uuid, l.id, l.titulo, l.autor
      ORDER BY paginas DESC, duracion_segundos DESC LIMIT 5`,
    rango.desde, rango.hasta),
    db.getFirstAsync(`
      SELECT SUM(CASE WHEN estado = 'activo' THEN 1 ELSE 0 END) AS activos,
             SUM(CASE WHEN estado = 'adquirido' THEN 1 ELSE 0 END) AS adquiridos,
             SUM(CASE WHEN estado = 'descartado' THEN 1 ELSE 0 END) AS descartados,
             AVG(CASE WHEN estado = 'adquirido' AND julianday(fecha_resolucion) >= julianday(fecha_agregado)
                 THEN (julianday(fecha_resolucion) - julianday(fecha_agregado)) * 86400 END) AS segundos_hasta_adquirir
      FROM lista_compras`),
    db.getFirstAsync(`
      SELECT COUNT(DISTINCT CASE WHEN fecha BETWEEN ? AND ? THEN fecha END) AS dias_7,
             COUNT(DISTINCT CASE WHEN fecha BETWEEN ? AND ? THEN fecha END) AS dias_30
      FROM sesiones_lectura WHERE ${VALID_ACTIVITY_SQL}`,
    hace7, rango.hoy, hace30, rango.hoy),
    db.getFirstAsync(`
      SELECT CAST(strftime('%H', hora_inicio) AS INTEGER) AS hora, COUNT(*) AS sesiones
      FROM sesiones_lectura WHERE ${VALID_ACTIVITY_SQL}
      GROUP BY hora ORDER BY sesiones DESC, hora ASC LIMIT 1`),
    db.getFirstAsync(`
      SELECT CAST(strftime('%w', fecha) AS INTEGER) AS dia_semana,
             SUM(duracion_segundos) AS duracion_segundos, SUM(paginas_leidas) AS paginas
      FROM sesiones_lectura WHERE ${VALID_ACTIVITY_SQL}
      GROUP BY dia_semana ORDER BY duracion_segundos DESC, paginas DESC LIMIT 1`),
    db.getFirstAsync(`
      SELECT SUM(CASE WHEN estado = 'terminado' THEN 1 ELSE 0 END) AS terminados,
             SUM(CASE WHEN estado = 'abandonado' THEN 1 ELSE 0 END) AS abandonados
      FROM mis_libros`),
    db.getAllAsync(`
      SELECT uuid, id, titulo, pagina_actual, paginas_totales
      FROM mis_libros
      WHERE estado = 'leyendo' AND paginas_totales IS NOT NULL AND paginas_totales > pagina_actual`),
    db.getAllAsync(`
      SELECT id, uuid, isbn, titulo, autor, portada_url, paginas_totales,
             pagina_actual, estado, calificacion, notas, fecha_fin
      FROM mis_libros
      WHERE estado = 'terminado'
      ORDER BY fecha_fin IS NULL ASC, fecha_fin DESC, titulo COLLATE NOCASE`),
    db.getAllAsync(`
      SELECT s.id, s.libro_uuid, s.fecha, s.hora_inicio, s.hora_fin,
             s.paginas_leidas, s.pagina_inicio, s.pagina_fin, s.duracion_segundos
      FROM sesiones_lectura s
      JOIN mis_libros l ON l.uuid = s.libro_uuid
      WHERE l.estado = 'terminado'
      ORDER BY s.libro_uuid, s.fecha, s.hora_inicio`),
    db.getAllAsync(`
      SELECT le.libro_uuid, e.uuid, e.nombre
      FROM libro_etiquetas le
      JOIN etiquetas e ON e.uuid = le.etiqueta_uuid
      JOIN mis_libros l ON l.uuid = le.libro_uuid
      WHERE l.estado = 'terminado'
      ORDER BY le.libro_uuid, e.nombre COLLATE NOCASE`),
  ]);

  const paginas = numero(resumenSesiones?.paginas);
  const segundos = numero(resumenSesiones?.duracion_segundos);
  const paginasVelocidad = numero(velocidadRaw?.paginas);
  const segundosVelocidad = numero(velocidadRaw?.duracion_segundos);
  const velocidadPorHora = segundosVelocidad > 0 ? (paginasVelocidad * 3600) / segundosVelocidad : 0;
  const muestraSuficiente = numero(velocidadRaw?.sesiones) >= 2 && velocidadPorHora > 0;
  const totalResueltos = numero(estadoLibros?.terminados) + numero(estadoLibros?.abandonados);
  const deseosResueltos = numero(wishlistRaw?.adquiridos) + numero(wishlistRaw?.descartados);

  return {
    resumen: {
      desde: rango.desde,
      hasta: rango.hasta,
      paginas,
      duracion_segundos: segundos,
      minutos: Math.round(segundos / 60),
      sesiones: numero(resumenSesiones?.sesiones),
      dias_activos: numero(resumenSesiones?.dias_activos),
      libros_terminados: numero(librosTerminados?.cantidad),
      consistencia_7_dias: numero(consistenciaRaw?.dias_7) / 7,
      consistencia_30_dias: numero(consistenciaRaw?.dias_30) / 30,
      hora_habitual: horarioRaw?.hora ?? null,
      dia_semana_mas_lector: diaSemanaRaw?.dia_semana ?? null,
      sesion_promedio_segundos: Math.round(numero(resumenSesiones?.sesion_promedio_segundos)),
      sesion_promedio_paginas: numero(resumenSesiones?.sesion_promedio_paginas),
      tasa_finalizacion: totalResueltos > 0 ? numero(estadoLibros?.terminados) / totalResueltos : 0,
    },
    velocidad: {
      paginasPorHora: velocidadPorHora,
      muestraSuficiente,
      sesiones_consideradas: numero(velocidadRaw?.sesiones),
      tiempo_total_segundos: segundosVelocidad,
      paginas_muestra: paginasVelocidad,
      estimaciones_restantes: muestraSuficiente ? librosLeyendo.map((libro) => {
        const paginasRestantes = Math.max(0, numero(libro.paginas_totales) - numero(libro.pagina_actual));
        return {
          libro_uuid: libro.uuid,
          libro_id: libro.id,
          titulo: libro.titulo,
          paginas_restantes: paginasRestantes,
          segundos_estimados: velocidadPorHora > 0 ? Math.round((paginasRestantes / velocidadPorHora) * 3600) : null,
        };
      }) : [],
    },
    actividadDiaria: actividadDiaria.map((item) => ({
      fecha: item.fecha,
      sesiones: numero(item.sesiones),
      paginas: numero(item.paginas),
      duracion_segundos: numero(item.duracion_segundos),
    })),
    tendenciaMensual: mapearMeses(tendenciaDesde, 12, sesionesMensuales, terminadosMensuales),
    etiquetas: etiquetas.map((item) => ({ ...item, sesiones: numero(item.sesiones), paginas: numero(item.paginas), duracion_segundos: numero(item.duracion_segundos) })),
    librosDestacados: librosDestacados.map((item) => ({ ...item, sesiones: numero(item.sesiones), paginas: numero(item.paginas), duracion_segundos: numero(item.duracion_segundos) })),
    wishlist: {
      activos: numero(wishlistRaw?.activos),
      adquiridos: numero(wishlistRaw?.adquiridos),
      descartados: numero(wishlistRaw?.descartados),
      tasa_adquisicion: deseosResueltos > 0 ? numero(wishlistRaw?.adquiridos) / deseosResueltos : 0,
      segundos_promedio_hasta_adquirir: wishlistRaw?.segundos_hasta_adquirir == null
        ? null
        : Math.round(numero(wishlistRaw.segundos_hasta_adquirir)),
    },
    resumenesLectura: construirResumenesLectura(
      librosParaResumen,
      sesionesParaResumen,
      etiquetasParaResumen
    ),
  };
}

async function obtenerDashboardAnaliticoInterno(options = {}, retryCount = 0) {
  const rango = validarRango(options);
  const revisionsAtStart = getDatabaseRevisions();
  const cacheKey = `${rango.desde}|${rango.hasta}`;
  if (!options.force && cache?.key === cacheKey && mismasRevisiones(cache.revisions, revisionsAtStart)) return cache.value;

  const generation = ++requestGeneration;
  const db = await getDatabase();
  const snapshot = await ejecutarSnapshot(db, (connection) => consultarDashboard(connection, rango));
  const revisionsAtEnd = getDatabaseRevisions();
  const needsRecompute = !mismasRevisiones(revisionsAtStart, revisionsAtEnd);
  if (needsRecompute && retryCount < 1) {
    return obtenerDashboardAnaliticoInterno(options, retryCount + 1);
  }
  const value = {
    ...snapshot,
    _meta: {
      generation,
      revisions: revisionsAtEnd,
      needsRecompute,
      sesiones_excluidas_si_superan_segundos: MAX_SESSION_SECONDS,
      etiquetas_atribucion: 'Cada sesión aporta por completo a cada etiqueta del libro; los porcentajes no suman necesariamente 100%.',
    },
  };

  if (generation >= latestCompletedGeneration && !needsRecompute) {
    latestCompletedGeneration = generation;
    cache = { key: cacheKey, revisions: revisionsAtEnd, value };
  }
  return value;
}

export async function obtenerDashboardAnalitico(options = {}) {
  return obtenerDashboardAnaliticoInterno(options);
}

export async function obtenerPlanesDashboardAnalitico({ desde, hasta } = {}) {
  const rango = validarRango({ desde, hasta });
  const db = await getDatabase();
  return {
    resumen: await db.getAllAsync(`EXPLAIN QUERY PLAN
      SELECT SUM(paginas_leidas), SUM(duracion_segundos)
      FROM sesiones_lectura
      WHERE fecha BETWEEN ? AND ? AND ${VALID_SESSION_SQL}`, rango.desde, rango.hasta),
    etiquetas: await db.getAllAsync(`EXPLAIN QUERY PLAN
      SELECT e.uuid, SUM(s.paginas_leidas)
      FROM etiquetas e
      JOIN libro_etiquetas le ON le.etiqueta_uuid = e.uuid
      JOIN sesiones_lectura s ON s.libro_uuid = le.libro_uuid
      WHERE s.fecha BETWEEN ? AND ? AND s.hora_fin IS NOT NULL AND s.duracion_segundos > 0
      GROUP BY e.uuid`, rango.desde, rango.hasta),
  };
}

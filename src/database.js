import * as SQLite from 'expo-sqlite';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import {
  confirmarPortadaTemporal,
  eliminarPortadaLocal,
  esPortadaTemporal,
  optimizarYGuardarPortada,
} from './portadas';
import { obtenerVariantesISBN } from './services/isbnService';
import { bumpDatabaseRevisions } from './database/revisions';
import {
  IMPORT_MODES,
  importPreparedBackup,
  validateBackupDocument,
} from './services/backupImportService';
import {
  compartirDocumentoBackup,
  crearNombreArchivoBackup,
  guardarDocumentoBackup,
  serializarBackup,
  validarArchivoJSONSeleccionado,
} from './services/backupFileService';

const DATABASE_NAME = 'biblioteca.db';
const BACKUP_VERSION = 6;
const DATABASE_VERSION = 6;
const ESTADOS_VALIDOS = ['quiero leer', 'leyendo', 'terminado', 'abandonado'];

let databasePromise;

function crearUUID() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizarUUID(value) {
  const uuid = String(value || '').trim();
  return /^[a-zA-Z0-9-]{16,80}$/.test(uuid) ? uuid : null;
}

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME, {
      // Workaround para expo-sqlite 16 + FTS5: el cierre automático puede
      // intentar finalizar dos veces statements internos de FTS en Android.
      finalizeUnusedStatementsBeforeClosing: false,
    });
  }
  return databasePromise;
}

function normalizarISBN(isbn) {
  const normalizado = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalizado || null;
}

function enteroNoNegativo(value) {
  if (value === null || value === undefined || value === '') return null;
  const numero = Number(value);
  if (!Number.isInteger(numero) || numero < 0) return null;
  return numero;
}

function validarLibro(libro) {
  const titulo = libro?.titulo?.trim();
  if (!titulo) throw new Error('El título es obligatorio.');

  const paginasTotales = enteroNoNegativo(libro.paginas_totales);
  const paginaActualRaw = libro.pagina_actual ?? 0;
  const paginaActual = enteroNoNegativo(paginaActualRaw);
  if (libro.paginas_totales !== null && libro.paginas_totales !== undefined && paginasTotales === null) {
    throw new Error('Las páginas totales deben ser un entero mayor o igual a 0.');
  }
  if (paginaActual === null) throw new Error('La página actual debe ser un entero mayor o igual a 0.');
  if (paginasTotales !== null && paginaActual > paginasTotales) {
    throw new Error('La página actual no puede superar las páginas totales.');
  }

  const estado = libro.estado ?? 'quiero leer';
  if (!ESTADOS_VALIDOS.includes(estado)) {
    throw new Error('El estado del libro no es válido.');
  }
  const calificacion = libro.calificacion === null || libro.calificacion === undefined || libro.calificacion === ''
    ? null
    : Number(libro.calificacion);
  if (calificacion !== null && (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5)) {
    throw new Error('La calificación debe ser un entero entre 1 y 5.');
  }
  return {
    uuid: normalizarUUID(libro.uuid) || crearUUID(),
    isbn: normalizarISBN(libro.isbn),
    titulo,
    autor: libro.autor?.trim() || null,
    portada_url: libro.portada_url || null,
    paginas_totales: paginasTotales,
    pagina_actual: paginaActual,
    estado,
    calificacion,
    notas: libro.notas?.trim() || null,
  };
}

export async function inicializarBaseDeDatos() {
  const db = await getDatabase();
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const versionRow = await db.getFirstAsync('PRAGMA user_version');
  let version = Number(versionRow?.user_version) || 0;

  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS mis_libros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        isbn TEXT UNIQUE,
        titulo TEXT NOT NULL,
        autor TEXT,
        portada_url TEXT,
        paginas_totales INTEGER,
        pagina_actual INTEGER DEFAULT 0,
        estado TEXT DEFAULT 'quiero leer',
        calificacion INTEGER,
        notas TEXT,
        fecha_agregado DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_fin DATE
      );
      CREATE TABLE IF NOT EXISTS lista_compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        autor TEXT,
        prioridad TEXT NOT NULL DEFAULT 'media'
          CHECK (prioridad IN ('alta', 'media', 'baja')),
        precio_estimado REAL,
        fecha_agregado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      UPDATE mis_libros SET estado = 'terminado' WHERE estado IN ('leído', 'leido');
    `);
    try {
      await db.execAsync('ALTER TABLE mis_libros ADD COLUMN fecha_fin DATE;');
    } catch (error) {
      if (!String(error?.message).includes('duplicate column')) throw error;
    }
    await db.execAsync('PRAGMA user_version = 1;');
    version = 1;
  }

  if (version < 2) {
    for (const statement of [
      'ALTER TABLE mis_libros ADD COLUMN uuid TEXT',
      'ALTER TABLE lista_compras ADD COLUMN uuid TEXT',
    ]) {
      try {
        await db.execAsync(statement);
      } catch (error) {
        if (!String(error?.message).includes('duplicate column')) throw error;
      }
    }
    await db.execAsync(`
      UPDATE mis_libros
      SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))
      WHERE uuid IS NULL OR uuid = '';
      UPDATE lista_compras
      SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))
      WHERE uuid IS NULL OR uuid = '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mis_libros_uuid ON mis_libros(uuid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lista_compras_uuid ON lista_compras(uuid);
      CREATE INDEX IF NOT EXISTS idx_mis_libros_estado ON mis_libros(estado);
      CREATE INDEX IF NOT EXISTS idx_mis_libros_fecha_fin ON mis_libros(fecha_fin);
      PRAGMA user_version = 2;
    `);
    version = 2;
  }

  if (version < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS etiquetas (
        uuid TEXT PRIMARY KEY,
        nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
        fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS libro_etiquetas (
        libro_uuid TEXT NOT NULL,
        etiqueta_uuid TEXT NOT NULL,
        PRIMARY KEY (libro_uuid, etiqueta_uuid),
        FOREIGN KEY (libro_uuid) REFERENCES mis_libros(uuid) ON DELETE CASCADE,
        FOREIGN KEY (etiqueta_uuid) REFERENCES etiquetas(uuid) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_libro_etiquetas_etiqueta ON libro_etiquetas(etiqueta_uuid);
      CREATE VIRTUAL TABLE IF NOT EXISTS mis_libros_fts USING fts5(
        titulo,
        autor,
        content='mis_libros',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS mis_libros_fts_insert
      AFTER INSERT ON mis_libros BEGIN
        INSERT INTO mis_libros_fts(rowid, titulo, autor)
        VALUES (new.id, new.titulo, COALESCE(new.autor, ''));
      END;
      CREATE TRIGGER IF NOT EXISTS mis_libros_fts_delete
      AFTER DELETE ON mis_libros BEGIN
        INSERT INTO mis_libros_fts(mis_libros_fts, rowid, titulo, autor)
        VALUES ('delete', old.id, old.titulo, COALESCE(old.autor, ''));
      END;
      CREATE TRIGGER IF NOT EXISTS mis_libros_fts_update
      AFTER UPDATE OF titulo, autor ON mis_libros BEGIN
        INSERT INTO mis_libros_fts(mis_libros_fts, rowid, titulo, autor)
        VALUES ('delete', old.id, old.titulo, COALESCE(old.autor, ''));
        INSERT INTO mis_libros_fts(rowid, titulo, autor)
        VALUES (new.id, new.titulo, COALESCE(new.autor, ''));
      END;
      INSERT INTO mis_libros_fts(mis_libros_fts) VALUES ('rebuild');
      PRAGMA user_version = 3;
    `);
    version = 3;
  }

  if (version < 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sesiones_lectura (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        libro_uuid TEXT NOT NULL,
        fecha TEXT NOT NULL,
        hora_inicio TEXT NOT NULL,
        hora_fin TEXT,
        paginas_leidas INTEGER NOT NULL DEFAULT 0 CHECK (paginas_leidas >= 0),
        FOREIGN KEY (libro_uuid) REFERENCES mis_libros(uuid) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sesiones_fecha ON sesiones_lectura(fecha);
      CREATE INDEX IF NOT EXISTS idx_sesiones_libro ON sesiones_lectura(libro_uuid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sesion_activa_por_libro
      ON sesiones_lectura(libro_uuid) WHERE hora_fin IS NULL;
      PRAGMA user_version = 4;
    `);
    version = 4;
  }

  if (version < 5) {
    await db.execAsync(`
      DELETE FROM sesiones_lectura
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM sesiones_lectura
        GROUP BY libro_uuid, hora_inicio
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_libro_hora_inicio
      ON sesiones_lectura(libro_uuid, hora_inicio);
      PRAGMA user_version = 5;
    `);
    version = 5;
  }

  if (version < DATABASE_VERSION) {
    for (const statement of [
      'ALTER TABLE sesiones_lectura ADD COLUMN pagina_inicio INTEGER NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN pagina_fin INTEGER NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN duracion_segundos INTEGER NULL',
      "ALTER TABLE lista_compras ADD COLUMN estado TEXT NOT NULL DEFAULT 'activo'",
      'ALTER TABLE lista_compras ADD COLUMN fecha_resolucion TEXT NULL',
      'ALTER TABLE lista_compras ADD COLUMN libro_uuid_adquirido TEXT NULL',
    ]) {
      try {
        await db.execAsync(statement);
      } catch (error) {
        if (!String(error?.message).includes('duplicate column')) throw error;
      }
    }
    await db.execAsync(`
      UPDATE sesiones_lectura
      SET duracion_segundos = CAST(ROUND((julianday(hora_fin) - julianday(hora_inicio)) * 86400) AS INTEGER)
      WHERE hora_fin IS NOT NULL
        AND julianday(hora_inicio) IS NOT NULL
        AND julianday(hora_fin) IS NOT NULL
        AND julianday(hora_fin) >= julianday(hora_inicio)
        AND duracion_segundos IS NULL;
      UPDATE lista_compras
      SET estado = 'activo'
      WHERE estado IS NULL OR estado NOT IN ('activo', 'adquirido', 'descartado');
      CREATE INDEX IF NOT EXISTS idx_lista_compras_estado_fecha
      ON lista_compras(estado, fecha_agregado);
      PRAGMA user_version = ${DATABASE_VERSION};
    `);
  }
  return db;
}

/**
 * Descarga una portada al directorio persistente de documentos.
 * Si ya recibe una URI local, la conserva. Un fallo de descarga no impide
 * guardar el libro: en ese caso devuelve null.
 */
export async function descargarPortadaLocal(url, isbn = null) {
  void isbn;
  if (!url) return null;
  if (/portada_optimizada_[^/]+\.jpg$/i.test(url)) return url;
  if (esPortadaTemporal(url)) return confirmarPortadaTemporal(url).uri;
  try {
    const temporal = await optimizarYGuardarPortada(url, { temporal: true });
    return confirmarPortadaTemporal(temporal).uri;
  } catch (error) {
    console.warn('El libro se guardará sin portada porque no pudo persistirse.', error);
    return null;
  }
}

export async function insertarLibro(libro) {
  const datos = validarLibro(libro);
  const db = await getDatabase();
  const portadaOriginal = datos.portada_url;
  let portadaLocal = null;
  try {
    portadaLocal = await descargarPortadaLocal(portadaOriginal, datos.isbn);
    const result = await db.runAsync(
      `INSERT INTO mis_libros
        (uuid, isbn, titulo, autor, portada_url, paginas_totales, pagina_actual, estado, calificacion, notas, fecha_fin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'terminado' THEN CURRENT_DATE ELSE NULL END)`,
      datos.uuid,
      datos.isbn,
      datos.titulo,
      datos.autor,
      portadaLocal,
      datos.paginas_totales,
      datos.pagina_actual,
      datos.estado,
      datos.calificacion,
      datos.notas,
      datos.estado
    );
    bumpDatabaseRevisions('books');
    return result.lastInsertRowId;
  } catch (error) {
    if (portadaLocal && portadaLocal !== portadaOriginal) eliminarPortadaLocal(portadaLocal);
    throw error;
  }
}

export async function obtenerLibros() {
  const db = await getDatabase();
  return db.getAllAsync('SELECT * FROM mis_libros ORDER BY fecha_agregado DESC, id DESC');
}

function crearConsultaFTS(texto) {
  const terminos = String(texto || '')
    .trim()
    .split(/\s+/)
    .map((termino) => termino.replace(/["*:^(){}\[\]]/g, '').trim())
    .filter(Boolean);
  return terminos.map((termino) => `"${termino}"*`).join(' AND ');
}

export async function buscarLibros({ texto = '', etiquetaUuid = null } = {}) {
  const db = await getDatabase();
  const consultaFTS = crearConsultaFTS(texto);
  const joins = [];
  const condiciones = [];
  const parametros = [];

  if (consultaFTS) {
    joins.push('JOIN mis_libros_fts ON mis_libros_fts.rowid = l.id');
    condiciones.push('mis_libros_fts MATCH ?');
    parametros.push(consultaFTS);
  }
  if (etiquetaUuid) {
    joins.push('JOIN libro_etiquetas le ON le.libro_uuid = l.uuid');
    condiciones.push('le.etiqueta_uuid = ?');
    parametros.push(String(etiquetaUuid));
  }

  return db.getAllAsync(
    `SELECT DISTINCT l.*
     FROM mis_libros l
     ${joins.join('\n')}
     ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
     ORDER BY l.fecha_agregado DESC, l.id DESC`,
    parametros
  );
}

export async function obtenerEtiquetas() {
  const db = await getDatabase();
  return db.getAllAsync(`
    SELECT e.uuid, e.nombre, COUNT(le.libro_uuid) AS cantidad
    FROM etiquetas e
    LEFT JOIN libro_etiquetas le ON le.etiqueta_uuid = e.uuid
    GROUP BY e.uuid, e.nombre
    ORDER BY e.nombre COLLATE NOCASE ASC
  `);
}

export async function obtenerEtiquetasDeLibro(libroUuid) {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT e.uuid, e.nombre
     FROM etiquetas e
     JOIN libro_etiquetas le ON le.etiqueta_uuid = e.uuid
     WHERE le.libro_uuid = ?
     ORDER BY e.nombre COLLATE NOCASE ASC`,
    String(libroUuid)
  );
}

export async function crearEtiqueta(nombre) {
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) throw new Error('El nombre de la etiqueta es obligatorio.');
  const db = await getDatabase();
  const uuid = crearUUID();
  const result = await db.runAsync(
    `INSERT INTO etiquetas (uuid, nombre) VALUES (?, ?)
     ON CONFLICT(nombre) DO NOTHING`,
    uuid,
    nombreLimpio
  );
  const etiqueta = await db.getFirstAsync('SELECT uuid, nombre FROM etiquetas WHERE nombre = ? COLLATE NOCASE', nombreLimpio);
  if (result.changes) bumpDatabaseRevisions('tags');
  return etiqueta;
}

export async function asignarEtiquetaALibro(libroUuid, etiquetaUuid) {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO libro_etiquetas (libro_uuid, etiqueta_uuid)
     VALUES (?, ?)
     ON CONFLICT(libro_uuid, etiqueta_uuid) DO NOTHING`,
    String(libroUuid),
    String(etiquetaUuid)
  );
  if (result.changes) bumpDatabaseRevisions('tags');
  return result.changes;
}

export async function quitarEtiquetaDelLibro(libroUuid, etiquetaUuid) {
  const db = await getDatabase();
  const result = await db.runAsync(
    'DELETE FROM libro_etiquetas WHERE libro_uuid = ? AND etiqueta_uuid = ?',
    String(libroUuid),
    String(etiquetaUuid)
  );
  if (result.changes) bumpDatabaseRevisions('tags');
  return result.changes;
}

export async function obtenerLibroPorId(id) {
  const db = await getDatabase();
  return db.getFirstAsync('SELECT * FROM mis_libros WHERE id = ?', Number(id));
}

export async function obtenerLibroPorISBN(isbn) {
  const variantes = obtenerVariantesISBN(isbn);
  if (!variantes.length) return null;
  const db = await getDatabase();
  const placeholders = variantes.map(() => '?').join(', ');
  return db.getFirstAsync(
    `SELECT * FROM mis_libros WHERE isbn IN (${placeholders}) LIMIT 1`,
    variantes
  );
}

export async function actualizarLibro(id, cambios) {
  const existente = await obtenerLibroPorId(id);
  if (!existente) throw new Error('El libro no existe.');

  const datos = validarLibro({ ...existente, ...cambios });
  let portadaLocal = datos.portada_url;
  const portadaOriginal = portadaLocal;
  const requiereConfirmacion = esPortadaTemporal(portadaLocal)
    || (portadaLocal && !/^(file|content):\/\//i.test(portadaLocal));
  if (requiereConfirmacion) portadaLocal = await descargarPortadaLocal(portadaLocal, datos.isbn);

  const db = await getDatabase();
  let result;
  try {
    result = await db.runAsync(
    `UPDATE mis_libros SET
      uuid = ?, isbn = ?, titulo = ?, autor = ?, portada_url = ?, paginas_totales = ?,
      pagina_actual = ?, estado = ?, calificacion = ?, notas = ?,
      fecha_fin = CASE
        WHEN ? = 'terminado' AND estado <> 'terminado' THEN CURRENT_DATE
        ELSE fecha_fin
      END
     WHERE id = ?`,
    datos.uuid,
    datos.isbn,
    datos.titulo,
    datos.autor,
    portadaLocal,
    datos.paginas_totales,
    datos.pagina_actual,
    datos.estado,
    datos.calificacion,
    datos.notas,
    datos.estado,
    Number(id)
    );
  } catch (error) {
    if (portadaLocal && portadaLocal !== portadaOriginal && portadaLocal !== existente.portada_url) {
      eliminarPortadaLocal(portadaLocal);
    }
    throw error;
  }
  if (!result.changes) throw new Error('No se pudo actualizar el libro.');
  if (existente.portada_url && existente.portada_url !== portadaLocal) {
    eliminarPortadaLocal(existente.portada_url);
  }
  bumpDatabaseRevisions('books');
  return result.changes;
}

export async function actualizarProgreso(id, paginaActual, estado = null) {
  const existente = await obtenerLibroPorId(id);
  if (!existente) throw new Error('El libro no existe.');
  return actualizarLibro(id, {
    pagina_actual: paginaActual,
    estado: estado || existente.estado,
  });
}

export async function eliminarLibro(id) {
  const db = await getDatabase();
  const libro = await obtenerLibroPorId(id);
  const result = await db.runAsync('DELETE FROM mis_libros WHERE id = ?', Number(id));

  if (result.changes && libro?.portada_url?.startsWith('file://')) {
    try {
      const portada = new File(libro.portada_url);
      if (portada.exists) portada.delete();
    } catch (error) {
      console.warn('El libro se eliminó, pero no se pudo borrar su portada local.', error);
    }
  }
  if (result.changes) bumpDatabaseRevisions('books', 'sessions', 'tags');
  return result.changes;
}

export async function obtenerEstadisticas() {
  const db = await getDatabase();
  return db.getFirstAsync(`
    SELECT
      COUNT(*) AS total_libros,
      COALESCE(SUM(CASE WHEN estado = 'terminado' THEN 1 ELSE 0 END), 0) AS libros_leidos,
      COALESCE(SUM(CASE WHEN estado = 'leyendo' THEN 1 ELSE 0 END), 0) AS libros_leyendo,
      COALESCE(SUM(CASE WHEN estado = 'quiero leer' THEN 1 ELSE 0 END), 0) AS libros_pendientes,
      COALESCE(SUM(CASE WHEN estado = 'abandonado' THEN 1 ELSE 0 END), 0) AS libros_abandonados,
      COALESCE(SUM(pagina_actual), 0) AS paginas_leidas,
      ROUND(AVG(CASE WHEN calificacion IS NOT NULL THEN calificacion END), 1) AS calificacion_promedio
    FROM mis_libros
  `);
}

function fechaLocalISO(fecha = new Date()) {
  const offset = fecha.getTimezoneOffset() * 60000;
  return new Date(fecha.getTime() - offset).toISOString().slice(0, 10);
}

function calcularRacha(fechas, hoy = fechaLocalISO()) {
  const dias = new Set(fechas.filter(Boolean));
  const cursor = new Date(`${hoy}T12:00:00`);
  if (!dias.has(hoy)) cursor.setDate(cursor.getDate() - 1);
  let racha = 0;
  while (dias.has(fechaLocalISO(cursor))) {
    racha += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return racha;
}

export async function obtenerSesionActiva(libroUuid) {
  const db = await getDatabase();
  return db.getFirstAsync(
    `SELECT id, libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas,
            pagina_inicio, pagina_fin, duracion_segundos
     FROM sesiones_lectura
     WHERE libro_uuid = ? AND hora_fin IS NULL
     ORDER BY id DESC LIMIT 1`,
    String(libroUuid)
  );
}

export async function iniciarSesionLectura(libroUuid, paginaInicial = 0) {
  const pagina = enteroNoNegativo(paginaInicial);
  if (!libroUuid) throw new Error('El libro no es válido.');
  if (pagina === null) throw new Error('La página inicial no es válida.');
  const db = await getDatabase();
  const ahora = new Date();
  try {
    const result = await db.runAsync(
      `INSERT INTO sesiones_lectura
        (libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas, pagina_inicio, pagina_fin, duracion_segundos)
       VALUES (?, ?, ?, NULL, 0, ?, NULL, NULL)`,
      String(libroUuid),
      fechaLocalISO(ahora),
      ahora.toISOString(),
      pagina
    );
    const sesion = await db.getFirstAsync('SELECT * FROM sesiones_lectura WHERE id = ?', result.lastInsertRowId);
    bumpDatabaseRevisions('sessions');
    return sesion;
  } catch (error) {
    if (String(error?.message).includes('UNIQUE')) {
      throw new Error('Ya existe una sesión activa para este libro.');
    }
    throw error;
  }
}

export async function terminarSesionLectura(libroUuid, paginaActual) {
  const pagina = enteroNoNegativo(paginaActual);
  if (pagina === null) throw new Error('La página actual no es válida.');
  const db = await getDatabase();
  let resultado = null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const libro = await transaction.getFirstAsync(
      'SELECT id, uuid, paginas_totales, pagina_actual FROM mis_libros WHERE uuid = ?',
      String(libroUuid)
    );
    if (!libro) throw new Error('El libro no existe.');
    if (libro.paginas_totales !== null && pagina > Number(libro.paginas_totales)) {
      throw new Error('La página actual no puede superar las páginas totales.');
    }
    const sesion = await transaction.getFirstAsync(
      `SELECT * FROM sesiones_lectura
       WHERE libro_uuid = ? AND hora_fin IS NULL
       ORDER BY id DESC LIMIT 1`,
      String(libroUuid)
    );
    if (!sesion) throw new Error('No hay una sesión activa para terminar.');
    const paginaInicial = enteroNoNegativo(sesion.pagina_inicio ?? sesion.paginas_leidas);
    if (paginaInicial === null) throw new Error('La sesión no contiene una página inicial válida.');
    if (pagina < paginaInicial) {
      throw new Error('La página actual no puede ser menor que la página donde comenzó la sesión.');
    }
    const horaFin = new Date().toISOString();
    const inicioMs = Date.parse(sesion.hora_inicio);
    const finMs = Date.parse(horaFin);
    if (!Number.isFinite(inicioMs) || !Number.isFinite(finMs) || finMs < inicioMs) {
      throw new Error('La duración de la sesión no es válida.');
    }
    const duracionSegundos = Math.round((finMs - inicioMs) / 1000);
    const paginasLeidas = pagina - paginaInicial;
    const cierre = await transaction.runAsync(
      `UPDATE sesiones_lectura
       SET hora_fin = ?, paginas_leidas = ?, pagina_inicio = COALESCE(pagina_inicio, ?),
           pagina_fin = ?, duracion_segundos = ?
       WHERE id = ? AND hora_fin IS NULL`,
      horaFin,
      paginasLeidas,
      paginaInicial,
      pagina,
      duracionSegundos,
      sesion.id
    );
    if (!cierre.changes) throw new Error('La sesión ya había sido finalizada.');
    const progreso = await transaction.runAsync(
      'UPDATE mis_libros SET pagina_actual = ? WHERE uuid = ?',
      pagina,
      String(libroUuid)
    );
    if (!progreso.changes) throw new Error('No se pudo actualizar el progreso del libro.');
    resultado = {
      ...sesion,
      hora_fin: horaFin,
      paginas_leidas: paginasLeidas,
      pagina_inicio: paginaInicial,
      pagina_fin: pagina,
      duracion_segundos: duracionSegundos,
      minutos: Math.max(1, Math.round(duracionSegundos / 60)),
    };
  });
  bumpDatabaseRevisions('sessions', 'books');
  return resultado;
}

export async function obtenerCronicas() {
  const db = await getDatabase();
  const metricas = await db.getFirstAsync(`
    SELECT
      COALESCE(SUM(CASE WHEN estado = 'terminado' THEN 1 ELSE 0 END), 0) AS terminados,
      COALESCE(SUM(pagina_actual), 0) AS paginas_acumuladas,
      COALESCE(SUM(CASE WHEN estado = 'abandonado' THEN 1 ELSE 0 END), 0) AS abandonados
    FROM mis_libros
  `);
  const historial = await db.getAllAsync(`
    SELECT id, titulo, autor, portada_url, fecha_fin
    FROM mis_libros
    WHERE estado = 'terminado'
    ORDER BY fecha_fin IS NULL ASC, fecha_fin DESC, id DESC
  `);
  const mesActual = fechaLocalISO().slice(0, 7);
  const sesionesMes = await db.getFirstAsync(`
    SELECT
      COALESCE(SUM(paginas_leidas), 0) AS paginas_mes,
      COALESCE(ROUND(SUM((julianday(hora_fin) - julianday(hora_inicio)) * 1440)), 0) AS minutos_mes
    FROM sesiones_lectura
    WHERE hora_fin IS NOT NULL AND substr(fecha, 1, 7) = ?
  `, mesActual);
  const diasLectura = await db.getAllAsync(`
    SELECT DISTINCT fecha
    FROM sesiones_lectura
    WHERE hora_fin IS NOT NULL
    ORDER BY fecha DESC
  `);
  return {
    metricas: {
      ...metricas,
      paginas_mes: Number(sesionesMes?.paginas_mes) || 0,
      minutos_mes: Number(sesionesMes?.minutos_mes) || 0,
      racha_dias: calcularRacha(diasLectura.map((item) => item.fecha)),
    },
    historial,
  };
}

export async function getDeseos() {
  const db = await getDatabase();
  return db.getAllAsync(`
    SELECT id, uuid, titulo, autor, prioridad, precio_estimado, fecha_agregado,
           estado, fecha_resolucion, libro_uuid_adquirido
    FROM lista_compras
    WHERE estado = 'activo'
    ORDER BY
      CASE prioridad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
      datetime(fecha_agregado) DESC,
      id DESC
  `);
}

export async function addDeseo({ titulo, autor = null, prioridad = 'media', precio_estimado = null }) {
  const tituloLimpio = String(titulo || '').trim();
  const autorLimpio = String(autor || '').trim() || null;
  const prioridades = ['alta', 'media', 'baja'];
  if (!tituloLimpio) throw new Error('El título es obligatorio.');
  if (!prioridades.includes(prioridad)) throw new Error('La prioridad no es válida.');

  let precio = null;
  if (precio_estimado !== null && precio_estimado !== undefined && precio_estimado !== '') {
    precio = Number(precio_estimado);
    if (!Number.isFinite(precio) || precio < 0) {
      throw new Error('El precio estimado debe ser un número mayor o igual a cero.');
    }
  }

  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO lista_compras (uuid, titulo, autor, prioridad, precio_estimado, fecha_agregado)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    crearUUID(),
    tituloLimpio,
    autorLimpio,
    prioridad,
    precio
  );
  bumpDatabaseRevisions('wishlist');
  return result.lastInsertRowId;
}

export async function deleteDeseo(id) {
  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE lista_compras
     SET estado = 'descartado', fecha_resolucion = ?, libro_uuid_adquirido = NULL
     WHERE id = ? AND estado = 'activo'`,
    new Date().toISOString(),
    Number(id)
  );
  if (result.changes) bumpDatabaseRevisions('wishlist');
  return result.changes;
}

export async function marcarComoAdquirido(idDeseo, titulo = null, autor = null) {
  const id = Number(idDeseo);
  if (!Number.isInteger(id) || id <= 0) throw new Error('El deseo no es válido.');

  const db = await getDatabase();
  let nuevoLibroId = null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const deseo = await transaction.getFirstAsync(
      'SELECT uuid, titulo, autor, estado FROM lista_compras WHERE id = ?',
      id
    );
    if (!deseo || deseo.estado !== 'activo') throw new Error('El libro ya no está activo en la lista de deseos.');

    const tituloFinal = String(deseo.titulo || titulo || '').trim();
    const autorFinal = String(deseo.autor || autor || '').trim() || null;
    if (!tituloFinal) throw new Error('El título es obligatorio.');

    const libroUuid = crearUUID();
    const insert = await transaction.runAsync(
      `INSERT INTO mis_libros
        (uuid, isbn, titulo, autor, portada_url, paginas_totales, pagina_actual, estado, calificacion, notas)
       VALUES (?, NULL, ?, ?, NULL, NULL, 0, 'quiero leer', NULL, NULL)`,
      libroUuid,
      tituloFinal,
      autorFinal
    );
    const resolucion = await transaction.runAsync(
      `UPDATE lista_compras
       SET estado = 'adquirido', fecha_resolucion = ?, libro_uuid_adquirido = ?
       WHERE id = ? AND estado = 'activo'`,
      new Date().toISOString(),
      libroUuid,
      id
    );
    if (!resolucion.changes) throw new Error('El deseo ya había sido resuelto.');
    nuevoLibroId = insert.lastInsertRowId;
  });
  bumpDatabaseRevisions('wishlist', 'books');
  return nuevoLibroId;
}

async function serializarLibroParaBackup(libro) {
  let portadaBase64 = null;
  if (libro.portada_url?.startsWith('file://')) {
    try {
      const portada = new File(libro.portada_url);
      if (portada.exists) portadaBase64 = await portada.base64();
    } catch (error) {
      console.warn(`No se pudo incluir la portada del libro ${libro.id} en el backup.`, error);
    }
  }
  return { ...libro, portada_base64: portadaBase64 };
}

export async function crearDocumentoBackupJSON(fecha = new Date()) {
  const db = await getDatabase();
  let snapshot;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    snapshot = {
      libros: await transaction.getAllAsync('SELECT * FROM mis_libros ORDER BY fecha_agregado DESC, id DESC'),
      lista_compras: await transaction.getAllAsync('SELECT * FROM lista_compras ORDER BY id'),
      etiquetas: await transaction.getAllAsync('SELECT * FROM etiquetas ORDER BY nombre COLLATE NOCASE'),
      libro_etiquetas: await transaction.getAllAsync('SELECT * FROM libro_etiquetas ORDER BY libro_uuid, etiqueta_uuid'),
      sesiones_lectura: await transaction.getAllAsync('SELECT * FROM sesiones_lectura ORDER BY id'),
    };
  });
  const librosConPortada = [];
  for (const libro of snapshot.libros) {
    librosConPortada.push(await serializarLibroParaBackup(libro));
  }
  const backup = {
    tipo: 'mi-biblioteca-backup',
    version: BACKUP_VERSION,
    fecha_exportacion: fecha.toISOString(),
    libros: librosConPortada,
    lista_compras: snapshot.lista_compras,
    etiquetas: snapshot.etiquetas,
    libro_etiquetas: snapshot.libro_etiquetas,
    sesiones_lectura: snapshot.sesiones_lectura,
  };

  return {
    backup,
    contenido: serializarBackup(backup),
    nombre: crearNombreArchivoBackup(fecha),
  };
}

export async function guardarBackupJSON() {
  return guardarDocumentoBackup(await crearDocumentoBackupJSON());
}

export async function compartirBackupJSON() {
  return compartirDocumentoBackup(await crearDocumentoBackupJSON());
}

// Alias conservado para llamadas anteriores. Guardar físicamente es una
// acción independiente de compartir una copia temporal.
export async function exportarBackupJSON() {
  return compartirBackupJSON();
}


export async function seleccionarBackupParaImportar() {
  const seleccion = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (seleccion.canceled) return { cancelado: true };

  const asset = validarArchivoJSONSeleccionado(seleccion.assets?.[0]);
  const archivo = new File(asset);
  const contenido = await archivo.text();
  let documento;
  try {
    documento = JSON.parse(contenido);
  } catch {
    throw new Error('El archivo seleccionado no contiene un JSON válido.');
  }
  const { backup, summary } = validateBackupDocument(documento);
  return { cancelado: false, backup, resumen: summary };
}

export async function ejecutarImportacionBackup(
  backup,
  { modo = IMPORT_MODES.MERGE, confirmadoReemplazo = false } = {}
) {
  const db = await getDatabase();
  const resultado = await importPreparedBackup({
    db,
    document: backup,
    mode: modo,
    replaceConfirmed: confirmadoReemplazo,
  });
  bumpDatabaseRevisions('books', 'sessions', 'tags', 'wishlist');
  return {
    ...resultado,
    cancelado: false,
    importados: resultado.libros.creados + resultado.libros.actualizados,
    deseos_importados: resultado.lista_compras.creados + resultado.lista_compras.actualizados,
    etiquetas_importadas: resultado.etiquetas.creados + resultado.etiquetas.actualizados,
    sesiones_importadas: resultado.sesiones_lectura.creados + resultado.sesiones_lectura.actualizados,
  };
}

export async function importarBackupJSON(options = {}) {
  const seleccion = await seleccionarBackupParaImportar();
  if (seleccion.cancelado) return { cancelado: true, importados: 0 };
  return ejecutarImportacionBackup(seleccion.backup, options);
}

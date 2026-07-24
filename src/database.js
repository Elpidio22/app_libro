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
import {
  calculateReadPages,
  elapsedSessionSeconds,
  normalizeLocalTime,
  normalizeLocalDate,
  SESSION_STATES,
  validateDurationSeconds,
  validateReadingDates,
} from './services/readingSessionService';

const DATABASE_NAME = 'biblioteca.db';
const BACKUP_VERSION = 7;
const DATABASE_VERSION = 8;
const ESTADOS_VALIDOS = ['quiero leer', 'leyendo', 'terminado', 'abandonado'];
const ESTADOS_DESEO_VALIDOS = ['activo', 'adquirido', 'descartado'];
const ESTADOS_SESION_VALIDOS = Object.values(SESSION_STATES);
const ORIGENES_SESION_VALIDOS = ['cronometro', 'manual'];

let databasePromise;

function crearUUID() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function crearSesionUUID() {
  return `ses-${crearUUID()}`;
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
  const fechas = validateReadingDates(libro.fecha_inicio_lectura, libro.fecha_fin);
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
    fecha_inicio_lectura: fechas.start,
    fecha_fin: fechas.finish,
  };
}

async function ejecutarCheckpointMigracion(options, name, context) {
  if (typeof options?.onMigrationCheckpoint === 'function') {
    await options.onMigrationCheckpoint(name, context);
  }
}

function listaSQL(valores) {
  return valores.map((valor) => `'${String(valor).replace(/'/g, "''")}'`).join(', ');
}

async function asegurarSinFilas(db, sql, mensaje) {
  const row = await db.getFirstAsync(sql);
  if (Number(row?.total) > 0) throw new Error(mensaje);
}

async function validarDatosParaEsquemaV8(db) {
  const mensajes = {
    librosUuid: 'La base contiene libros con identificadores invÃ¡lidos. No se aplicÃ³ la migraciÃ³n del esquema.',
    librosEstado: 'La base contiene libros con estados invÃ¡lidos. No se aplicÃ³ la migraciÃ³n del esquema.',
    librosDuplicados: 'La base contiene libros duplicados por identificador. No se aplicÃ³ la migraciÃ³n del esquema.',
    deseosUuid: 'La lista de deseos contiene identificadores invÃ¡lidos. No se aplicÃ³ la migraciÃ³n del esquema.',
    deseosEstado: 'La lista de deseos contiene estados invÃ¡lidos. No se aplicÃ³ la migraciÃ³n del esquema.',
    deseosDuplicados: 'La lista de deseos contiene duplicados por identificador. No se aplicÃ³ la migraciÃ³n del esquema.',
    etiquetasUuid: 'La base contiene etiquetas con identificadores invÃ¡lidos. No se aplicÃ³ la migraciÃ³n del esquema.',
    etiquetasNombre: 'La base contiene etiquetas sin nombre. No se aplicÃ³ la migraciÃ³n del esquema.',
    sesionesUuid: 'La base contiene sesiones con identificadores invÃ¡lidos. No se aplicÃ³ la migraciÃ³n del esquema.',
    sesionesEstado: 'La base contiene sesiones con estados invÃ¡lidos. No se aplicÃ³ la migraciÃ³n del esquema.',
    sesionesOrigen: 'La base contiene sesiones con origen invÃ¡lido. No se aplicÃ³ la migraciÃ³n del esquema.',
    sesionesLibro: 'La base contiene sesiones huÃ©rfanas. No se aplicÃ³ la migraciÃ³n del esquema.',
    relaciones: 'La base contiene relaciones de etiquetas huÃ©rfanas. No se aplicÃ³ la migraciÃ³n del esquema.',
    sesionesDuplicadas: 'La base contiene sesiones duplicadas por identificador. No se aplicÃ³ la migraciÃ³n del esquema.',
  };
  await asegurarSinFilas(db, "SELECT COUNT(*) AS total FROM mis_libros WHERE uuid IS NULL OR trim(uuid) = ''", mensajes.librosUuid);
  await asegurarSinFilas(db, `SELECT COUNT(*) AS total FROM mis_libros WHERE estado IS NULL OR estado NOT IN (${listaSQL(ESTADOS_VALIDOS)})`, mensajes.librosEstado);
  await asegurarSinFilas(db, `SELECT COUNT(*) AS total FROM (SELECT uuid FROM mis_libros GROUP BY uuid HAVING COUNT(*) > 1)`, mensajes.librosDuplicados);
  await asegurarSinFilas(db, "SELECT COUNT(*) AS total FROM lista_compras WHERE uuid IS NULL OR trim(uuid) = ''", mensajes.deseosUuid);
  await asegurarSinFilas(db, `SELECT COUNT(*) AS total FROM lista_compras WHERE estado IS NULL OR estado NOT IN (${listaSQL(ESTADOS_DESEO_VALIDOS)})`, mensajes.deseosEstado);
  await asegurarSinFilas(db, `SELECT COUNT(*) AS total FROM (SELECT uuid FROM lista_compras GROUP BY uuid HAVING COUNT(*) > 1)`, mensajes.deseosDuplicados);
  await asegurarSinFilas(db, "SELECT COUNT(*) AS total FROM etiquetas WHERE uuid IS NULL OR trim(uuid) = ''", mensajes.etiquetasUuid);
  await asegurarSinFilas(db, "SELECT COUNT(*) AS total FROM etiquetas WHERE nombre IS NULL OR trim(nombre) = ''", mensajes.etiquetasNombre);
  await asegurarSinFilas(db, "SELECT COUNT(*) AS total FROM sesiones_lectura WHERE uuid IS NULL OR trim(uuid) = ''", mensajes.sesionesUuid);
  await asegurarSinFilas(db, `SELECT COUNT(*) AS total FROM sesiones_lectura WHERE estado IS NULL OR estado NOT IN (${listaSQL(ESTADOS_SESION_VALIDOS)})`, mensajes.sesionesEstado);
  await asegurarSinFilas(db, `SELECT COUNT(*) AS total FROM sesiones_lectura WHERE origen IS NULL OR origen NOT IN (${listaSQL(ORIGENES_SESION_VALIDOS)})`, mensajes.sesionesOrigen);
  await asegurarSinFilas(db, "SELECT COUNT(*) AS total FROM sesiones_lectura s LEFT JOIN mis_libros l ON l.uuid = s.libro_uuid WHERE s.libro_uuid IS NULL OR trim(s.libro_uuid) = '' OR l.uuid IS NULL", mensajes.sesionesLibro);
  await asegurarSinFilas(db, `SELECT COUNT(*) AS total FROM (SELECT uuid FROM sesiones_lectura GROUP BY uuid HAVING COUNT(*) > 1)`, mensajes.sesionesDuplicadas);
  await asegurarSinFilas(db, `
    SELECT COUNT(*) AS total
    FROM libro_etiquetas le
    LEFT JOIN mis_libros l ON l.uuid = le.libro_uuid
    LEFT JOIN etiquetas e ON e.uuid = le.etiqueta_uuid
    WHERE le.libro_uuid IS NULL OR trim(le.libro_uuid) = ''
       OR le.etiqueta_uuid IS NULL OR trim(le.etiqueta_uuid) = ''
       OR l.uuid IS NULL OR e.uuid IS NULL
  `, mensajes.relaciones);
}

async function reconstruirEsquemaV8(db) {
  await db.execAsync(`
    DROP TRIGGER IF EXISTS mis_libros_fts_insert;
    DROP TRIGGER IF EXISTS mis_libros_fts_delete;
    DROP TRIGGER IF EXISTS mis_libros_fts_update;
    DROP TABLE IF EXISTS mis_libros_fts;

    CREATE TABLE mis_libros_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn TEXT UNIQUE,
      titulo TEXT NOT NULL CHECK (length(trim(titulo)) > 0),
      autor TEXT,
      portada_url TEXT,
      paginas_totales INTEGER CHECK (paginas_totales IS NULL OR paginas_totales >= 0),
      pagina_actual INTEGER NOT NULL DEFAULT 0 CHECK (pagina_actual >= 0),
      estado TEXT NOT NULL DEFAULT 'quiero leer'
        CHECK (estado IN ('quiero leer', 'leyendo', 'terminado', 'abandonado')),
      calificacion INTEGER CHECK (calificacion IS NULL OR calificacion BETWEEN 1 AND 5),
      notas TEXT,
      fecha_agregado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_fin DATE,
      uuid TEXT NOT NULL UNIQUE CHECK (length(trim(uuid)) > 0),
      fecha_inicio_lectura TEXT NULL
    );

    CREATE TABLE lista_compras_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL CHECK (length(trim(titulo)) > 0),
      autor TEXT,
      prioridad TEXT NOT NULL DEFAULT 'media'
        CHECK (prioridad IN ('alta', 'media', 'baja')),
      precio_estimado REAL,
      fecha_agregado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      uuid TEXT NOT NULL UNIQUE CHECK (length(trim(uuid)) > 0),
      estado TEXT NOT NULL DEFAULT 'activo'
        CHECK (estado IN ('activo', 'adquirido', 'descartado')),
      fecha_resolucion TEXT NULL,
      libro_uuid_adquirido TEXT NULL
    );

    CREATE TABLE etiquetas_v8 (
      uuid TEXT NOT NULL PRIMARY KEY CHECK (length(trim(uuid)) > 0),
      nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0) COLLATE NOCASE UNIQUE,
      fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE libro_etiquetas_v8 (
      libro_uuid TEXT NOT NULL CHECK (length(trim(libro_uuid)) > 0),
      etiqueta_uuid TEXT NOT NULL CHECK (length(trim(etiqueta_uuid)) > 0),
      PRIMARY KEY (libro_uuid, etiqueta_uuid),
      FOREIGN KEY (libro_uuid) REFERENCES mis_libros_v8(uuid) ON DELETE CASCADE,
      FOREIGN KEY (etiqueta_uuid) REFERENCES etiquetas_v8(uuid) ON DELETE CASCADE
    );

    CREATE TABLE sesiones_lectura_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      libro_uuid TEXT NOT NULL CHECK (length(trim(libro_uuid)) > 0),
      fecha TEXT NOT NULL CHECK (length(trim(fecha)) > 0),
      hora_inicio TEXT NOT NULL CHECK (length(trim(hora_inicio)) > 0),
      hora_fin TEXT,
      paginas_leidas INTEGER NOT NULL DEFAULT 0 CHECK (paginas_leidas >= 0),
      pagina_inicio INTEGER NULL CHECK (pagina_inicio IS NULL OR pagina_inicio >= 0),
      pagina_fin INTEGER NULL CHECK (pagina_fin IS NULL OR pagina_fin >= 0),
      duracion_segundos INTEGER NULL CHECK (duracion_segundos IS NULL OR duracion_segundos >= 0),
      uuid TEXT NOT NULL UNIQUE CHECK (length(trim(uuid)) > 0),
      estado TEXT NOT NULL DEFAULT 'completada'
        CHECK (estado IN ('activa', 'pendiente', 'completada')),
      origen TEXT NOT NULL DEFAULT 'cronometro'
        CHECK (origen IN ('cronometro', 'manual')),
      nota TEXT NULL,
      duracion_acumulada_segundos INTEGER NOT NULL DEFAULT 0 CHECK (duracion_acumulada_segundos >= 0),
      ultimo_inicio TEXT NULL,
      pausada_en TEXT NULL,
      fecha_creacion TEXT NULL,
      fecha_actualizacion TEXT NULL,
      editada INTEGER NOT NULL DEFAULT 0 CHECK (editada IN (0, 1)),
      FOREIGN KEY (libro_uuid) REFERENCES mis_libros_v8(uuid) ON DELETE CASCADE
    );

    INSERT INTO mis_libros_v8
      (id, isbn, titulo, autor, portada_url, paginas_totales, pagina_actual, estado,
       calificacion, notas, fecha_agregado, fecha_fin, uuid, fecha_inicio_lectura)
    SELECT id, isbn, titulo, autor, portada_url, paginas_totales, COALESCE(pagina_actual, 0),
       estado, calificacion, notas, COALESCE(fecha_agregado, CURRENT_TIMESTAMP),
       fecha_fin, uuid, fecha_inicio_lectura
    FROM mis_libros;

    INSERT INTO lista_compras_v8
      (id, titulo, autor, prioridad, precio_estimado, fecha_agregado, uuid, estado,
       fecha_resolucion, libro_uuid_adquirido)
    SELECT id, titulo, autor, prioridad, precio_estimado, COALESCE(fecha_agregado, CURRENT_TIMESTAMP),
       uuid, estado, fecha_resolucion, libro_uuid_adquirido
    FROM lista_compras;

    INSERT INTO etiquetas_v8 (uuid, nombre, fecha_creacion)
    SELECT uuid, nombre, COALESCE(fecha_creacion, CURRENT_TIMESTAMP)
    FROM etiquetas;

    INSERT INTO libro_etiquetas_v8 (libro_uuid, etiqueta_uuid)
    SELECT libro_uuid, etiqueta_uuid
    FROM libro_etiquetas;

    INSERT INTO sesiones_lectura_v8
      (id, libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas, pagina_inicio,
       pagina_fin, duracion_segundos, uuid, estado, origen, nota,
       duracion_acumulada_segundos, ultimo_inicio, pausada_en, fecha_creacion,
       fecha_actualizacion, editada)
    SELECT id, libro_uuid, fecha, hora_inicio, hora_fin, COALESCE(paginas_leidas, 0),
       pagina_inicio, pagina_fin, duracion_segundos, uuid, estado, origen, nota,
       COALESCE(duracion_acumulada_segundos, 0), ultimo_inicio, pausada_en,
       fecha_creacion, fecha_actualizacion, COALESCE(editada, 0)
    FROM sesiones_lectura;

    DROP TABLE libro_etiquetas;
    DROP TABLE sesiones_lectura;
    DROP TABLE etiquetas;
    DROP TABLE lista_compras;
    DROP TABLE mis_libros;

    ALTER TABLE mis_libros_v8 RENAME TO mis_libros;
    ALTER TABLE lista_compras_v8 RENAME TO lista_compras;
    ALTER TABLE etiquetas_v8 RENAME TO etiquetas;
    ALTER TABLE libro_etiquetas_v8 RENAME TO libro_etiquetas;
    ALTER TABLE sesiones_lectura_v8 RENAME TO sesiones_lectura;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mis_libros_uuid ON mis_libros(uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lista_compras_uuid ON lista_compras(uuid);
    CREATE INDEX IF NOT EXISTS idx_mis_libros_estado ON mis_libros(estado);
    CREATE INDEX IF NOT EXISTS idx_mis_libros_fecha_fin ON mis_libros(fecha_fin);
    CREATE INDEX IF NOT EXISTS idx_libro_etiquetas_etiqueta ON libro_etiquetas(etiqueta_uuid);
    CREATE INDEX IF NOT EXISTS idx_sesiones_fecha ON sesiones_lectura(fecha);
    CREATE INDEX IF NOT EXISTS idx_sesiones_libro ON sesiones_lectura(libro_uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sesion_activa_por_libro
      ON sesiones_lectura(libro_uuid) WHERE estado = 'activa';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_libro_hora_inicio
      ON sesiones_lectura(libro_uuid, hora_inicio);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_uuid ON sesiones_lectura(uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sesion_activa_global
      ON sesiones_lectura(estado) WHERE estado = 'activa';
    CREATE INDEX IF NOT EXISTS idx_sesiones_libro_estado_fecha
      ON sesiones_lectura(libro_uuid, estado, fecha DESC);
    CREATE INDEX IF NOT EXISTS idx_lista_compras_estado_fecha
      ON lista_compras(estado, fecha_agregado);

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
  `);
}

export async function inicializarBaseDeDatos(options = {}) {
  const db = await getDatabase();
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const versionRow = await db.getFirstAsync('PRAGMA user_version');
  const versionInicial = Number(versionRow?.user_version) || 0;
  if (versionInicial >= DATABASE_VERSION) return db;

  await db.withExclusiveTransactionAsync(async (migrationDb) => {
  let version = versionInicial;

  if (version < 1) {
    await migrationDb.execAsync(`
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
      await migrationDb.execAsync('ALTER TABLE mis_libros ADD COLUMN fecha_fin DATE;');
    } catch (error) {
      if (!String(error?.message).includes('duplicate column')) throw error;
    }
    version = 1;
    await ejecutarCheckpointMigracion(options, 'after-v1', { version });
  }

  if (version < 2) {
    for (const statement of [
      'ALTER TABLE mis_libros ADD COLUMN uuid TEXT',
      'ALTER TABLE lista_compras ADD COLUMN uuid TEXT',
    ]) {
      try {
        await migrationDb.execAsync(statement);
      } catch (error) {
        if (!String(error?.message).includes('duplicate column')) throw error;
      }
    }
    await migrationDb.execAsync(`
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
    `);
    version = 2;
    await ejecutarCheckpointMigracion(options, 'after-v2', { version });
  }

  if (version < 3) {
    await migrationDb.execAsync(`
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
    `);
    version = 3;
    await ejecutarCheckpointMigracion(options, 'after-v3', { version });
  }

  if (version < 4) {
    await migrationDb.execAsync(`
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
    `);
    version = 4;
    await ejecutarCheckpointMigracion(options, 'after-v4', { version });
  }

  if (version < 5) {
    await migrationDb.execAsync(`
      DELETE FROM sesiones_lectura
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM sesiones_lectura
        GROUP BY libro_uuid, hora_inicio
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_libro_hora_inicio
      ON sesiones_lectura(libro_uuid, hora_inicio);
    `);
    version = 5;
    await ejecutarCheckpointMigracion(options, 'after-v5', { version });
  }

  if (version < 6) {
    for (const statement of [
      'ALTER TABLE sesiones_lectura ADD COLUMN pagina_inicio INTEGER NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN pagina_fin INTEGER NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN duracion_segundos INTEGER NULL',
      "ALTER TABLE lista_compras ADD COLUMN estado TEXT NOT NULL DEFAULT 'activo'",
      'ALTER TABLE lista_compras ADD COLUMN fecha_resolucion TEXT NULL',
      'ALTER TABLE lista_compras ADD COLUMN libro_uuid_adquirido TEXT NULL',
    ]) {
      try {
        await migrationDb.execAsync(statement);
      } catch (error) {
        if (!String(error?.message).includes('duplicate column')) throw error;
      }
    }
    await migrationDb.execAsync(`
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
    `);
    version = 6;
    await ejecutarCheckpointMigracion(options, 'after-v6', { version });
  }

  if (version < 7) {
    const bookTable = await migrationDb.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mis_libros'"
    );
    const statements = [
      'ALTER TABLE sesiones_lectura ADD COLUMN uuid TEXT NULL',
      "ALTER TABLE sesiones_lectura ADD COLUMN estado TEXT NOT NULL DEFAULT 'completada'",
      "ALTER TABLE sesiones_lectura ADD COLUMN origen TEXT NOT NULL DEFAULT 'cronometro'",
      'ALTER TABLE sesiones_lectura ADD COLUMN nota TEXT NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN duracion_acumulada_segundos INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE sesiones_lectura ADD COLUMN ultimo_inicio TEXT NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN pausada_en TEXT NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN fecha_creacion TEXT NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN fecha_actualizacion TEXT NULL',
      'ALTER TABLE sesiones_lectura ADD COLUMN editada INTEGER NOT NULL DEFAULT 0',
    ];
    if (bookTable) statements.unshift('ALTER TABLE mis_libros ADD COLUMN fecha_inicio_lectura TEXT NULL');
    for (const statement of statements) {
      try {
        await migrationDb.execAsync(statement);
      } catch (error) {
        if (!String(error?.message).includes('duplicate column')) throw error;
      }
    }
    await migrationDb.execAsync(`
      UPDATE sesiones_lectura
      SET uuid = 'ses-' || lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
                 lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))
      WHERE uuid IS NULL OR uuid = '';
      UPDATE sesiones_lectura
      SET estado = CASE
        WHEN hora_fin IS NULL THEN 'activa'
        WHEN pagina_fin IS NULL AND COALESCE(paginas_leidas, 0) = 0 THEN 'pendiente'
        ELSE 'completada'
      END,
      origen = COALESCE(NULLIF(origen, ''), 'cronometro'),
      duracion_acumulada_segundos = CASE
        WHEN hora_fin IS NULL THEN COALESCE(duracion_acumulada_segundos, 0)
        ELSE COALESCE(duracion_segundos, duracion_acumulada_segundos, 0)
      END,
      ultimo_inicio = CASE WHEN hora_fin IS NULL THEN COALESCE(ultimo_inicio, hora_inicio) ELSE NULL END,
      fecha_creacion = COALESCE(fecha_creacion, hora_inicio),
      fecha_actualizacion = COALESCE(fecha_actualizacion, hora_fin, hora_inicio);
      UPDATE sesiones_lectura
      SET estado = 'pendiente',
          hora_fin = COALESCE(hora_fin, fecha_actualizacion, hora_inicio),
          duracion_segundos = MAX(1, COALESCE(duracion_segundos, duracion_acumulada_segundos, 1)),
          duracion_acumulada_segundos = MAX(1, COALESCE(duracion_acumulada_segundos, duracion_segundos, 1)),
          pagina_fin = NULL,
          paginas_leidas = 0,
          ultimo_inicio = NULL,
          pausada_en = NULL,
          fecha_actualizacion = COALESCE(fecha_actualizacion, hora_inicio)
      WHERE estado = 'activa'
        AND id <> (
          SELECT id FROM sesiones_lectura
          WHERE estado = 'activa'
          ORDER BY hora_inicio DESC, id DESC
          LIMIT 1
        );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_uuid ON sesiones_lectura(uuid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sesion_activa_global
      ON sesiones_lectura(estado) WHERE estado = 'activa';
      CREATE INDEX IF NOT EXISTS idx_sesiones_libro_estado_fecha
      ON sesiones_lectura(libro_uuid, estado, fecha DESC);
    `);
    version = 7;
    await ejecutarCheckpointMigracion(options, 'after-v7', { version });
  }

  if (version < 8) {
    await validarDatosParaEsquemaV8(migrationDb);
    await reconstruirEsquemaV8(migrationDb);
    version = 8;
    await ejecutarCheckpointMigracion(options, 'after-v8', { version });
  }

  await ejecutarCheckpointMigracion(options, 'before-user-version', { version });
  await migrationDb.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
  });
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
  const fechaInicio = datos.fecha_inicio_lectura || (datos.estado === 'leyendo' ? fechaLocalISO() : null);
  const fechaFin = datos.fecha_fin || (datos.estado === 'terminado' ? fechaLocalISO() : null);
  const db = await getDatabase();
  const portadaOriginal = datos.portada_url;
  let portadaLocal = null;
  try {
    portadaLocal = await descargarPortadaLocal(portadaOriginal, datos.isbn);
    const result = await db.runAsync(
      `INSERT INTO mis_libros
        (uuid, isbn, titulo, autor, portada_url, paginas_totales, pagina_actual, estado,
         calificacion, notas, fecha_inicio_lectura, fecha_fin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      fechaInicio,
      fechaFin
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
  const cambioAInicio = existente.estado !== 'leyendo' && datos.estado === 'leyendo';
  const cambioAFin = existente.estado !== 'terminado' && datos.estado === 'terminado';
  const fechaInicio = Object.hasOwn(cambios, 'fecha_inicio_lectura')
    ? datos.fecha_inicio_lectura
    : (existente.fecha_inicio_lectura || (cambioAInicio ? fechaLocalISO() : null));
  const fechaFin = Object.hasOwn(cambios, 'fecha_fin')
    ? datos.fecha_fin
    : (cambioAFin ? fechaLocalISO() : existente.fecha_fin);
  validateReadingDates(fechaInicio, fechaFin);
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
      fecha_inicio_lectura = ?, fecha_fin = ?
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
    fechaInicio,
    fechaFin,
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

export async function obtenerSesionActiva(libroUuid = null) {
  const db = await getDatabase();
  const whereBook = libroUuid ? 'AND libro_uuid = ?' : '';
  return db.getFirstAsync(
    `SELECT * FROM sesiones_lectura
     WHERE estado = 'activa' ${whereBook}
     ORDER BY id DESC LIMIT 1`,
    ...(libroUuid ? [String(libroUuid)] : [])
  );
}

export async function obtenerSesionActivaConLibro() {
  const db = await getDatabase();
  return db.getFirstAsync(`
    SELECT s.*, l.id AS libro_id, l.titulo AS libro_titulo, l.autor AS libro_autor
    FROM sesiones_lectura s
    JOIN mis_libros l ON l.uuid = s.libro_uuid
    WHERE s.estado = 'activa'
    ORDER BY s.id DESC
    LIMIT 1
  `);
}

export async function obtenerSesionesDeLibro(libroUuid) {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT * FROM sesiones_lectura WHERE libro_uuid = ?
     ORDER BY fecha DESC, hora_inicio DESC, id DESC`,
    String(libroUuid)
  );
}

export async function iniciarSesionLectura(libroUuid, paginaInicial = 0) {
  const pagina = enteroNoNegativo(paginaInicial);
  if (!libroUuid) throw new Error('El libro no es válido.');
  if (pagina === null) throw new Error('La página inicial no es válida.');
  const db = await getDatabase();
  const ahora = new Date();
  let sesion;
  try {
    await db.withExclusiveTransactionAsync(async (tx) => {
      const libro = await tx.getFirstAsync('SELECT * FROM mis_libros WHERE uuid = ?', String(libroUuid));
      if (!libro) throw new Error('El libro no existe.');
      if (libro.paginas_totales !== null && pagina > Number(libro.paginas_totales)) {
        throw new Error('La página inicial no puede superar el total del libro.');
      }
      const activa = await tx.getFirstAsync("SELECT id FROM sesiones_lectura WHERE estado = 'activa' LIMIT 1");
      if (activa) throw new Error('Ya existe una sesión activa. Termínala o descártala antes de iniciar otra.');
      const iso = ahora.toISOString();
      const fecha = fechaLocalISO(ahora);
      const result = await tx.runAsync(
        `INSERT INTO sesiones_lectura
          (uuid, libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas, pagina_inicio,
           pagina_fin, duracion_segundos, estado, origen, nota, duracion_acumulada_segundos,
           ultimo_inicio, pausada_en, fecha_creacion, fecha_actualizacion, editada)
         VALUES (?, ?, ?, ?, NULL, 0, ?, NULL, NULL, 'activa', 'cronometro', NULL, 0, ?, NULL, ?, ?, 0)`,
        crearSesionUUID(), String(libroUuid), fecha, iso, pagina, iso, iso, iso
      );
      if (!libro.fecha_inicio_lectura) {
        await tx.runAsync(
          "UPDATE mis_libros SET fecha_inicio_lectura = ?, estado = CASE WHEN estado = 'quiero leer' THEN 'leyendo' ELSE estado END WHERE uuid = ?",
          fecha, String(libroUuid)
        );
      }
      sesion = await tx.getFirstAsync('SELECT * FROM sesiones_lectura WHERE id = ?', result.lastInsertRowId);
    });
  } catch (error) {
    if (String(error?.message).includes('UNIQUE')) throw new Error('Ya existe una sesión activa.');
    throw error;
  }
  bumpDatabaseRevisions('sessions', 'books');
  return sesion;
}

export async function pausarSesionLectura(libroUuid, { emitirRevision = true } = {}) {
  const db = await getDatabase();
  const ahora = new Date();
  let resultado;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const sesion = await tx.getFirstAsync(
      "SELECT * FROM sesiones_lectura WHERE libro_uuid = ? AND estado = 'activa'",
      String(libroUuid)
    );
    if (!sesion) throw new Error('No hay una sesión activa para detener.');
    if (sesion.pausada_en) {
      resultado = sesion;
      return;
    }
    const ultimoInicio = Date.parse(sesion.ultimo_inicio || sesion.hora_inicio);
    if (!Number.isFinite(ultimoInicio) || ahora.getTime() < ultimoInicio) {
      throw new Error('La duración de la sesión no es válida.');
    }
    const duracion = Math.max(1, elapsedSessionSeconds(sesion, ahora));
    const iso = ahora.toISOString();
    const update = await tx.runAsync(
      `UPDATE sesiones_lectura SET duracion_acumulada_segundos = ?, duracion_segundos = ?,
       pausada_en = ?, fecha_actualizacion = ? WHERE id = ? AND pausada_en IS NULL AND estado = 'activa'`,
      duracion, duracion, iso, iso, sesion.id
    );
    if (!update.changes) throw new Error('La sesión ya había sido detenida.');
    resultado = { ...sesion, duracion_acumulada_segundos: duracion, duracion_segundos: duracion, pausada_en: iso };
  });
  if (emitirRevision) bumpDatabaseRevisions('sessions');
  return resultado;
}

export async function reanudarSesionLectura(libroUuid) {
  const db = await getDatabase();
  const iso = new Date().toISOString();
  const result = await db.runAsync(
    `UPDATE sesiones_lectura SET pausada_en = NULL, ultimo_inicio = ?, fecha_actualizacion = ?
     WHERE libro_uuid = ? AND estado = 'activa' AND pausada_en IS NOT NULL`,
    iso, iso, String(libroUuid)
  );
  if (!result.changes) throw new Error('No hay una sesión detenida para continuar.');
  bumpDatabaseRevisions('sessions');
  return obtenerSesionActiva(libroUuid);
}

async function cerrarSesionActiva(libroUuid, { paginaFinal = null, nota = null, pendiente = false } = {}) {
  const db = await getDatabase();
  let resultado;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const libro = await tx.getFirstAsync('SELECT * FROM mis_libros WHERE uuid = ?', String(libroUuid));
    const sesion = await tx.getFirstAsync(
      "SELECT * FROM sesiones_lectura WHERE libro_uuid = ? AND estado = 'activa'",
      String(libroUuid)
    );
    if (!libro || !sesion) throw new Error('No hay una sesión activa para guardar.');
    const ahora = new Date();
    const duracion = validateDurationSeconds(Math.max(1, elapsedSessionSeconds(sesion, ahora)));
    const iso = ahora.toISOString();
    let paginas = 0;
    if (!pendiente) paginas = calculateReadPages(sesion.pagina_inicio, paginaFinal, libro.paginas_totales);
    const estado = pendiente ? SESSION_STATES.PENDING : SESSION_STATES.COMPLETED;
    const update = await tx.runAsync(
      `UPDATE sesiones_lectura SET hora_fin = ?, duracion_segundos = ?,
       duracion_acumulada_segundos = ?, pagina_fin = ?, paginas_leidas = ?, estado = ?,
       nota = ?, ultimo_inicio = NULL, pausada_en = NULL, fecha_actualizacion = ?
       WHERE id = ? AND estado = 'activa'`,
      iso, duracion, duracion, pendiente ? null : Number(paginaFinal), paginas, estado,
      String(nota || '').trim() || null, iso, sesion.id
    );
    if (!update.changes) throw new Error('La sesión ya había sido guardada.');
    if (!pendiente) {
      await tx.runAsync(
        'UPDATE mis_libros SET pagina_actual = MAX(pagina_actual, ?) WHERE uuid = ?',
        Number(paginaFinal), String(libroUuid)
      );
    }
    resultado = {
      ...sesion, hora_fin: iso, duracion_segundos: duracion, pagina_fin: pendiente ? null : Number(paginaFinal),
      paginas_leidas: paginas, estado, nota: String(nota || '').trim() || null,
      minutos: Math.max(1, Math.round(duracion / 60)),
    };
  });
  bumpDatabaseRevisions('sessions', 'books');
  return resultado;
}

export function guardarSesionActiva(libroUuid, paginaFinal, nota = null) {
  return cerrarSesionActiva(libroUuid, { paginaFinal, nota, pendiente: false });
}

export function completarSesionDespues(libroUuid, nota = null) {
  return cerrarSesionActiva(libroUuid, { nota, pendiente: true });
}

export async function completarSesionPendiente(id, { paginaInicio, paginaFinal, nota = null }) {
  const db = await getDatabase();
  let resultado;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const sesion = await tx.getFirstAsync("SELECT * FROM sesiones_lectura WHERE id = ? AND estado = 'pendiente'", Number(id));
    if (!sesion) throw new Error('La sesión pendiente ya fue completada o no existe.');
    const libro = await tx.getFirstAsync('SELECT * FROM mis_libros WHERE uuid = ?', sesion.libro_uuid);
    const paginas = calculateReadPages(paginaInicio, paginaFinal, libro?.paginas_totales);
    const iso = new Date().toISOString();
    const update = await tx.runAsync(
      `UPDATE sesiones_lectura SET pagina_inicio = ?, pagina_fin = ?, paginas_leidas = ?,
       estado = 'completada', nota = ?, fecha_actualizacion = ?, editada = 1
       WHERE id = ? AND estado = 'pendiente'`,
      Number(paginaInicio), Number(paginaFinal), paginas, String(nota || '').trim() || null, iso, Number(id)
    );
    if (!update.changes) throw new Error('La sesión ya había sido completada.');
    await tx.runAsync('UPDATE mis_libros SET pagina_actual = MAX(pagina_actual, ?) WHERE uuid = ?', Number(paginaFinal), sesion.libro_uuid);
    resultado = { ...sesion, pagina_inicio: Number(paginaInicio), pagina_fin: Number(paginaFinal), paginas_leidas: paginas, estado: 'completada' };
  });
  bumpDatabaseRevisions('sessions', 'books');
  return resultado;
}

export async function agregarSesionManual(libroUuid, {
  fecha, hora = null, duracionSegundos, paginaInicio, paginaFinal, nota = null, actualizarFechaInicio = false,
}) {
  const fechaNormal = normalizeLocalDate(fecha);
  if (!fechaNormal) throw new Error('La fecha de la sesión no es válida.');
  if (fechaNormal > fechaLocalISO()) throw new Error('La fecha de la sesión no puede estar en el futuro.');
  const ahoraManual = new Date();
  const horaNormal = hora ? normalizeLocalTime(hora) : ahoraManual.toTimeString().slice(0, 5);
  if (!horaNormal) throw new Error('La hora de la sesión no es válida.');
  const duracion = validateDurationSeconds(duracionSegundos);
  const db = await getDatabase();
  let resultado;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const libro = await tx.getFirstAsync('SELECT * FROM mis_libros WHERE uuid = ?', String(libroUuid));
    if (!libro) throw new Error('El libro no existe.');
    const paginas = calculateReadPages(paginaInicio, paginaFinal, libro.paginas_totales);
    const segundosUnicos = `${String(ahoraManual.getSeconds()).padStart(2, '0')}.${String(ahoraManual.getMilliseconds()).padStart(3, '0')}`;
    const inicioLocal = new Date(`${fechaNormal}T${horaNormal}:${segundosUnicos}`);
    if (!Number.isFinite(inicioLocal.getTime())) throw new Error('La hora de la sesión no es válida.');
    const horaInicio = inicioLocal.toISOString();
    const horaFin = new Date(Date.parse(horaInicio) + duracion * 1000).toISOString();
    const now = new Date().toISOString();
    const result = await tx.runAsync(
      `INSERT INTO sesiones_lectura
       (uuid, libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas, pagina_inicio,
        pagina_fin, duracion_segundos, estado, origen, nota, duracion_acumulada_segundos,
        ultimo_inicio, pausada_en, fecha_creacion, fecha_actualizacion, editada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completada', 'manual', ?, ?, NULL, NULL, ?, ?, 0)`,
      crearSesionUUID(), String(libroUuid), fechaNormal, horaInicio, horaFin, paginas,
      Number(paginaInicio), Number(paginaFinal), duracion, String(nota || '').trim() || null,
      duracion, now, now
    );
    await tx.runAsync('UPDATE mis_libros SET pagina_actual = MAX(pagina_actual, ?) WHERE uuid = ?', Number(paginaFinal), String(libroUuid));
    if (!libro.fecha_inicio_lectura || (actualizarFechaInicio && fechaNormal < libro.fecha_inicio_lectura)) {
      await tx.runAsync('UPDATE mis_libros SET fecha_inicio_lectura = ? WHERE uuid = ?', fechaNormal, String(libroUuid));
    }
    resultado = await tx.getFirstAsync('SELECT * FROM sesiones_lectura WHERE id = ?', result.lastInsertRowId);
  });
  bumpDatabaseRevisions('sessions', 'books');
  return resultado;
}

export async function editarSesionLectura(id, {
  fecha, hora = null, duracionSegundos, paginaInicio = null, paginaFinal = null,
  nota = null, estado = SESSION_STATES.COMPLETED,
}) {
  const fechaNormal = normalizeLocalDate(fecha);
  if (!fechaNormal || fechaNormal > fechaLocalISO()) throw new Error('La fecha de la sesión no es válida.');
  const duracion = validateDurationSeconds(duracionSegundos);
  const db = await getDatabase();
  let resultado;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const sesion = await tx.getFirstAsync('SELECT * FROM sesiones_lectura WHERE id = ?', Number(id));
    if (!sesion || sesion.estado === SESSION_STATES.ACTIVE) throw new Error('La sesión no puede editarse mientras está activa.');
    const libro = await tx.getFirstAsync('SELECT * FROM mis_libros WHERE uuid = ?', sesion.libro_uuid);
    const pendiente = estado === SESSION_STATES.PENDING;
    const paginas = pendiente ? 0 : calculateReadPages(paginaInicio, paginaFinal, libro?.paginas_totales);
    let horaInicio = sesion.hora_inicio;
    if (hora) {
      const horaNormal = normalizeLocalTime(hora);
      if (!horaNormal) throw new Error('La hora de la sesión no es válida.');
      const inicioLocal = new Date(`${fechaNormal}T${horaNormal}:00`);
      if (!Number.isFinite(inicioLocal.getTime())) throw new Error('La hora de la sesión no es válida.');
      horaInicio = inicioLocal.toISOString();
    } else if (fechaNormal !== sesion.fecha) {
      const original = new Date(sesion.hora_inicio);
      const horaLocal = `${String(original.getHours()).padStart(2, '0')}:${String(original.getMinutes()).padStart(2, '0')}`;
      horaInicio = new Date(`${fechaNormal}T${horaLocal}:00`).toISOString();
    }
    const horaFin = new Date(Date.parse(horaInicio) + duracion * 1000).toISOString();
    await tx.runAsync(
      `UPDATE sesiones_lectura SET fecha = ?, hora_inicio = ?, hora_fin = ?, duracion_segundos = ?,
       duracion_acumulada_segundos = ?, pagina_inicio = ?, pagina_fin = ?, paginas_leidas = ?,
       estado = ?, nota = ?, fecha_actualizacion = ?, editada = 1 WHERE id = ?`,
      fechaNormal, horaInicio, horaFin, duracion, duracion,
      paginaInicio === null ? null : Number(paginaInicio), pendiente ? null : Number(paginaFinal),
      paginas, pendiente ? SESSION_STATES.PENDING : SESSION_STATES.COMPLETED,
      String(nota || '').trim() || null, new Date().toISOString(), Number(id)
    );
    if (!pendiente) {
      await tx.runAsync('UPDATE mis_libros SET pagina_actual = MAX(pagina_actual, ?) WHERE uuid = ?', Number(paginaFinal), sesion.libro_uuid);
    }
    resultado = await tx.getFirstAsync('SELECT * FROM sesiones_lectura WHERE id = ?', Number(id));
  });
  bumpDatabaseRevisions('sessions', 'books');
  return resultado;
}

export async function eliminarSesionLectura(id) {
  const db = await getDatabase();
  const sesion = await db.getFirstAsync('SELECT * FROM sesiones_lectura WHERE id = ?', Number(id));
  if (!sesion) return 0;
  if (sesion.estado === SESSION_STATES.ACTIVE) throw new Error('Descarta la sesión activa desde su control de lectura.');
  const result = await db.runAsync('DELETE FROM sesiones_lectura WHERE id = ?', Number(id));
  // El progreso no se reduce: puede haber sesiones posteriores o una corrección manual.
  if (result.changes) bumpDatabaseRevisions('sessions', 'books');
  return result.changes;
}

export async function descartarSesionActiva(libroUuid) {
  const db = await getDatabase();
  const result = await db.runAsync(
    "DELETE FROM sesiones_lectura WHERE libro_uuid = ? AND estado = 'activa'",
    String(libroUuid)
  );
  if (result.changes) bumpDatabaseRevisions('sessions');
  return result.changes;
}

// Compatibilidad con llamadas anteriores: cierra la sesión en un único paso.
export async function terminarSesionLectura(libroUuid, paginaActual) {
  const db = await getDatabase();
  const sesion = await obtenerSesionActiva(libroUuid);
  const libro = await db.getFirstAsync('SELECT paginas_totales FROM mis_libros WHERE uuid = ?', String(libroUuid));
  if (!sesion || !libro) throw new Error('No hay una sesión activa para terminar.');
  calculateReadPages(sesion.pagina_inicio, paginaActual, libro.paginas_totales);
  const ultimoInicio = Date.parse(sesion.ultimo_inicio || sesion.hora_inicio);
  if (!Number.isFinite(ultimoInicio) || Date.now() < ultimoInicio) {
    throw new Error('La duración de la sesión no es válida.');
  }
  await pausarSesionLectura(libroUuid, { emitirRevision: false });
  return guardarSesionActiva(libroUuid, paginaActual);
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

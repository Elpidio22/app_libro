import {
  confirmarPortadaTemporal,
  eliminarPortadaLocal,
  optimizarYGuardarPortada,
} from '../portadas';
import { obtenerVariantesISBN } from './isbnService';

export const BACKUP_TYPE = 'mi-biblioteca-backup';
// La versión 5 es el formato portable objetivo. Se conservan las versiones
// históricas que la aplicación ya podía restaurar y la versión 6 que exporta
// actualmente, sin aceptar formatos futuros de forma implícita.
export const SUPPORTED_BACKUP_VERSIONS = Object.freeze([2, 3, 4, 5, 6]);
export const IMPORT_MODES = Object.freeze({ MERGE: 'fusionar', REPLACE: 'reemplazar' });

const COLLECTIONS = Object.freeze([
  'libros',
  'lista_compras',
  'etiquetas',
  'libro_etiquetas',
  'sesiones_lectura',
]);
const BOOK_STATES = new Set(['quiero leer', 'leyendo', 'terminado', 'abandonado']);
const HISTORICAL_STATES = Object.freeze({ leído: 'terminado', leido: 'terminado' });

function cleanText(value) {
  return String(value ?? '').trim();
}

export function normalizeTextKey(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es');
}

export function normalizeBackupISBN(value) {
  const normalized = cleanText(value).replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized || null;
}

export function normalizeBackupUUID(value) {
  const uuid = cleanText(value);
  return /^[a-zA-Z0-9-]{16,80}$/.test(uuid) ? uuid : null;
}

function positiveIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : NaN;
}

function nonNegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : NaN;
}

function deterministicUUID(prefix, ...parts) {
  const seed = parts.map(normalizeTextKey).join('|');
  let hashA = 2166136261;
  let hashB = 2246822519;
  for (let index = 0; index < seed.length; index += 1) {
    hashA = Math.imul(hashA ^ seed.charCodeAt(index), 16777619);
    hashB = Math.imul(hashB ^ seed.charCodeAt(index), 3266489917);
  }
  return `${prefix}-${(hashA >>> 0).toString(16).padStart(8, '0')}-${(hashB >>> 0).toString(16).padStart(8, '0')}`;
}

function mapBookState(value) {
  const state = normalizeTextKey(value || 'quiero leer');
  const mapped = HISTORICAL_STATES[state] || state;
  return BOOK_STATES.has(mapped) ? mapped : null;
}

function reliableISBNVariants(isbn) {
  return isbn ? obtenerVariantesISBN(isbn) : [];
}

function titleAuthorKey(record) {
  return `${normalizeTextKey(record?.titulo)}|${normalizeTextKey(record?.autor)}`;
}

function isRemoteCover(value) {
  return /^https?:\/\//i.test(cleanText(value));
}

export function detectBase64Image(value) {
  const unpadded = cleanText(value).replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!unpadded || !/^[A-Za-z0-9+/]+={0,2}$/.test(unpadded) || unpadded.length % 4 === 1) return null;
  const raw = unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), '=');
  if (raw.startsWith('/9j/')) return { base64: raw, mimeType: 'image/jpeg', extension: 'jpg' };
  if (raw.startsWith('iVBORw0KGgo')) return { base64: raw, mimeType: 'image/png', extension: 'png' };
  if (raw.startsWith('UklGR')) return { base64: raw, mimeType: 'image/webp', extension: 'webp' };
  return null;
}

export async function writeBackupCover(base64Value) {
  const image = detectBase64Image(base64Value);
  if (!image) throw new Error('La portada Base64 no contiene una imagen JPEG, PNG o WebP válida.');
  const temporary = await optimizarYGuardarPortada(
    `data:${image.mimeType};base64,${image.base64}`,
    { temporal: true }
  );
  return confirmarPortadaTemporal(temporary).uri;
}

export function validateBackupDocument(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('El archivo no contiene un objeto JSON válido.');
  }
  if (input.tipo !== BACKUP_TYPE) throw new Error('El archivo no es un respaldo de Mi Biblioteca.');
  const version = Number(input.version);
  if (!SUPPORTED_BACKUP_VERSIONS.includes(version)) {
    if (Number.isFinite(version) && version > Math.max(...SUPPORTED_BACKUP_VERSIONS)) {
      throw new Error(`El respaldo versión ${version} fue creado por una versión más nueva de la aplicación.`);
    }
    throw new Error(`La versión ${input.version ?? 'desconocida'} del respaldo no es compatible.`);
  }
  const backup = { ...input, version };
  for (const collection of COLLECTIONS) {
    if (backup[collection] === undefined || backup[collection] === null) {
      backup[collection] = [];
    } else if (!Array.isArray(backup[collection])) {
      throw new Error(`La colección ${collection} debe ser un array.`);
    }
  }
  return {
    backup,
    summary: {
      version,
      fecha_exportacion: cleanText(backup.fecha_exportacion) || null,
      libros: backup.libros.length,
      lista_compras: backup.lista_compras.length,
      etiquetas: backup.etiquetas.length,
      libro_etiquetas: backup.libro_etiquetas.length,
      sesiones_lectura: backup.sesiones_lectura.length,
    },
  };
}

function sanitizeBook(record, index) {
  const titulo = cleanText(record?.titulo);
  if (!titulo) throw new Error(`Libro ${index + 1}: el título es obligatorio.`);
  const paginasTotales = positiveIntegerOrNull(record.paginas_totales);
  if (Number.isNaN(paginasTotales)) throw new Error(`Libro "${titulo}": páginas totales inválidas.`);
  const paginaActual = nonNegativeIntegerOrNull(record.pagina_actual ?? 0);
  if (Number.isNaN(paginaActual)) throw new Error(`Libro "${titulo}": progreso inválido.`);
  if (paginasTotales !== null && paginaActual > paginasTotales) {
    throw new Error(`Libro "${titulo}": el progreso supera las páginas totales.`);
  }
  const estado = mapBookState(record.estado);
  if (!estado) throw new Error(`Libro "${titulo}": estado no reconocido.`);
  const rating = nonNegativeIntegerOrNull(record.calificacion);
  if (Number.isNaN(rating) || (rating !== null && (rating < 1 || rating > 5))) {
    throw new Error(`Libro "${titulo}": calificación inválida.`);
  }
  const isbn = normalizeBackupISBN(record.isbn);
  const variants = reliableISBNVariants(isbn);
  return {
    oldId: record.id === null || record.id === undefined ? null : String(record.id),
    importedUuid: normalizeBackupUUID(record.uuid),
    isbn,
    reliableIsbn: variants.length > 0,
    isbnVariants: variants,
    titulo,
    autor: cleanText(record.autor) || null,
    portada_base64: cleanText(record.portada_base64) || null,
    portada_remota: isRemoteCover(record.portada_url) ? cleanText(record.portada_url) : null,
    paginas_totales: paginasTotales,
    pagina_actual: paginaActual ?? 0,
    estado,
    calificacion: rating,
    notas: cleanText(record.notas) || null,
    fecha_agregado: cleanText(record.fecha_agregado) || new Date().toISOString(),
    fecha_fin: cleanText(record.fecha_fin) || null,
  };
}

function sanitizeWishlist(record, index) {
  const titulo = cleanText(record?.titulo);
  if (!titulo) throw new Error(`Deseo ${index + 1}: el título es obligatorio.`);
  const price = record.precio_estimado === null || record.precio_estimado === undefined || record.precio_estimado === ''
    ? null
    : Number(record.precio_estimado);
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error(`Deseo "${titulo}": precio inválido.`);
  const state = ['activo', 'adquirido', 'descartado'].includes(record.estado) ? record.estado : 'activo';
  return {
    oldId: record.id === null || record.id === undefined ? null : String(record.id),
    importedUuid: normalizeBackupUUID(record.uuid),
    titulo,
    autor: cleanText(record.autor) || null,
    prioridad: ['alta', 'media', 'baja'].includes(record.prioridad) ? record.prioridad : 'media',
    precio_estimado: price,
    fecha_agregado: cleanText(record.fecha_agregado) || new Date().toISOString(),
    estado: state,
    fecha_resolucion: state === 'activo' ? null : (cleanText(record.fecha_resolucion) || null),
    libro_uuid_adquirido: state === 'adquirido' ? normalizeBackupUUID(record.libro_uuid_adquirido) : null,
  };
}

function collectSanitized(records, sanitizer, entity, result) {
  const accepted = [];
  records.forEach((record, index) => {
    try {
      accepted.push(sanitizer(record, index));
    } catch (error) {
      result[entity].rechazados += 1;
      result.advertencias.push(error.message);
    }
  });
  return accepted;
}

function emptyStats() {
  return { creados: 0, actualizados: 0, omitidos: 0, rechazados: 0 };
}

function createResult(mode, version) {
  return {
    modo: mode,
    version,
    libros: emptyStats(),
    lista_compras: emptyStats(),
    etiquetas: emptyStats(),
    libro_etiquetas: emptyStats(),
    sesiones_lectura: emptyStats(),
    advertencias: [],
    errores: [],
  };
}

function addBookToIndexes(book, indexes) {
  if (book.uuid) indexes.uuid.set(book.uuid, book);
  for (const variant of reliableISBNVariants(normalizeBackupISBN(book.isbn))) indexes.isbn.set(variant, book);
  indexes.titleAuthor.set(titleAuthorKey(book), book);
}

function buildBookIndexes(books) {
  const indexes = { uuid: new Map(), isbn: new Map(), titleAuthor: new Map() };
  books.forEach((book) => addBookToIndexes(book, indexes));
  return indexes;
}

function resolveBook(book, indexes) {
  const byUuid = book.importedUuid ? indexes.uuid.get(book.importedUuid) : null;
  const byIsbn = book.reliableIsbn
    ? book.isbnVariants.map((variant) => indexes.isbn.get(variant)).find(Boolean)
    : null;
  if (byUuid && byIsbn && byUuid.id !== byIsbn.id) return { conflict: true };
  if (byUuid || byIsbn) return { existing: byUuid || byIsbn };
  if (!book.importedUuid && !book.reliableIsbn) {
    const byTitle = indexes.titleAuthor.get(titleAuthorKey(book));
    if (byTitle) return { existing: byTitle };
  }
  return { existing: null };
}

function useful(imported, local) {
  return imported === null || imported === undefined || imported === '' ? local : imported;
}

function mergedBook(imported, local, mode, importedCover) {
  const mayReplaceProgress = mode === IMPORT_MODES.REPLACE || !Number(local?.pagina_actual || 0);
  return {
    uuid: local?.uuid || imported.importedUuid || deterministicUUID('legacy-book', imported.titulo, imported.autor, imported.isbn),
    isbn: useful(imported.isbn, local?.isbn ?? null),
    titulo: useful(imported.titulo, local?.titulo),
    autor: useful(imported.autor, local?.autor ?? null),
    portada_url: useful(importedCover, local?.portada_url ?? null),
    paginas_totales: useful(imported.paginas_totales, local?.paginas_totales ?? null),
    pagina_actual: mayReplaceProgress ? imported.pagina_actual : Number(local.pagina_actual || 0),
    estado: useful(imported.estado, local?.estado || 'quiero leer'),
    calificacion: useful(imported.calificacion, local?.calificacion ?? null),
    notas: useful(imported.notas, local?.notas ?? null),
    fecha_agregado: local?.fecha_agregado || imported.fecha_agregado,
    fecha_fin: useful(imported.fecha_fin, local?.fecha_fin ?? null),
  };
}

function buildWishlistIndexes(items) {
  const uuid = new Map();
  const titleAuthor = new Map();
  items.forEach((item) => {
    if (item.uuid) uuid.set(item.uuid, item);
    titleAuthor.set(titleAuthorKey(item), item);
  });
  return { uuid, titleAuthor };
}

function resolveMappedBook(record, maps) {
  const uuid = normalizeBackupUUID(record?.libro_uuid);
  if (uuid && maps.bookUuid.has(uuid)) return maps.bookUuid.get(uuid);
  const oldId = record?.libro_id ?? record?.book_id ?? record?.id_libro;
  if (oldId !== null && oldId !== undefined && maps.bookId.has(String(oldId))) return maps.bookId.get(String(oldId));
  return uuid || null;
}

function safeSession(record, bookUuid) {
  const fecha = cleanText(record?.fecha);
  const start = cleanText(record?.hora_inicio);
  if (!bookUuid || !fecha || !start) return null;
  const pages = nonNegativeIntegerOrNull(record.paginas_leidas ?? 0);
  const pageStart = nonNegativeIntegerOrNull(record.pagina_inicio);
  const pageEnd = nonNegativeIntegerOrNull(record.pagina_fin);
  let duration = nonNegativeIntegerOrNull(record.duracion_segundos);
  if ([pages, pageStart, pageEnd, duration].some(Number.isNaN)) return null;
  if (pageStart !== null && pageEnd !== null && pageEnd < pageStart) return null;
  if (duration === null && record?.hora_fin) {
    const startTime = new Date(start).getTime();
    const endTime = new Date(record.hora_fin).getTime();
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime) {
      duration = Math.floor((endTime - startTime) / 1000);
    }
  }
  return {
    libro_uuid: bookUuid,
    fecha,
    hora_inicio: start,
    hora_fin: cleanText(record.hora_fin) || null,
    paginas_leidas: pages ?? 0,
    pagina_inicio: pageStart,
    pagina_fin: pageEnd,
    duracion_segundos: duration,
  };
}

export async function importPreparedBackup({
  db,
  document,
  mode = IMPORT_MODES.MERGE,
  replaceConfirmed = false,
  writeCover = writeBackupCover,
  deleteCover = eliminarPortadaLocal,
}) {
  if (!db) throw new Error('No se recibió una conexión SQLite para importar.');
  if (!Object.values(IMPORT_MODES).includes(mode)) throw new Error('El modo de importación no es válido.');
  if (mode === IMPORT_MODES.REPLACE && !replaceConfirmed) {
    throw new Error('Reemplazar requiere una confirmación explícita.');
  }
  const { backup } = validateBackupDocument(document);
  const result = createResult(mode, backup.version);
  const books = collectSanitized(backup.libros, sanitizeBook, 'libros', result);
  const wishlist = collectSanitized(backup.lista_compras, sanitizeWishlist, 'lista_compras', result);
  const currentBooks = mode === IMPORT_MODES.REPLACE ? [] : await db.getAllAsync('SELECT * FROM mis_libros ORDER BY id');
  const currentWishlist = mode === IMPORT_MODES.REPLACE ? [] : await db.getAllAsync('SELECT * FROM lista_compras ORDER BY id');
  const allExistingCovers = mode === IMPORT_MODES.REPLACE
    ? (await db.getAllAsync('SELECT portada_url FROM mis_libros WHERE portada_url IS NOT NULL')).map((row) => row.portada_url)
    : [];
  const bookIndexes = buildBookIndexes(currentBooks);
  const bookPlans = [];
  const maps = { bookId: new Map(), bookUuid: new Map(), tagId: new Map(), tagUuid: new Map() };

  for (const book of books) {
    const resolution = resolveBook(book, bookIndexes);
    if (resolution.conflict) {
      result.libros.rechazados += 1;
      result.advertencias.push(`Libro "${book.titulo}": UUID e ISBN pertenecen a registros locales diferentes.`);
      continue;
    }
    const local = resolution.existing;
    const finalUuid = local?.uuid || book.importedUuid || deterministicUUID('legacy-book', book.titulo, book.autor, book.isbn);
    if (book.oldId) maps.bookId.set(book.oldId, finalUuid);
    if (book.importedUuid) maps.bookUuid.set(book.importedUuid, finalUuid);
    maps.bookUuid.set(finalUuid, finalUuid);
    if (typeof local?.id === 'string' && local.id.startsWith('planned:')) {
      result.libros.omitidos += 1;
      result.advertencias.push(`Se omitió un libro repetido dentro del respaldo: "${book.titulo}".`);
      continue;
    }
    const synthetic = { ...(local || {}), id: local?.id ?? `planned:${finalUuid}`, uuid: finalUuid, isbn: book.isbn, titulo: book.titulo, autor: book.autor };
    addBookToIndexes(synthetic, bookIndexes);
    bookPlans.push({ imported: book, local, finalUuid });
  }

  const createdCovers = [];
  const replacedCovers = [];
  for (const plan of bookPlans) {
    let importedCover = plan.imported.portada_remota;
    if (plan.imported.portada_base64) {
      try {
        importedCover = await writeCover(plan.imported.portada_base64, plan.finalUuid);
        if (importedCover) createdCovers.push(importedCover);
      } catch (error) {
        result.advertencias.push(`Portada de "${plan.imported.titulo}": ${error.message}`);
      }
    }
    plan.data = mergedBook(plan.imported, plan.local, mode, importedCover);
    plan.data.uuid = plan.finalUuid;
    if (plan.local?.portada_url && importedCover && plan.local.portada_url !== importedCover) {
      replacedCovers.push(plan.local.portada_url);
    }
  }

  const wishlistIndexes = buildWishlistIndexes(currentWishlist);
  const wishlistPlans = [];
  for (const item of wishlist) {
    const local = (item.importedUuid && wishlistIndexes.uuid.get(item.importedUuid))
      || wishlistIndexes.titleAuthor.get(titleAuthorKey(item));
    const finalUuid = local?.uuid || item.importedUuid || deterministicUUID('legacy-wish', item.titulo, item.autor);
    if (typeof local?.id === 'string' && local.id.startsWith('planned:')) {
      result.lista_compras.omitidos += 1;
      result.advertencias.push(`Se omitió un deseo repetido dentro del respaldo: "${item.titulo}".`);
      continue;
    }
    const synthetic = { ...(local || {}), id: local?.id ?? `planned:${finalUuid}`, uuid: finalUuid, titulo: item.titulo, autor: item.autor };
    wishlistIndexes.uuid.set(finalUuid, synthetic);
    wishlistIndexes.titleAuthor.set(titleAuthorKey(item), synthetic);
    wishlistPlans.push({ imported: item, local, finalUuid });
  }

  try {
    await db.withExclusiveTransactionAsync(async (tx) => {
      if (mode === IMPORT_MODES.REPLACE) {
        await tx.runAsync('DELETE FROM libro_etiquetas');
        await tx.runAsync('DELETE FROM sesiones_lectura');
        await tx.runAsync('DELETE FROM etiquetas');
        await tx.runAsync('DELETE FROM lista_compras');
        await tx.runAsync('DELETE FROM mis_libros');
      }

      for (const plan of bookPlans) {
        if (plan.local && mode === IMPORT_MODES.MERGE) {
          await tx.runAsync(
            `UPDATE mis_libros SET isbn = ?, titulo = ?, autor = ?, portada_url = ?, paginas_totales = ?,
             pagina_actual = ?, estado = ?, calificacion = ?, notas = ?, fecha_fin = ? WHERE id = ?`,
            plan.data.isbn, plan.data.titulo, plan.data.autor, plan.data.portada_url,
            plan.data.paginas_totales, plan.data.pagina_actual, plan.data.estado,
            plan.data.calificacion, plan.data.notas, plan.data.fecha_fin, plan.local.id
          );
          result.libros.actualizados += 1;
        } else {
          await tx.runAsync(
            `INSERT INTO mis_libros
              (uuid, isbn, titulo, autor, portada_url, paginas_totales, pagina_actual, estado, calificacion, notas, fecha_agregado, fecha_fin)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            plan.data.uuid, plan.data.isbn, plan.data.titulo, plan.data.autor, plan.data.portada_url,
            plan.data.paginas_totales, plan.data.pagina_actual, plan.data.estado, plan.data.calificacion,
            plan.data.notas, plan.data.fecha_agregado, plan.data.fecha_fin
          );
          result.libros.creados += 1;
        }
        const stored = await tx.getFirstAsync('SELECT id, uuid FROM mis_libros WHERE uuid = ?', plan.data.uuid);
        if (plan.imported.oldId && stored) maps.bookId.set(plan.imported.oldId, stored.uuid);
      }

      for (const plan of wishlistPlans) {
        const imported = plan.imported;
        const acquiredBookUuid = imported.libro_uuid_adquirido
          ? (maps.bookUuid.get(imported.libro_uuid_adquirido) || imported.libro_uuid_adquirido)
          : null;
        if (plan.local && mode === IMPORT_MODES.MERGE) {
          await tx.runAsync(
            `UPDATE lista_compras SET titulo = ?, autor = ?, prioridad = ?, precio_estimado = ?,
             estado = ?, fecha_resolucion = ?, libro_uuid_adquirido = ? WHERE id = ?`,
            imported.titulo,
            useful(imported.autor, plan.local.autor),
            useful(imported.prioridad, plan.local.prioridad),
            useful(imported.precio_estimado, plan.local.precio_estimado),
            imported.estado,
            useful(imported.fecha_resolucion, plan.local.fecha_resolucion),
            useful(acquiredBookUuid, plan.local.libro_uuid_adquirido),
            plan.local.id
          );
          result.lista_compras.actualizados += 1;
        } else {
          await tx.runAsync(
            `INSERT INTO lista_compras
              (uuid, titulo, autor, prioridad, precio_estimado, fecha_agregado, estado, fecha_resolucion, libro_uuid_adquirido)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            plan.finalUuid, imported.titulo, imported.autor, imported.prioridad, imported.precio_estimado,
            imported.fecha_agregado, imported.estado, imported.fecha_resolucion, acquiredBookUuid
          );
          result.lista_compras.creados += 1;
        }
      }

      for (const [index, tag] of backup.etiquetas.entries()) {
        const name = cleanText(tag?.nombre);
        if (!name) {
          result.etiquetas.rechazados += 1;
          result.advertencias.push(`Etiqueta ${index + 1}: nombre inválido.`);
          continue;
        }
        const importedUuid = normalizeBackupUUID(tag.uuid);
        const byUuid = importedUuid ? await tx.getFirstAsync('SELECT * FROM etiquetas WHERE uuid = ?', importedUuid) : null;
        const byName = await tx.getFirstAsync('SELECT * FROM etiquetas WHERE nombre = ? COLLATE NOCASE', name);
        const existing = byUuid || byName;
        const finalUuid = existing?.uuid || importedUuid || deterministicUUID('legacy-tag', name);
        if (tag.id !== null && tag.id !== undefined) maps.tagId.set(String(tag.id), finalUuid);
        if (importedUuid) maps.tagUuid.set(importedUuid, finalUuid);
        maps.tagUuid.set(finalUuid, finalUuid);
        if (existing) {
          result.etiquetas.omitidos += 1;
        } else {
          await tx.runAsync('INSERT INTO etiquetas (uuid, nombre) VALUES (?, ?)', finalUuid, name);
          result.etiquetas.creados += 1;
        }
      }

      for (const relation of backup.libro_etiquetas) {
        const bookUuid = resolveMappedBook(relation, maps);
        const importedTagUuid = normalizeBackupUUID(relation?.etiqueta_uuid);
        const oldTagId = relation?.etiqueta_id ?? relation?.tag_id ?? relation?.id_etiqueta;
        const tagUuid = (importedTagUuid && maps.tagUuid.get(importedTagUuid))
          || (oldTagId !== null && oldTagId !== undefined ? maps.tagId.get(String(oldTagId)) : null)
          || importedTagUuid;
        const bookExists = bookUuid ? await tx.getFirstAsync('SELECT uuid FROM mis_libros WHERE uuid = ?', bookUuid) : null;
        const tagExists = tagUuid ? await tx.getFirstAsync('SELECT uuid FROM etiquetas WHERE uuid = ?', tagUuid) : null;
        if (!bookExists || !tagExists) {
          result.libro_etiquetas.omitidos += 1;
          result.advertencias.push('Se omitió una relación libro-etiqueta huérfana.');
          continue;
        }
        const insertion = await tx.runAsync(
          'INSERT INTO libro_etiquetas (libro_uuid, etiqueta_uuid) VALUES (?, ?) ON CONFLICT(libro_uuid, etiqueta_uuid) DO NOTHING',
          bookUuid,
          tagUuid
        );
        if (insertion.changes) result.libro_etiquetas.creados += 1;
        else result.libro_etiquetas.omitidos += 1;
      }

      for (const sessionRecord of backup.sesiones_lectura) {
        const bookUuid = resolveMappedBook(sessionRecord, maps);
        const session = safeSession(sessionRecord, bookUuid);
        const bookExists = bookUuid ? await tx.getFirstAsync('SELECT uuid FROM mis_libros WHERE uuid = ?', bookUuid) : null;
        if (!session || !bookExists) {
          result.sesiones_lectura.omitidos += 1;
          result.advertencias.push('Se omitió una sesión de lectura inválida o huérfana.');
          continue;
        }
        const existing = await tx.getFirstAsync(
          'SELECT id FROM sesiones_lectura WHERE libro_uuid = ? AND hora_inicio = ?',
          session.libro_uuid,
          session.hora_inicio
        );
        if (existing) {
          await tx.runAsync(
            `UPDATE sesiones_lectura SET fecha = ?, hora_fin = ?, paginas_leidas = ?, pagina_inicio = ?,
             pagina_fin = ?, duracion_segundos = ? WHERE id = ?`,
            session.fecha, session.hora_fin, session.paginas_leidas, session.pagina_inicio,
            session.pagina_fin, session.duracion_segundos, existing.id
          );
          result.sesiones_lectura.actualizados += 1;
        } else {
          const active = !session.hora_fin
            ? await tx.getFirstAsync('SELECT id FROM sesiones_lectura WHERE libro_uuid = ? AND hora_fin IS NULL', session.libro_uuid)
            : null;
          if (active) {
            result.sesiones_lectura.omitidos += 1;
            result.advertencias.push('Se omitió una segunda sesión activa para el mismo libro.');
            continue;
          }
          await tx.runAsync(
            `INSERT INTO sesiones_lectura
              (libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas, pagina_inicio, pagina_fin, duracion_segundos)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            session.libro_uuid, session.fecha, session.hora_inicio, session.hora_fin,
            session.paginas_leidas, session.pagina_inicio, session.pagina_fin, session.duracion_segundos
          );
          result.sesiones_lectura.creados += 1;
        }
      }
    });
  } catch (error) {
    createdCovers.forEach((uri) => deleteCover(uri));
    throw error;
  }

  [...new Set([...allExistingCovers, ...replacedCovers])]
    .filter((uri) => uri?.startsWith('file://') && !createdCovers.includes(uri))
    .forEach((uri) => deleteCover(uri));
  return result;
}

import { File, Paths } from 'expo-file-system';
import { deleteAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export const BACKUP_MIME_TYPE = 'application/json';
export const MAX_BACKUP_IMPORT_BYTES = 32 * 1024 * 1024;
export const BACKUP_IMPORT_TOO_LARGE_MESSAGE = 'El respaldo supera el tamaño máximo permitido de 32 MB.';
export const BACKUP_IMPORT_SIZE_UNKNOWN_MESSAGE = 'No se pudo verificar el tamaño del respaldo.';

export class BackupFileError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'BackupFileError';
    this.code = code;
    this.cause = cause;
  }
}

function twoDigits(value) {
  return String(value).padStart(2, '0');
}

export function crearNombreArchivoBackup(fecha = new Date()) {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
    throw new BackupFileError('FECHA_INVALIDA', 'No se pudo generar la fecha del respaldo.');
  }
  const day = `${fecha.getFullYear()}-${twoDigits(fecha.getMonth() + 1)}-${twoDigits(fecha.getDate())}`;
  const time = `${twoDigits(fecha.getHours())}${twoDigits(fecha.getMinutes())}${twoDigits(fecha.getSeconds())}`;
  return `mi-biblioteca-backup-${day}-${time}.json`;
}

export function serializarBackup(documento) {
  try {
    return JSON.stringify(documento, null, 2);
  } catch (error) {
    throw new BackupFileError('SERIALIZACION_FALLIDA', 'No se pudo serializar el respaldo.', error);
  }
}

function nombreSinExtension(nombre) {
  return nombre.toLowerCase().endsWith('.json') ? nombre.slice(0, -5) : nombre;
}

function isAccessError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('permission')
    || message.includes('denied')
    || message.includes('securityexception')
    || message.includes('eacces');
}

function normalizarBytes(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  if (typeof value !== 'number') return null;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function medirBytesUTF8(texto) {
  const value = String(texto ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function validarTamanoBackupImportacion(bytes, {
  maxBackupImportBytes = MAX_BACKUP_IMPORT_BYTES,
  allowUnknown = false,
} = {}) {
  const normalizedBytes = normalizarBytes(bytes);
  if (normalizedBytes === null) {
    if (allowUnknown) return null;
    throw new BackupFileError('TAMANO_DESCONOCIDO', BACKUP_IMPORT_SIZE_UNKNOWN_MESSAGE);
  }
  if (normalizedBytes > maxBackupImportBytes) {
    throw new BackupFileError('RESPALDO_DEMASIADO_GRANDE', BACKUP_IMPORT_TOO_LARGE_MESSAGE);
  }
  return normalizedBytes;
}

export async function obtenerTamanoBackupImportacion(asset, archivo) {
  if (Object.prototype.hasOwnProperty.call(asset || {}, 'size') && asset.size !== undefined && asset.size !== null) {
    return validarTamanoBackupImportacion(asset.size, { allowUnknown: false });
  }

  if (archivo && typeof archivo.info === 'function') {
    try {
      const info = await archivo.info();
      if (info?.exists === false) {
        throw new BackupFileError('TAMANO_DESCONOCIDO', BACKUP_IMPORT_SIZE_UNKNOWN_MESSAGE);
      }
      return validarTamanoBackupImportacion(info?.size, { allowUnknown: false });
    } catch {
      throw new BackupFileError('TAMANO_DESCONOCIDO', BACKUP_IMPORT_SIZE_UNKNOWN_MESSAGE);
    }
  }

  if (archivo && Object.prototype.hasOwnProperty.call(archivo, 'size')) {
    return validarTamanoBackupImportacion(archivo.size, { allowUnknown: false });
  }

  throw new BackupFileError('TAMANO_DESCONOCIDO', BACKUP_IMPORT_SIZE_UNKNOWN_MESSAGE);
}

export async function leerTextoBackupImportacion(asset, archivo, {
  maxBackupImportBytes = MAX_BACKUP_IMPORT_BYTES,
} = {}) {
  const declaredBytes = await obtenerTamanoBackupImportacion(asset, archivo);
  validarTamanoBackupImportacion(declaredBytes, { maxBackupImportBytes });
  const contenido = await archivo.text();
  const realBytes = medirBytesUTF8(contenido);
  validarTamanoBackupImportacion(realBytes, { maxBackupImportBytes });
  return contenido;
}

export async function guardarDocumentoBackup({ contenido, nombre }) {
  let permiso;
  try {
    permiso = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  } catch (error) {
    throw new BackupFileError(
      'ACCESO_DENEGADO',
      'Android no permitió acceder a la carpeta elegida. Selecciona otra carpeta y vuelve a intentarlo.',
      error
    );
  }

  if (!permiso?.granted || !permiso.directoryUri) return { cancelado: true };

  let uri = null;
  try {
    uri = await StorageAccessFramework.createFileAsync(
      permiso.directoryUri,
      nombreSinExtension(nombre),
      BACKUP_MIME_TYPE
    );
    await StorageAccessFramework.writeAsStringAsync(uri, contenido, {
      encoding: EncodingType.UTF8,
    });
    return { cancelado: false, uri, nombre, mimeType: BACKUP_MIME_TYPE };
  } catch (error) {
    if (uri) {
      try {
        await deleteAsync(uri, { idempotent: true });
      } catch (cleanupError) {
        console.warn('No se pudo retirar el respaldo incompleto.', cleanupError);
      }
    }
    if (isAccessError(error)) {
      throw new BackupFileError(
        'ACCESO_DENEGADO',
        'No se pudo escribir en esa carpeta. Comprueba el acceso o selecciona otra ubicación.',
        error
      );
    }
    throw new BackupFileError(
      'ESCRITURA_FALLIDA',
      'No se pudo guardar el respaldo. Comprueba el espacio disponible y vuelve a intentarlo.',
      error
    );
  }
}

export async function compartirDocumentoBackup({ contenido, nombre }) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new BackupFileError(
      'COMPARTIR_NO_DISPONIBLE',
      'El menú para compartir no está disponible en este dispositivo.'
    );
  }

  const archivo = new File(Paths.cache, nombre);
  try {
    if (archivo.exists) archivo.delete();
    archivo.create();
    archivo.write(contenido);
    await Sharing.shareAsync(archivo.uri, {
      mimeType: BACKUP_MIME_TYPE,
      dialogTitle: 'Compartir respaldo de Mi Biblioteca',
      UTI: 'public.json',
    });
    return { cancelado: false, nombre, mimeType: BACKUP_MIME_TYPE };
  } catch (error) {
    throw new BackupFileError(
      'COMPARTIR_FALLIDO',
      'No se pudo compartir el respaldo. Vuelve a intentarlo o utiliza Guardar respaldo.',
      error
    );
  } finally {
    try {
      if (archivo.exists) archivo.delete();
    } catch (cleanupError) {
      console.warn('No se pudo limpiar el respaldo temporal.', cleanupError);
    }
  }
}

export function validarArchivoJSONSeleccionado(asset) {
  if (!asset?.uri) {
    throw new BackupFileError('ARCHIVO_INVALIDO', 'El selector no devolvió un archivo válido.');
  }
  const name = String(asset.name || '').trim();
  const mime = String(asset.mimeType || '').toLowerCase();
  if (name && !name.toLowerCase().endsWith('.json')) {
    throw new BackupFileError('ARCHIVO_NO_JSON', 'Selecciona un archivo con extensión .json.');
  }
  const acceptedMimes = ['', BACKUP_MIME_TYPE, 'text/json', 'text/plain', 'application/octet-stream'];
  if (!acceptedMimes.includes(mime) && !name.toLowerCase().endsWith('.json')) {
    throw new BackupFileError('ARCHIVO_NO_JSON', 'El archivo seleccionado no es un documento JSON.');
  }
  return asset;
}

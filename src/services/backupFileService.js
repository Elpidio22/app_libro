import { File, Paths } from 'expo-file-system';
import { deleteAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export const BACKUP_MIME_TYPE = 'application/json';

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

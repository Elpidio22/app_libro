import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';

const PORTADAS_DIRECTORY = new Directory(Paths.document, 'portadas');
const PORTADAS_TEMP_DIRECTORY = new Directory(Paths.cache, 'portadas-temporales');

export class PortadaError extends Error {
  constructor(codigo, message, cause = null) {
    super(message);
    this.name = 'PortadaError';
    this.codigo = codigo;
    this.cause = cause;
  }
}

const FEEDBACK_PORTADA = Object.freeze({
  SIN_ESPACIO: Object.freeze({
    titulo: 'Almacenamiento lleno',
    mensaje: 'No hay espacio suficiente en el dispositivo para guardar la portada. Libera espacio e inténtalo nuevamente.',
  }),
  PERMISO_DENEGADO: Object.freeze({
    titulo: 'Permiso denegado',
    mensaje: 'La aplicación no tiene permiso para acceder o guardar la imagen. Revisa los permisos del dispositivo.',
  }),
  FORMATO_INVALIDO: Object.freeze({
    titulo: 'Imagen no compatible',
    mensaje: 'El archivo seleccionado no es una imagen válida o utiliza un formato no compatible.',
  }),
  PROCESAMIENTO_FALLIDO: Object.freeze({
    titulo: 'No se pudo procesar la portada',
    mensaje: 'La imagen no pudo prepararse para guardarla. Prueba con otra portada.',
  }),
  TEMPORAL_NO_ENCONTRADO: Object.freeze({
    titulo: 'La portada ya no está disponible',
    mensaje: 'El archivo temporal fue eliminado antes de guardar. Selecciona la portada nuevamente.',
  }),
  CONFIRMACION_FALLIDA: Object.freeze({
    titulo: 'No se pudo guardar la portada',
    mensaje: 'La imagen fue seleccionada, pero no pudo moverse al almacenamiento permanente.',
  }),
  PORTAPAPELES_FALLIDO: Object.freeze({
    titulo: 'No se pudo leer la imagen copiada',
    mensaje: 'El contenido del portapapeles no pudo convertirse en una portada. Copia otra imagen e inténtalo nuevamente.',
  }),
});

export function obtenerFeedbackPortada(error, tituloFallback = 'Portada no disponible') {
  const feedback = FEEDBACK_PORTADA[error?.codigo];
  if (feedback) return feedback;
  return {
    titulo: tituloFallback,
    mensaje: error instanceof PortadaError
      ? error.message
      : 'Ocurrió un error inesperado al trabajar con la portada. Inténtalo nuevamente.',
  };
}

function clasificarErrorFilesystem(error, fallback = 'PROCESAMIENTO_FALLIDO') {
  const message = String(error?.message || error);
  if (/space|ENOSPC/i.test(message)) return 'SIN_ESPACIO';
  if (/permission|denied|EACCES/i.test(message)) return 'PERMISO_DENEGADO';
  if (/decode|format|image/i.test(message)) return 'FORMATO_INVALIDO';
  return fallback;
}

function asegurarDirectorioPortadas() {
  if (!PORTADAS_DIRECTORY.exists) {
    PORTADAS_DIRECTORY.create({ idempotent: true, intermediates: true });
  }
}

function asegurarDirectorioTemporal() {
  if (!PORTADAS_TEMP_DIRECTORY.exists) {
    PORTADAS_TEMP_DIRECTORY.create({ idempotent: true, intermediates: true });
  }
}

function obtenerAncho(uri) {
  return new Promise((resolve) => {
    Image.getSize(uri, (width) => resolve(width), () => resolve(null));
  });
}

function borrarSiExiste(archivo) {
  try {
    if (archivo?.exists) archivo.delete();
  } catch (error) {
    // La limpieza de caché no interrumpe el guardado, pero deja diagnóstico.
    console.warn('No se pudo limpiar un archivo temporal de portada.', error);
  }
}

/**
 * Convierte una portada local o remota en un JPEG persistente y liviano.
 * Devuelve null para que la interfaz use el placeholder si algo falla.
 */
export function esPortadaTemporal(uri) {
  return Boolean(uri && uri.includes('/portadas-temporales/'));
}

export async function optimizarYGuardarPortada(uriOriginal, { temporal = false } = {}) {
  if (!uriOriginal) return null;

  let descargaTemporal = null;
  let resultadoTemporal = null;
  try {
    if (temporal) asegurarDirectorioTemporal();
    else asegurarDirectorioPortadas();
    let uriLocal = uriOriginal;

    if (/^https?:\/\//i.test(uriOriginal)) {
      descargaTemporal = new File(
        Paths.cache,
        `portada_descarga_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.img`
      );
      const descarga = await File.downloadFileAsync(
        uriOriginal.replace(/^http:/i, 'https:'),
        descargaTemporal,
        { idempotent: true }
      );
      uriLocal = descarga.uri;
    }

    const anchoOriginal = await obtenerAncho(uriLocal);
    const acciones = anchoOriginal === null || anchoOriginal > 350
      ? [{ resize: { width: 350 } }]
      : [];
    resultadoTemporal = await manipulateAsync(uriLocal, acciones, {
      compress: 0.65,
      format: SaveFormat.JPEG,
    });

    const destino = new File(
      temporal ? PORTADAS_TEMP_DIRECTORY : PORTADAS_DIRECTORY,
      `${temporal ? 'portada_temporal' : 'portada_optimizada'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
    );
    new File(resultadoTemporal.uri).copy(destino);
    return destino.uri;
  } catch (error) {
    const codigo = clasificarErrorFilesystem(error);
    console.error('No se pudo procesar la portada.', { codigo, uri: uriOriginal, error });
    throw new PortadaError(codigo, 'No se pudo procesar o almacenar la portada.', error);
  } finally {
    borrarSiExiste(descargaTemporal);
    if (resultadoTemporal?.uri) borrarSiExiste(new File(resultadoTemporal.uri));
  }
}

export function confirmarPortadaTemporal(uri) {
  if (!esPortadaTemporal(uri)) return { uri, creada: false };
  asegurarDirectorioPortadas();
  const origen = new File(uri);
  if (!origen.exists) throw new PortadaError('TEMPORAL_NO_ENCONTRADO', 'La portada temporal ya no existe.');
  const destino = new File(
    PORTADAS_DIRECTORY,
    `portada_optimizada_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
  );
  try {
    origen.copy(destino);
    origen.delete();
    return { uri: destino.uri, creada: true };
  } catch (error) {
    borrarSiExiste(destino);
    console.error('No se pudo confirmar la portada temporal.', error);
    throw new PortadaError(
      clasificarErrorFilesystem(error, 'CONFIRMACION_FALLIDA'),
      'No se pudo confirmar la portada seleccionada.',
      error
    );
  }
}

export function descartarPortadaTemporal(uri) {
  if (esPortadaTemporal(uri)) borrarSiExiste(new File(uri));
}

export function eliminarPortadaLocal(uri) {
  if (uri?.startsWith('file://')) borrarSiExiste(new File(uri));
}

export async function pegarPortadaDesdePortapapeles({ temporal = false } = {}) {
  try {
    if (!(await Clipboard.hasImageAsync())) return null;
    const imagen = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.9 });
    if (!imagen?.data) return null;
    return optimizarYGuardarPortada(imagen.data, { temporal });
  } catch (error) {
    console.error('No se pudo leer una portada desde el portapapeles.', error);
    if (error instanceof PortadaError) throw error;
    throw new PortadaError('PORTAPAPELES_FALLIDO', 'No se pudo leer la imagen copiada.', error);
  }
}

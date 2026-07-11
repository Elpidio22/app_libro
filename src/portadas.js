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
  } catch {
    // La limpieza de caché nunca debe interrumpir el guardado.
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
    const message = String(error?.message || error);
    const codigo = /space|ENOSPC/i.test(message)
      ? 'SIN_ESPACIO'
      : /permission|denied|EACCES/i.test(message)
        ? 'PERMISO_DENEGADO'
        : /decode|format|image/i.test(message)
          ? 'FORMATO_INVALIDO'
          : 'PROCESAMIENTO_FALLIDO';
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
    throw new PortadaError('CONFIRMACION_FALLIDA', 'No se pudo confirmar la portada seleccionada.', error);
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
    throw new PortadaError('PORTAPAPELES_FALLIDO', 'No se pudo leer la imagen copiada.', error);
  }
}

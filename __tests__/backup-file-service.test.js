const fileSystem = require('expo-file-system');
const legacyFileSystem = require('expo-file-system/legacy');
const sharing = require('expo-sharing');
const {
  BACKUP_MIME_TYPE,
  BACKUP_IMPORT_SIZE_UNKNOWN_MESSAGE,
  BACKUP_IMPORT_TOO_LARGE_MESSAGE,
  MAX_BACKUP_IMPORT_BYTES,
  compartirDocumentoBackup,
  crearNombreArchivoBackup,
  guardarDocumentoBackup,
  leerTextoBackupImportacion,
  medirBytesUTF8,
  obtenerTamanoBackupImportacion,
  serializarBackup,
  validarTamanoBackupImportacion,
  validarArchivoJSONSeleccionado,
} = require('../src/services/backupFileService');

const validDocument = {
  tipo: 'mi-biblioteca-backup',
  version: 6,
  libros: [],
};

beforeEach(() => {
  fileSystem.__reset();
  legacyFileSystem.__reset();
  sharing.__reset();
});

describe('backupFileService', () => {
  test('genera un nombre único con fecha, hora, segundos y extensión JSON', () => {
    const name = crearNombreArchivoBackup(new Date(2026, 6, 17, 21, 30, 5));
    expect(name).toBe('mi-biblioteca-backup-2026-07-17-213005.json');
    expect(name.endsWith('.json')).toBe(true);
  });

  test('serializa un documento como JSON válido', () => {
    expect(JSON.parse(serializarBackup(validDocument))).toEqual(validDocument);
  });

  test('valida el límite exacto de importación en bytes', () => {
    expect(MAX_BACKUP_IMPORT_BYTES).toBe(33554432);
    expect(validarTamanoBackupImportacion(0)).toBe(0);
    expect(validarTamanoBackupImportacion(1)).toBe(1);
    expect(validarTamanoBackupImportacion(MAX_BACKUP_IMPORT_BYTES)).toBe(MAX_BACKUP_IMPORT_BYTES);
    expect(() => validarTamanoBackupImportacion(MAX_BACKUP_IMPORT_BYTES + 1))
      .toThrow(BACKUP_IMPORT_TOO_LARGE_MESSAGE);
  });

  test('rechaza tamaños desconocidos o inválidos antes de leer', () => {
    for (const value of [undefined, null, Number.NaN, Infinity, -1, 'abc']) {
      expect(() => validarTamanoBackupImportacion(value)).toThrow(BACKUP_IMPORT_SIZE_UNKNOWN_MESSAGE);
    }
  });

  test('obtiene tamaño desde selector y usa FileSystem como fallback', async () => {
    const fromPicker = await obtenerTamanoBackupImportacion({ uri: 'file:///x.json', size: '12' }, null);
    expect(fromPicker).toBe(12);

    const file = new fileSystem.File(fileSystem.Paths.cache, 'fallback.json');
    file.create();
    file.write('12345');
    await expect(obtenerTamanoBackupImportacion({ uri: file.uri }, file)).resolves.toBe(5);
  });

  test('lectura protegida permite el límite y mide UTF-8 real antes de parsear', async () => {
    const file = new fileSystem.File(fileSystem.Paths.cache, 'utf8.json');
    file.create();
    file.write('éé');
    expect(medirBytesUTF8('éé')).toBe(4);
    await expect(leerTextoBackupImportacion({ uri: file.uri, size: 4 }, file, { maxBackupImportBytes: 4 }))
      .resolves.toBe('éé');
    await expect(leerTextoBackupImportacion({ uri: file.uri, size: 1 }, file, { maxBackupImportBytes: 3 }))
      .rejects.toThrow(BACKUP_IMPORT_TOO_LARGE_MESSAGE);
  });

  test('cancelar el selector de carpeta no escribe ni produce un error', async () => {
    legacyFileSystem.__setPermissionResult({ granted: false });
    await expect(guardarDocumentoBackup({ contenido: '{}', nombre: 'backup.json' }))
      .resolves.toEqual({ cancelado: true });
    expect(legacyFileSystem.StorageAccessFramework.createFileAsync).not.toHaveBeenCalled();
  });

  test('un acceso denegado devuelve un error tipado y claro', async () => {
    legacyFileSystem.__setRequestFailure(new Error('SecurityException: permission denied'));
    await expect(guardarDocumentoBackup({ contenido: '{}', nombre: 'backup.json' }))
      .rejects.toMatchObject({ code: 'ACCESO_DENEGADO' });
  });

  test('un error al escribir devuelve ESCRITURA_FALLIDA', async () => {
    legacyFileSystem.__setWriteFailure(new Error('disk full'));
    await expect(guardarDocumentoBackup({ contenido: '{}', nombre: 'backup.json' }))
      .rejects.toMatchObject({ code: 'ESCRITURA_FALLIDA' });
    expect(legacyFileSystem.deleteAsync).toHaveBeenCalledWith(
      expect.stringMatching(/backup\.json$/),
      { idempotent: true }
    );
  });

  test('guarda en la carpeta SAF con MIME JSON y UTF-8', async () => {
    const result = await guardarDocumentoBackup({ contenido: '{"ok":true}', nombre: 'backup.json' });
    const created = legacyFileSystem.__createdFiles()[0];
    expect(result).toMatchObject({ cancelado: false, nombre: 'backup.json', mimeType: BACKUP_MIME_TYPE });
    expect(created).toMatchObject({ name: 'backup', mimeType: BACKUP_MIME_TYPE });
    expect(legacyFileSystem.__content(result.uri)).toEqual({
      content: '{"ok":true}', options: { encoding: 'utf8' },
    });
  });

  test('comparte un documento JSON cuando Sharing está disponible', async () => {
    const result = await compartirDocumentoBackup({ contenido: '{}', nombre: 'backup.json' });
    expect(result).toMatchObject({ cancelado: false, mimeType: BACKUP_MIME_TYPE });
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringMatching(/backup\.json$/),
      expect.objectContaining({ mimeType: BACKUP_MIME_TYPE, UTI: 'public.json' })
    );
  });

  test('informa cuando Sharing no está disponible', async () => {
    sharing.__setAvailable(false);
    await expect(compartirDocumentoBackup({ contenido: '{}', nombre: 'backup.json' }))
      .rejects.toMatchObject({ code: 'COMPARTIR_NO_DISPONIBLE' });
    expect(sharing.shareAsync).not.toHaveBeenCalled();
  });

  test('limpia el archivo temporal después de compartir con éxito', async () => {
    await compartirDocumentoBackup({ contenido: '{}', nombre: 'backup.json' });
    expect(fileSystem.__list()).toEqual([]);
  });

  test('limpia el archivo temporal también si compartir falla', async () => {
    sharing.__setShareFailure(new Error('share canceled'));
    await expect(compartirDocumentoBackup({ contenido: '{}', nombre: 'backup.json' }))
      .rejects.toMatchObject({ code: 'COMPARTIR_FALLIDO' });
    expect(fileSystem.__list()).toEqual([]);
  });

  test('acepta un JSON seleccionado desde Document Picker', () => {
    expect(validarArchivoJSONSeleccionado({
      uri: 'content://downloads/backup', name: 'backup.json', mimeType: BACKUP_MIME_TYPE,
    })).toMatchObject({ name: 'backup.json' });
  });

  test('rechaza una extensión que no sea JSON', () => {
    expect(() => validarArchivoJSONSeleccionado({
      uri: 'content://downloads/backup', name: 'backup.txt', mimeType: 'text/plain',
    })).toThrow(/\.json/i);
  });
});

const fileSystem = require('expo-file-system');
const legacyFileSystem = require('expo-file-system/legacy');
const sharing = require('expo-sharing');
const {
  BACKUP_MIME_TYPE,
  compartirDocumentoBackup,
  crearNombreArchivoBackup,
  guardarDocumentoBackup,
  serializarBackup,
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

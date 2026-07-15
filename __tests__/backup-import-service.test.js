const fixture = require('./fixtures/v5-synthetic-fixture.json');

function cloneFixture() {
  return JSON.parse(JSON.stringify(fixture));
}

async function loadSubject() {
  jest.resetModules();
  const sqlite = require('expo-sqlite');
  const fileSystem = require('expo-file-system');
  const { Image } = require('react-native');
  Image.getSize = jest.fn((uri, success) => success(700, 1050));
  sqlite.__reset();
  fileSystem.__reset();
  const database = require('../src/database');
  const service = require('../src/services/backupImportService');
  await database.inicializarBaseDeDatos();
  return {
    sqlite,
    fileSystem,
    database,
    service,
    db: await database.getDatabase(),
  };
}

describe('backupImportService', () => {
  test('valida tipo, versión y colecciones opcionales', async () => {
    const { service } = await loadSubject();

    expect(() => service.validateBackupDocument({ tipo: 'otro', version: 5 })).toThrow(/Mi Biblioteca/i);
    expect(() => service.validateBackupDocument({ tipo: service.BACKUP_TYPE, version: 99 })).toThrow(/más nueva/i);
    expect(() => service.validateBackupDocument({
      tipo: service.BACKUP_TYPE,
      version: 5,
      libros: {},
    })).toThrow(/debe ser un array/i);

    const { backup, summary } = service.validateBackupDocument({
      tipo: service.BACKUP_TYPE,
      version: 5,
      libros: [],
    });
    expect(backup).toMatchObject({
      lista_compras: [], etiquetas: [], libro_etiquetas: [], sesiones_lectura: [],
    });
    expect(summary).toMatchObject({ version: 5, libros: 0, lista_compras: 0 });
  });

  test('normaliza ISBN y detecta solamente imágenes Base64 conocidas', async () => {
    const { service } = await loadSubject();

    expect(service.normalizeBackupISBN(' ISBN 978-0-306-40615-7 ')).toBe('9780306406157');
    expect(service.detectBase64Image('/9j/4AAQSkZJRgABAQAAAQABAAD/2w')).toMatchObject({
      mimeType: 'image/jpeg', extension: 'jpg',
    });
    expect(service.detectBase64Image('dGV4dG8gcXVlIG5vIGVzIHVuYSBpbWFnZW4=')).toBeNull();
  });

  test('escribe una portada Base64 válida y rechaza una corrupta', async () => {
    const { service, fileSystem } = await loadSubject();

    const uri = await service.writeBackupCover('/9j/4AAQSkZJRgABAQAAAQABAAD/2w==');
    expect(uri).toMatch(/^file:\/\/\/virtual\/document\/portadas\//);
    expect(fileSystem.__has(uri)).toBe(true);
    await expect(service.writeBackupCover('esto-no-es-base64')).rejects.toThrow(/Base64/i);
  });

  test('importa v5, reconstruye IDs antiguos y nunca reutiliza una ruta privada', async () => {
    const { service, db, sqlite } = await loadSubject();

    const result = await service.importPreparedBackup({ db, document: cloneFixture() });
    const state = sqlite.__getState();

    expect(result.libros).toMatchObject({ creados: 2, rechazados: 0 });
    expect(state.misLibros).toHaveLength(2);
    expect(state.misLibros.find((book) => book.titulo === 'Meditaciones')).toMatchObject({
      isbn: '9780306406157', pagina_actual: 163, paginas_totales: 212, estado: 'leyendo',
    });
    expect(state.misLibros.find((book) => book.titulo === 'Meditaciones').portada_url)
      .toMatch(/^file:\/\/\/virtual\/document\/portadas\//);
    expect(state.misLibros.some((book) => book.portada_url?.startsWith('file:///data/user/0/'))).toBe(false);
    expect(state.libroEtiquetas).toEqual([
      expect.objectContaining({
        libro_uuid: 'book-meditaciones-0001', etiqueta_uuid: 'tag-filosofia-000001',
      }),
    ]);
    expect(state.sesionesLectura).toEqual([
      expect.objectContaining({ libro_uuid: 'book-meditaciones-0001', duracion_segundos: 1800 }),
    ]);
  });

  test('fusionar dos veces es idempotente para libros, deseos, relaciones y sesiones', async () => {
    const { service, db, sqlite } = await loadSubject();
    const backup = cloneFixture();

    await service.importPreparedBackup({ db, document: backup });
    await service.importPreparedBackup({ db, document: backup });

    const state = sqlite.__getState();
    expect(state.misLibros).toHaveLength(2);
    expect(state.listaCompras).toHaveLength(1);
    expect(state.etiquetas).toHaveLength(1);
    expect(state.libroEtiquetas).toHaveLength(1);
    expect(state.sesionesLectura).toHaveLength(1);
  });

  test('deduplica por ISBN equivalente y conserva el progreso local útil', async () => {
    const { service, db, sqlite, database } = await loadSubject();
    await database.insertarLibro({
      uuid: 'book-local-existing-001',
      isbn: '0306406152',
      titulo: 'Título local',
      autor: 'Autor local',
      paginas_totales: 300,
      pagina_actual: 190,
      estado: 'leyendo',
    });
    const backup = cloneFixture();
    backup.libros = [backup.libros[0]];
    backup.lista_compras = [];
    backup.etiquetas = [];
    backup.libro_etiquetas = [];
    backup.sesiones_lectura = [];

    const result = await service.importPreparedBackup({ db, document: backup });

    expect(sqlite.__getState().misLibros).toHaveLength(1);
    expect(sqlite.__getState().misLibros[0]).toMatchObject({
      uuid: 'book-local-existing-001', pagina_actual: 190,
    });
    expect(result.libros.actualizados).toBe(1);
  });

  test('deduplica por título y autor cuando no hay UUID ni ISBN confiable', async () => {
    const { service, db, sqlite, database } = await loadSubject();
    await database.insertarLibro({
      titulo: ' Libro sin identificadores ', autor: 'AUTORA SINTÉTICA', pagina_actual: 0,
    });
    const backup = cloneFixture();
    backup.libros = [backup.libros[1]];
    backup.lista_compras = [];
    backup.etiquetas = [];
    backup.libro_etiquetas = [];
    backup.sesiones_lectura = [];

    await service.importPreparedBackup({ db, document: backup });
    expect(sqlite.__getState().misLibros).toHaveLength(1);
  });

  test('rechaza progreso inválido sin perder los registros válidos', async () => {
    const { service, db, sqlite } = await loadSubject();
    const backup = cloneFixture();
    backup.libros[0].pagina_actual = 300;

    const result = await service.importPreparedBackup({ db, document: backup });

    expect(result.libros.rechazados).toBe(1);
    expect(sqlite.__getState().misLibros).toEqual([
      expect.objectContaining({ titulo: 'Libro sin identificadores' }),
    ]);
  });

  test('una portada corrupta es advertencia recuperable y usa fallback seguro', async () => {
    const { service, db, sqlite } = await loadSubject();
    const backup = cloneFixture();
    backup.libros = [{
      ...backup.libros[0],
      portada_base64: 'dGV4dG8=',
      portada_url: 'file:///data/user/0/origen/portada.jpg',
    }];
    backup.lista_compras = [];
    backup.etiquetas = [];
    backup.libro_etiquetas = [];
    backup.sesiones_lectura = [];

    const result = await service.importPreparedBackup({ db, document: backup });

    expect(result.advertencias).toEqual(expect.arrayContaining([expect.stringMatching(/Portada/)]));
    expect(sqlite.__getState().misLibros[0].portada_url).toBeNull();
  });

  test('reemplazar exige confirmación explícita', async () => {
    const { service, db, sqlite, database } = await loadSubject();
    await database.insertarLibro({ titulo: 'Dato local protegido' });

    await expect(service.importPreparedBackup({
      db, document: cloneFixture(), mode: service.IMPORT_MODES.REPLACE,
    })).rejects.toThrow(/confirmación explícita/i);
    expect(sqlite.__getState().misLibros[0].titulo).toBe('Dato local protegido');

    await service.importPreparedBackup({
      db,
      document: cloneFixture(),
      mode: service.IMPORT_MODES.REPLACE,
      replaceConfirmed: true,
    });
    expect(sqlite.__getState().misLibros).toHaveLength(2);
    expect(sqlite.__getState().misLibros.some((book) => book.titulo === 'Dato local protegido')).toBe(false);
  });

  test('un error fatal revierte SQLite y limpia las portadas creadas', async () => {
    const { service, db, sqlite, fileSystem, database } = await loadSubject();
    await database.insertarLibro({
      uuid: 'book-meditaciones-0001', titulo: 'Local antes del fallo', pagina_actual: 10,
    });
    sqlite.__failNextBookUpdate(new Error('fallo SQLite forzado'));
    const createdUri = 'file:///virtual/document/portadas/creada-antes-del-fallo.jpg';
    const writeCover = jest.fn(async () => {
      const file = new fileSystem.File(createdUri);
      file.create();
      file.write('imagen');
      return file.uri;
    });
    const backup = cloneFixture();
    backup.libros = [backup.libros[0]];
    backup.lista_compras = [];
    backup.etiquetas = [];
    backup.libro_etiquetas = [];
    backup.sesiones_lectura = [];

    await expect(service.importPreparedBackup({ db, document: backup, writeCover }))
      .rejects.toThrow('fallo SQLite forzado');

    expect(sqlite.__getState().misLibros).toEqual([
      expect.objectContaining({ titulo: 'Local antes del fallo', pagina_actual: 10 }),
    ]);
    expect(fileSystem.__has(createdUri)).toBe(false);
  });
});

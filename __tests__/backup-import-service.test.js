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

  test('mantiene compatibilidad de importación para backups v2 a v7', async () => {
    const { service, db, sqlite } = await loadSubject();

    for (const version of [2, 3, 4, 5, 6, 7]) {
      await service.importPreparedBackup({
        db,
        document: {
          tipo: service.BACKUP_TYPE,
          version,
          libros: [{
            uuid: `book-compat-v${version}-0001`,
            titulo: `Compat v${version}`,
            estado: 'quiero leer',
            pagina_actual: 0,
          }],
          lista_compras: [],
          etiquetas: [],
          libro_etiquetas: [],
          sesiones_lectura: [],
        },
      });
    }

    expect(sqlite.__getState().misLibros.map((book) => book.titulo)).toEqual([
      'Compat v2', 'Compat v3', 'Compat v4', 'Compat v5', 'Compat v6', 'Compat v7',
    ]);
  });

  test('importa v7 preservando libros, relaciones y sesiones completas', async () => {
    const { service, db, sqlite, database } = await loadSubject();
    const backup = {
      tipo: service.BACKUP_TYPE,
      version: 7,
      fecha_exportacion: '2026-07-24T10:00:00.000Z',
      libros: [{
        uuid: 'book-v7-roundtrip-0001',
        isbn: '9780306406157',
        titulo: 'Backup v7 completo',
        autor: 'Autora',
        portada_url: null,
        portada_base64: null,
        paginas_totales: 240,
        pagina_actual: 80,
        estado: 'leyendo',
        calificacion: 4,
        notas: 'Nota general',
        fecha_agregado: '2026-07-01T09:00:00.000Z',
        fecha_inicio_lectura: '2026-07-03',
        fecha_fin: null,
      }],
      lista_compras: [{
        uuid: 'wish-v7-roundtrip-0001',
        titulo: 'Deseo v7',
        autor: 'Autor deseo',
        prioridad: 'alta',
        precio_estimado: 12.5,
        fecha_agregado: '2026-07-02T00:00:00.000Z',
        estado: 'adquirido',
        fecha_resolucion: '2026-07-04T00:00:00.000Z',
        libro_uuid_adquirido: 'book-v7-roundtrip-0001',
      }],
      etiquetas: [{ uuid: 'tag-v7-roundtrip-0001', nombre: 'Ensayo' }],
      libro_etiquetas: [{ libro_uuid: 'book-v7-roundtrip-0001', etiqueta_uuid: 'tag-v7-roundtrip-0001' }],
      sesiones_lectura: [{
        uuid: 'ses-v7-active-0001',
        libro_uuid: 'book-v7-roundtrip-0001',
        fecha: '2026-07-10',
        hora_inicio: '2026-07-10T10:00:00.000Z',
        hora_fin: null,
        paginas_leidas: 0,
        pagina_inicio: 80,
        pagina_fin: null,
        duracion_segundos: null,
        estado: 'activa',
        origen: 'cronometro',
        nota: 'Activa preservada',
        duracion_acumulada_segundos: 955,
        ultimo_inicio: '2026-07-10T10:10:00.000Z',
        pausada_en: '2026-07-10T10:25:55.000Z',
        fecha_creacion: '2026-07-10T10:00:00.000Z',
        fecha_actualizacion: '2026-07-10T10:25:55.000Z',
        editada: 1,
      }, {
        uuid: 'ses-v7-pending-0001',
        libro_uuid: 'book-v7-roundtrip-0001',
        fecha: '2026-07-09',
        hora_inicio: '2026-07-09T11:00:00.000Z',
        hora_fin: '2026-07-09T11:45:00.000Z',
        paginas_leidas: 0,
        pagina_inicio: 60,
        pagina_fin: null,
        duracion_segundos: 2700,
        estado: 'pendiente',
        origen: 'cronometro',
        nota: 'Faltan páginas',
        duracion_acumulada_segundos: 2700,
        ultimo_inicio: null,
        pausada_en: null,
        fecha_creacion: '2026-07-09T11:00:00.000Z',
        fecha_actualizacion: '2026-07-09T11:45:00.000Z',
        editada: 0,
      }, {
        uuid: 'ses-v7-manual-0001',
        libro_uuid: 'book-v7-roundtrip-0001',
        fecha: '2026-07-08',
        hora_inicio: '2026-07-08T08:00:00.000Z',
        hora_fin: '2026-07-08T08:30:30.000Z',
        paginas_leidas: 12,
        pagina_inicio: 48,
        pagina_fin: 60,
        duracion_segundos: 1830,
        estado: 'completada',
        origen: 'manual',
        nota: 'Manual exacta',
        duracion_acumulada_segundos: 1830,
        ultimo_inicio: null,
        pausada_en: null,
        fecha_creacion: '2026-07-08T08:00:00.000Z',
        fecha_actualizacion: '2026-07-08T08:30:30.000Z',
        editada: 1,
      }],
    };

    const result = await service.importPreparedBackup({ db, document: backup });
    await service.importPreparedBackup({ db, document: backup });

    const state = sqlite.__getState();
    expect(result.version).toBe(7);
    expect(state.misLibros).toEqual([expect.objectContaining({
      uuid: 'book-v7-roundtrip-0001',
      fecha_inicio_lectura: '2026-07-03',
      notas: 'Nota general',
    })]);
    expect(state.listaCompras).toEqual([expect.objectContaining({
      uuid: 'wish-v7-roundtrip-0001',
      estado: 'adquirido',
      libro_uuid_adquirido: 'book-v7-roundtrip-0001',
    })]);
    expect(state.libroEtiquetas).toEqual([
      expect.objectContaining({ libro_uuid: 'book-v7-roundtrip-0001', etiqueta_uuid: 'tag-v7-roundtrip-0001' }),
    ]);
    expect(state.sesionesLectura).toHaveLength(3);
    expect(state.sesionesLectura).toEqual(expect.arrayContaining([
      expect.objectContaining({
        uuid: 'ses-v7-active-0001',
        estado: 'activa',
        nota: 'Activa preservada',
        duracion_acumulada_segundos: 955,
        pausada_en: '2026-07-10T10:25:55.000Z',
      }),
      expect.objectContaining({
        uuid: 'ses-v7-pending-0001',
        estado: 'pendiente',
        pagina_fin: null,
        duracion_segundos: 2700,
      }),
      expect.objectContaining({
        uuid: 'ses-v7-manual-0001',
        origen: 'manual',
        nota: 'Manual exacta',
        duracion_segundos: 1830,
        editada: 1,
      }),
    ]));
    await expect(database.obtenerSesionActiva('book-v7-roundtrip-0001')).resolves.toMatchObject({
      uuid: 'ses-v7-active-0001',
      estado: 'activa',
    });
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

  test('rechaza una sesión activa importada si ya existe otra activa local y conserva SQLite', async () => {
    const { service, db, sqlite, database } = await loadSubject();
    const localId = await database.insertarLibro({ uuid: 'book-local-active-0001', titulo: 'Local activo' });
    const localBook = await database.obtenerLibroPorId(localId);
    await database.iniciarSesionLectura(localBook.uuid, 0);
    const backup = {
      tipo: service.BACKUP_TYPE,
      version: 7,
      libros: [{ uuid: 'book-import-active-0001', titulo: 'Import activo', estado: 'leyendo', pagina_actual: 0 }],
      lista_compras: [],
      etiquetas: [],
      libro_etiquetas: [],
      sesiones_lectura: [{
        uuid: 'ses-import-active-0001',
        libro_uuid: 'book-import-active-0001',
        fecha: '2026-07-11',
        hora_inicio: '2026-07-11T10:00:00.000Z',
        hora_fin: null,
        paginas_leidas: 0,
        pagina_inicio: 0,
        pagina_fin: null,
        duracion_segundos: null,
        estado: 'activa',
        origen: 'cronometro',
        nota: null,
        duracion_acumulada_segundos: 60,
        ultimo_inicio: '2026-07-11T10:00:00.000Z',
        pausada_en: null,
        fecha_creacion: '2026-07-11T10:00:00.000Z',
        fecha_actualizacion: '2026-07-11T10:00:00.000Z',
        editada: 0,
      }],
    };

    await expect(service.importPreparedBackup({ db, document: backup }))
      .rejects.toThrow(/sesión activa/i);
    expect(sqlite.__getState().misLibros).toHaveLength(1);
    await expect(database.obtenerSesionActiva(localBook.uuid)).resolves.toMatchObject({ libro_uuid: localBook.uuid });
  });

  test('replace revierte SQLite y limpia portada creada si falla dentro de la transacción', async () => {
    const { service, db, sqlite, fileSystem, database } = await loadSubject();
    await database.insertarLibro({ uuid: 'book-local-replace-01', titulo: 'Local protegido' });
    await db.execAsync(`
      CREATE TRIGGER fallo_insert_wp01
      BEFORE INSERT ON mis_libros
      BEGIN
        SELECT RAISE(ABORT, 'fallo insert replace wp01');
      END;
    `);
    const createdUri = 'file:///virtual/document/portadas/wp01-creada.jpg';
    const writeCover = jest.fn(async () => {
      const file = new fileSystem.File(createdUri);
      file.create();
      file.write('imagen');
      return file.uri;
    });
    const backup = {
      tipo: service.BACKUP_TYPE,
      version: 7,
      libros: [{
        uuid: 'book-import-replace-01',
        titulo: 'Import reemplazo',
        estado: 'quiero leer',
        pagina_actual: 0,
        portada_base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2w==',
      }],
      lista_compras: [],
      etiquetas: [],
      libro_etiquetas: [],
      sesiones_lectura: [],
    };

    await expect(service.importPreparedBackup({
      db,
      document: backup,
      mode: service.IMPORT_MODES.REPLACE,
      replaceConfirmed: true,
      writeCover,
    })).rejects.toThrow(/fallo insert replace wp01/i);

    expect(sqlite.__getState().misLibros).toEqual([
      expect.objectContaining({ uuid: 'book-local-replace-01', titulo: 'Local protegido' }),
    ]);
    expect(fileSystem.__has(createdUri)).toBe(false);
  });

  test('rechaza datos v7 inválidos sin importación parcial silenciosa', async () => {
    const { service } = await loadSubject();
    const base = {
      tipo: service.BACKUP_TYPE,
      version: 7,
      libros: [{ uuid: 'book-valid-invalid-01', titulo: 'Libro válido', estado: 'leyendo', pagina_actual: 0 }],
      lista_compras: [],
      etiquetas: [],
      libro_etiquetas: [],
      sesiones_lectura: [],
    };

    expect(() => service.validateBackupDocument({ tipo: service.BACKUP_TYPE, version: 1, libros: [] }))
      .toThrow(/no es compatible/i);
    expect(() => service.validateBackupDocument({ tipo: service.BACKUP_TYPE, version: 7, libros: {}, sesiones_lectura: [] }))
      .toThrow(/debe ser un array/i);

    const invalidRows = [
      { libros: [{ ...base.libros[0], uuid: '' }], warning: /UUID/i },
      { libros: [{ ...base.libros[0], estado: 'desconocido' }], warning: /estado/i },
      { sesiones_lectura: [{ uuid: 'ses-invalid-origin1', libro_uuid: 'book-valid-invalid-01', fecha: '2026-07-01', hora_inicio: '2026-07-01T10:00:00.000Z', hora_fin: '2026-07-01T10:10:00.000Z', paginas_leidas: 1, pagina_inicio: 0, pagina_fin: 1, duracion_segundos: 600, estado: 'completada', origen: 'papel' }], warning: /sesión/i },
      { sesiones_lectura: [{ uuid: 'ses-invalid-date001', libro_uuid: 'book-valid-invalid-01', fecha: '2026-02-31', hora_inicio: '2026-07-01T10:00:00.000Z', hora_fin: '2026-07-01T10:10:00.000Z', paginas_leidas: 1, pagina_inicio: 0, pagina_fin: 1, duracion_segundos: 600, estado: 'completada', origen: 'manual' }], warning: /sesión/i },
      { sesiones_lectura: [{ uuid: 'ses-invalid-dur-0001', libro_uuid: 'book-valid-invalid-01', fecha: '2026-07-01', hora_inicio: '2026-07-01T10:00:00.000Z', hora_fin: '2026-07-01T10:10:00.000Z', paginas_leidas: 1, pagina_inicio: 0, pagina_fin: 1, duracion_segundos: -1, estado: 'completada', origen: 'manual' }], warning: /sesión/i },
      { sesiones_lectura: [{ uuid: 'ses-invalid-page001', libro_uuid: 'book-valid-invalid-01', fecha: '2026-07-01', hora_inicio: '2026-07-01T10:00:00.000Z', hora_fin: '2026-07-01T10:10:00.000Z', paginas_leidas: 1, pagina_inicio: 10, pagina_fin: 1, duracion_segundos: 600, estado: 'completada', origen: 'manual' }], warning: /sesión/i },
      { sesiones_lectura: [{ uuid: 'ses-invalid-orphan1', libro_uuid: 'book-missing-invalid', fecha: '2026-07-01', hora_inicio: '2026-07-01T10:00:00.000Z', hora_fin: '2026-07-01T10:10:00.000Z', paginas_leidas: 1, pagina_inicio: 0, pagina_fin: 1, duracion_segundos: 600, estado: 'completada', origen: 'manual' }], warning: /huérfana/i },
    ];

    for (const scenario of invalidRows) {
      const subject = await loadSubject();
      const backup = {
        ...base,
        libros: scenario.libros || base.libros,
        sesiones_lectura: scenario.sesiones_lectura || [],
      };
      const result = await subject.service.importPreparedBackup({ db: subject.db, document: backup });
      expect(result.advertencias.join('\n')).toMatch(scenario.warning);
    }
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

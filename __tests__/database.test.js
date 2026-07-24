function loadSubject() {
  jest.resetModules();
  const sqlite = require('expo-sqlite');
  const fileSystem = require('expo-file-system');
  const documentPicker = require('expo-document-picker');
  sqlite.__reset();
  fileSystem.__reset();
  documentPicker.__reset();
  return {
    sqlite,
    fileSystem,
    documentPicker,
    database: require('../src/database'),
  };
}

describe('integridad de database.js', () => {
  test('migra una base versión 5 sin inventar páginas históricas y deriva duraciones válidas', async () => {
    jest.resetModules();
    const sqlite = require('expo-sqlite');
    sqlite.__reset();
    const dbV5 = await sqlite.openDatabaseAsync('biblioteca.db');
    await dbV5.execAsync(`
      CREATE TABLE lista_compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, titulo TEXT NOT NULL,
        autor TEXT, prioridad TEXT, precio_estimado REAL, fecha_agregado TEXT
      );
      CREATE TABLE sesiones_lectura (
        id INTEGER PRIMARY KEY AUTOINCREMENT, libro_uuid TEXT NOT NULL, fecha TEXT NOT NULL,
        hora_inicio TEXT NOT NULL, hora_fin TEXT, paginas_leidas INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO lista_compras (uuid, titulo, prioridad, fecha_agregado)
      VALUES ('wishlist-legacy-0001', 'Deseo histórico', 'media', '2026-01-01T00:00:00.000Z');
      INSERT INTO sesiones_lectura (libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas)
      VALUES
        ('book-legacy-00001', '2026-01-02', '2026-01-02T10:00:00.000Z', '2026-01-02T10:30:00.000Z', 20),
        ('book-legacy-00002', '2026-01-03', '2026-01-03T11:00:00.000Z', '2026-01-03T10:00:00.000Z', 15),
        ('book-legacy-00003', '2026-01-04', '2026-01-04T10:00:00.000Z', '2026-01-04T11:00:00.000Z', 0),
        ('book-legacy-open1', '2026-01-05', '2026-01-05T10:00:00.000Z', NULL, 0),
        ('book-legacy-open2', '2026-01-05', '2026-01-05T11:00:00.000Z', NULL, 0);
      PRAGMA user_version = 5;
    `);
    const database = require('../src/database');

    await database.inicializarBaseDeDatos();

    const version = await dbV5.getFirstAsync('PRAGMA user_version');
    const sesiones = await dbV5.getAllAsync('SELECT * FROM sesiones_lectura ORDER BY id');
    const deseo = await dbV5.getFirstAsync('SELECT * FROM lista_compras');
    expect(version.user_version).toBe(7);
    expect(sesiones[0]).toMatchObject({
      paginas_leidas: 20,
      pagina_inicio: null,
      pagina_fin: null,
      duracion_segundos: 1800,
      estado: 'completada',
      origen: 'cronometro',
      uuid: expect.stringMatching(/^ses-/),
    });
    expect(sesiones[1]).toMatchObject({
      paginas_leidas: 15,
      pagina_inicio: null,
      pagina_fin: null,
      duracion_segundos: null,
      estado: 'completada',
    });
    expect(sesiones[2]).toMatchObject({
      paginas_leidas: 0, pagina_fin: null, duracion_segundos: 3600, estado: 'pendiente',
    });
    expect(sesiones[3]).toMatchObject({
      paginas_leidas: 0, pagina_fin: null, duracion_segundos: 1, estado: 'pendiente',
    });
    expect(sesiones[4]).toMatchObject({
      paginas_leidas: 0, pagina_fin: null, estado: 'activa',
    });
    expect(deseo).toMatchObject({ estado: 'activo', fecha_resolucion: null, libro_uuid_adquirido: null });
  });

  test('aplica migraciones hasta user_version 7 y crea sesiones, etiquetas, FTS5 e índices', async () => {
    const { database, sqlite } = loadSubject();

    await database.inicializarBaseDeDatos();

    const state = sqlite.__getState();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith('biblioteca.db', {
      finalizeUnusedStatementsBeforeClosing: false,
    });
    expect(state.userVersion).toBe(7);
    expect([...state.tables]).toEqual(expect.arrayContaining([
      'mis_libros',
      'lista_compras',
      'etiquetas',
      'libro_etiquetas',
      'mis_libros_fts',
      'sesiones_lectura',
    ]));
    expect([...state.columns.mis_libros]).toEqual(expect.arrayContaining(['fecha_fin', 'fecha_inicio_lectura', 'uuid']));
    expect([...state.columns.lista_compras]).toContain('uuid');
    expect([...state.columns.lista_compras]).toEqual(expect.arrayContaining([
      'estado', 'fecha_resolucion', 'libro_uuid_adquirido',
    ]));
    const db = await database.getDatabase();
    const columnasSesion = await db.getAllAsync('PRAGMA table_info(sesiones_lectura)');
    expect(columnasSesion.map((column) => column.name)).toEqual(expect.arrayContaining([
      'pagina_inicio', 'pagina_fin', 'duracion_segundos',
    ]));
    expect([...state.indexes]).toEqual(expect.arrayContaining([
      'idx_mis_libros_uuid',
      'idx_lista_compras_uuid',
      'idx_mis_libros_estado',
      'idx_mis_libros_fecha_fin',
      'idx_libro_etiquetas_etiqueta',
      'idx_sesiones_fecha',
      'idx_sesiones_libro',
      'idx_sesion_activa_por_libro',
      'idx_sesiones_libro_hora_inicio',
      'idx_sesiones_uuid',
      'idx_sesion_activa_global',
      'idx_sesiones_libro_estado_fecha',
      'idx_lista_compras_estado_fecha',
    ]));
    expect([...state.triggers]).toEqual(expect.arrayContaining([
      'mis_libros_fts_insert',
      'mis_libros_fts_delete',
      'mis_libros_fts_update',
    ]));

    await database.inicializarBaseDeDatos();
    expect(sqlite.__getState().userVersion).toBe(7);
  });

  test('registra una sesión, calcula páginas y expone métricas mensuales reales', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T14:00:00.000Z'));
    try {
      const { database } = loadSubject();
      await database.inicializarBaseDeDatos();
      const bookId = await database.insertarLibro({
        titulo: 'Lectura medida',
        autor: 'Autora',
        paginas_totales: 300,
        pagina_actual: 40,
        estado: 'leyendo',
      });
      const book = await database.obtenerLibroPorId(bookId);

      const active = await database.iniciarSesionLectura(book.uuid, 40);
      expect(active).toMatchObject({
        libro_uuid: book.uuid,
        hora_fin: null,
        paginas_leidas: 0,
        pagina_inicio: 40,
        pagina_fin: null,
        duracion_segundos: null,
      });
      await expect(database.obtenerSesionActiva(book.uuid)).resolves.toMatchObject({ id: active.id });

      jest.setSystemTime(new Date('2026-07-11T14:45:00.000Z'));
      const finished = await database.terminarSesionLectura(book.uuid, 65);
      expect(finished).toMatchObject({
        paginas_leidas: 25,
        pagina_inicio: 40,
        pagina_fin: 65,
        duracion_segundos: 2700,
        minutos: 45,
      });
      await expect(database.obtenerSesionActiva(book.uuid)).resolves.toBeNull();
      await expect(database.obtenerLibroPorId(bookId)).resolves.toMatchObject({ pagina_actual: 65 });
      const db = await database.getDatabase();
      await expect(db.runAsync(
        `INSERT INTO sesiones_lectura
          (libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas)
         VALUES (?, ?, ?, ?, ?)`,
        book.uuid,
        active.fecha,
        active.hora_inicio,
        finished.hora_fin,
        25
      )).rejects.toThrow(/UNIQUE/i);

      const chronicles = await database.obtenerCronicas();
      expect(chronicles.metricas).toMatchObject({
        paginas_acumuladas: 65,
        paginas_mes: 25,
        minutos_mes: 45,
        racha_dias: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('revierte el cierre de sesión si falla la actualización de progreso', async () => {
    const { database, sqlite } = loadSubject();
    await database.inicializarBaseDeDatos();
    const bookId = await database.insertarLibro({
      titulo: 'Sesión atómica',
      paginas_totales: 120,
      pagina_actual: 10,
      estado: 'leyendo',
    });
    const book = await database.obtenerLibroPorId(bookId);
    const active = await database.iniciarSesionLectura(book.uuid, 10);
    sqlite.__failNextBookUpdate(new Error('fallo forzado al actualizar progreso'));

    await expect(database.terminarSesionLectura(book.uuid, 25)).rejects.toThrow('fallo forzado');

    await expect(database.obtenerSesionActiva(book.uuid)).resolves.toMatchObject({
      id: active.id,
      hora_fin: null,
      paginas_leidas: 0,
      pagina_inicio: 10,
    });
    await expect(database.obtenerLibroPorId(bookId)).resolves.toMatchObject({ pagina_actual: 10 });
  });

  test('busca por prefijo con FTS5 y combina el filtro de etiquetas', async () => {
    const { database } = loadSubject();
    await database.inicializarBaseDeDatos();
    const cienId = await database.insertarLibro({
      titulo: 'Cien años de soledad',
      autor: 'Gabriel García Márquez',
      estado: 'quiero leer',
      pagina_actual: 0,
    });
    await database.insertarLibro({
      titulo: 'El Aleph',
      autor: 'Jorge Luis Borges',
      estado: 'quiero leer',
      pagina_actual: 0,
    });
    const cien = await database.obtenerLibroPorId(cienId);
    const clasico = await database.crearEtiqueta('Clásicos');
    await database.asignarEtiquetaALibro(cien.uuid, clasico.uuid);

    await expect(database.obtenerEtiquetasDeLibro(cien.uuid)).resolves.toEqual([
      expect.objectContaining({ uuid: clasico.uuid, nombre: 'Clásicos' }),
    ]);

    await expect(database.buscarLibros({ texto: 'soled' })).resolves.toEqual([
      expect.objectContaining({ titulo: 'Cien años de soledad' }),
    ]);
    await expect(database.buscarLibros({ texto: 'gabriel', etiquetaUuid: clasico.uuid })).resolves.toEqual([
      expect.objectContaining({ uuid: cien.uuid }),
    ]);
    await expect(database.buscarLibros({ texto: 'borges', etiquetaUuid: clasico.uuid })).resolves.toEqual([]);
    await expect(database.obtenerEtiquetas()).resolves.toEqual([
      expect.objectContaining({ nombre: 'Clásicos', cantidad: 1 }),
    ]);
  });

  test('detecta como duplicados el ISBN-10 y su ISBN-13 equivalente', async () => {
    const { database } = loadSubject();
    await database.inicializarBaseDeDatos();
    const id = await database.insertarLibro({
      isbn: '0306406152',
      titulo: 'Edición equivalente',
      estado: 'quiero leer',
      pagina_actual: 0,
    });

    await expect(database.obtenerLibroPorISBN('9780306406157')).resolves.toMatchObject({ id });
  });

  test('restaurar dos veces el mismo UUID actualiza sin duplicar filas', async () => {
    const { database, sqlite, fileSystem, documentPicker } = loadSubject();
    await database.inicializarBaseDeDatos();
    const backupFile = new fileSystem.File(fileSystem.Paths.cache, 'backup.json');
    backupFile.create();

    const backup = {
      tipo: 'mi-biblioteca-backup',
      version: 2,
      libros: [{
        uuid: '12345678-1234-4234-8234-123456789abc',
        isbn: null,
        titulo: 'Primera versión',
        autor: 'Autora',
        portada_url: null,
        paginas_totales: 200,
        pagina_actual: 20,
        estado: 'leyendo',
        calificacion: null,
        notas: null,
        fecha_agregado: '2026-01-01T00:00:00.000Z',
      }],
    };
    backupFile.write(JSON.stringify(backup));
    documentPicker.__setResult({ canceled: false, assets: [{ uri: backupFile.uri }] });

    await database.importarBackupJSON();
    backup.libros[0].titulo = 'Versión actualizada';
    backupFile.write(JSON.stringify(backup));
    await database.importarBackupJSON();

    const rows = sqlite.__getState().misLibros;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uuid: backup.libros[0].uuid,
      titulo: 'Versión actualizada',
    });
  });

  test('exporta un backup versión 6 con todas las entidades relacionadas', async () => {
    const { database } = loadSubject();
    await database.inicializarBaseDeDatos();
    const bookId = await database.insertarLibro({
      titulo: 'Libro respaldado', autor: 'Autora', paginas_totales: 180,
      pagina_actual: 12, estado: 'leyendo',
    });
    const book = await database.obtenerLibroPorId(bookId);
    await database.addDeseo({ titulo: 'Deseo respaldado', prioridad: 'alta' });
    const etiqueta = await database.crearEtiqueta('Favoritos');
    await database.asignarEtiquetaALibro(book.uuid, etiqueta.uuid);
    await database.iniciarSesionLectura(book.uuid, 12);

    const documento = await database.crearDocumentoBackupJSON();
    const backup = JSON.parse(documento.contenido);

    expect(backup).toMatchObject({ tipo: 'mi-biblioteca-backup', version: 6 });
    expect(backup.libros).toEqual([expect.objectContaining({ uuid: book.uuid })]);
    expect(backup.lista_compras).toEqual([expect.objectContaining({ titulo: 'Deseo respaldado' })]);
    expect(backup.etiquetas).toEqual([expect.objectContaining({ uuid: etiqueta.uuid, nombre: 'Favoritos' })]);
    expect(backup.libro_etiquetas).toEqual([
      expect.objectContaining({ libro_uuid: book.uuid, etiqueta_uuid: etiqueta.uuid }),
    ]);
    expect(backup.sesiones_lectura).toEqual([
      expect.objectContaining({
        libro_uuid: book.uuid,
        hora_fin: null,
        paginas_leidas: 0,
        pagina_inicio: 12,
        pagina_fin: null,
        duracion_segundos: null,
      }),
    ]);
  });

  test('cancelar Document Picker no intenta importar', async () => {
    const { database } = loadSubject();
    await database.inicializarBaseDeDatos();
    await expect(database.seleccionarBackupParaImportar()).resolves.toEqual({ cancelado: true });
  });

  test('rechaza un archivo sin extensión JSON antes de leerlo', async () => {
    const { database, documentPicker } = loadSubject();
    await database.inicializarBaseDeDatos();
    documentPicker.__setResult({
      canceled: false,
      assets: [{ uri: 'content://downloads/respaldo.txt', name: 'respaldo.txt', mimeType: 'text/plain' }],
    });
    await expect(database.seleccionarBackupParaImportar()).rejects.toThrow(/\.json/i);
  });

  test('rechaza contenido JSON mal formado y refresca revisiones tras una importación válida', async () => {
    const { database, fileSystem, documentPicker } = loadSubject();
    const revisions = require('../src/database/revisions');
    await database.inicializarBaseDeDatos();
    const backupFile = new fileSystem.File(fileSystem.Paths.cache, 'respaldo.json');
    backupFile.create();
    backupFile.write('{mal formado');
    documentPicker.__setResult({
      canceled: false,
      assets: [{ uri: backupFile.uri, name: 'respaldo.json', mimeType: 'application/json' }],
    });
    await expect(database.seleccionarBackupParaImportar()).rejects.toThrow(/JSON válido/i);

    const before = revisions.getDatabaseRevisions();
    const result = await database.ejecutarImportacionBackup({
      tipo: 'mi-biblioteca-backup',
      version: 6,
      libros: [],
      lista_compras: [],
      etiquetas: [],
      libro_etiquetas: [],
      sesiones_lectura: [],
    });
    const after = revisions.getDatabaseRevisions();
    expect(result.modo).toBe('fusionar');
    expect(after.booksRevision).toBe(before.booksRevision + 1);
    expect(after.sessionsRevision).toBe(before.sessionsRevision + 1);
    expect(after.tagsRevision).toBe(before.tagsRevision + 1);
    expect(after.wishlistRevision).toBe(before.wishlistRevision + 1);
  });

  test('restaura todas las entidades sin duplicarlas al repetir la importación', async () => {
    const { database, sqlite, fileSystem, documentPicker } = loadSubject();
    await database.inicializarBaseDeDatos();
    const backupFile = new fileSystem.File(fileSystem.Paths.cache, 'backup-completo.json');
    backupFile.create();
    const bookUuid = 'aaaaaaaa-1234-4234-8234-123456789abc';
    const wishUuid = 'bbbbbbbb-1234-4234-8234-123456789abc';
    const tagUuid = 'cccccccc-1234-4234-8234-123456789abc';
    backupFile.write(JSON.stringify({
      tipo: 'mi-biblioteca-backup', version: 6,
      libros: [{
        uuid: bookUuid, titulo: 'Libro completo', autor: 'Autor', paginas_totales: 200,
        pagina_actual: 30, estado: 'leyendo', fecha_agregado: '2026-07-01T00:00:00.000Z',
      }],
      lista_compras: [{
        uuid: wishUuid, titulo: 'Deseo completo', prioridad: 'media',
        fecha_agregado: '2026-07-02T00:00:00.000Z',
        estado: 'adquirido', fecha_resolucion: '2026-07-05T00:00:00.000Z',
        libro_uuid_adquirido: bookUuid,
      }],
      etiquetas: [{ uuid: tagUuid, nombre: 'Ensayo' }],
      libro_etiquetas: [{ libro_uuid: bookUuid, etiqueta_uuid: tagUuid }],
      sesiones_lectura: [{
        libro_uuid: bookUuid, fecha: '2026-07-10', hora_inicio: '2026-07-10T10:00:00.000Z',
        hora_fin: '2026-07-10T10:30:00.000Z', paginas_leidas: 18,
        pagina_inicio: 30, pagina_fin: 48, duracion_segundos: 1800,
      }],
    }));
    documentPicker.__setResult({ canceled: false, assets: [{ uri: backupFile.uri }] });

    await database.importarBackupJSON();
    await database.importarBackupJSON();

    const state = sqlite.__getState();
    expect(state.misLibros).toHaveLength(1);
    expect(state.listaCompras).toEqual([
      expect.objectContaining({
        estado: 'adquirido', libro_uuid_adquirido: bookUuid,
        fecha_resolucion: '2026-07-05T00:00:00.000Z',
      }),
    ]);
    expect(state.etiquetas).toEqual([expect.objectContaining({ uuid: tagUuid, nombre: 'Ensayo' })]);
    expect(state.libroEtiquetas).toEqual([
      expect.objectContaining({ libro_uuid: bookUuid, etiqueta_uuid: tagUuid }),
    ]);
    expect(state.sesionesLectura).toEqual([
      expect.objectContaining({
        libro_uuid: bookUuid, paginas_leidas: 18,
        pagina_inicio: 30, pagina_fin: 48, duracion_segundos: 1800,
      }),
    ]);
  });

  test('revierte INSERT y conserva el deseo si falla la resolución final', async () => {
    const { database, sqlite } = loadSubject();
    await database.inicializarBaseDeDatos();
    const wishId = await database.addDeseo({
      titulo: 'Libro transaccional',
      autor: 'Autor',
      prioridad: 'alta',
    });
    const db = await database.getDatabase();
    await db.execAsync(`
      CREATE TRIGGER fallo_resolucion_deseo
      BEFORE UPDATE OF estado ON lista_compras
      WHEN new.estado = 'adquirido'
      BEGIN
        SELECT RAISE(ABORT, 'fallo forzado al resolver deseo');
      END;
    `);

    await expect(database.marcarComoAdquirido(wishId)).rejects.toThrow('fallo forzado');

    const state = sqlite.__getState();
    expect(state.misLibros).toHaveLength(0);
    expect(state.listaCompras).toHaveLength(1);
    expect(state.listaCompras[0]).toMatchObject({
      id: wishId,
      titulo: 'Libro transaccional',
      estado: 'activo',
      fecha_resolucion: null,
      libro_uuid_adquirido: null,
    });
  });

  test('impide duración negativa, página final invertida y doble finalización', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-12T14:00:00.000Z'));
    try {
      const { database } = loadSubject();
      await database.inicializarBaseDeDatos();
      const bookId = await database.insertarLibro({
        titulo: 'Sesión protegida', paginas_totales: 100, pagina_actual: 20, estado: 'leyendo',
      });
      const book = await database.obtenerLibroPorId(bookId);
      await database.iniciarSesionLectura(book.uuid, 20);

      await expect(database.terminarSesionLectura(book.uuid, 19)).rejects.toThrow(/menor/i);
      jest.setSystemTime(new Date('2026-07-12T13:59:00.000Z'));
      await expect(database.terminarSesionLectura(book.uuid, 25)).rejects.toThrow(/duración/i);
      await expect(database.obtenerSesionActiva(book.uuid)).resolves.toMatchObject({ pagina_inicio: 20, hora_fin: null });

      jest.setSystemTime(new Date('2026-07-12T14:01:00.000Z'));
      await expect(database.terminarSesionLectura(book.uuid, 25)).resolves.toMatchObject({
        pagina_fin: 25, paginas_leidas: 5, duracion_segundos: 60,
      });
      await expect(database.terminarSesionLectura(book.uuid, 30)).rejects.toThrow(/sesión activa/i);
    } finally {
      jest.useRealTimers();
    }
  });

  test('restaura un backup versión 5 completando las columnas nuevas con NULL', async () => {
    const { database, sqlite, fileSystem, documentPicker } = loadSubject();
    await database.inicializarBaseDeDatos();
    const backupFile = new fileSystem.File(fileSystem.Paths.cache, 'backup-v5.json');
    backupFile.create();
    const bookUuid = 'dddddddd-1234-4234-8234-123456789abc';
    backupFile.write(JSON.stringify({
      tipo: 'mi-biblioteca-backup',
      version: 5,
      libros: [{
        uuid: bookUuid, titulo: 'Libro legado', estado: 'leyendo', pagina_actual: 22,
        paginas_totales: 100, fecha_agregado: '2026-06-01T00:00:00.000Z',
      }],
      lista_compras: [{
        uuid: 'eeeeeeee-1234-4234-8234-123456789abc', titulo: 'Deseo legado',
        prioridad: 'media', fecha_agregado: '2026-06-02T00:00:00.000Z',
      }],
      sesiones_lectura: [{
        libro_uuid: bookUuid, fecha: '2026-06-03',
        hora_inicio: '2026-06-03T10:00:00.000Z', hora_fin: '2026-06-03T10:20:00.000Z',
        paginas_leidas: 12,
      }, {
        libro_uuid: bookUuid, fecha: '2026-06-04',
        hora_inicio: '2026-06-04T11:00:00.000Z', hora_fin: '2026-06-04T10:00:00.000Z',
        paginas_leidas: 7,
      }],
    }));
    documentPicker.__setResult({ canceled: false, assets: [{ uri: backupFile.uri }] });

    await database.importarBackupJSON();

    const state = sqlite.__getState();
    expect(state.listaCompras[0]).toMatchObject({ estado: 'activo', fecha_resolucion: null });
    expect(state.sesionesLectura[0]).toMatchObject({
      paginas_leidas: 12,
      pagina_inicio: null,
      pagina_fin: null,
      duracion_segundos: 1200,
    });
    expect(state.sesionesLectura[1]).toMatchObject({
      paginas_leidas: 7,
      pagina_inicio: null,
      pagina_fin: null,
      duracion_segundos: null,
    });
  });

  test('adquirir conserva el deseo, lo vincula al libro y deja de mostrarlo como activo', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    try {
      const { database, sqlite } = loadSubject();
      await database.inicializarBaseDeDatos();
      const wishId = await database.addDeseo({ titulo: 'Historia preservada', autor: 'Autor' });

      const bookId = await database.marcarComoAdquirido(wishId);
      const book = await database.obtenerLibroPorId(bookId);
      const state = sqlite.__getState();

      expect(state.listaCompras).toHaveLength(1);
      expect(state.listaCompras[0]).toMatchObject({
        id: wishId,
        estado: 'adquirido',
        libro_uuid_adquirido: book.uuid,
        fecha_resolucion: '2026-07-15T12:00:00.000Z',
      });
      await expect(database.getDeseos()).resolves.toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('descartar conserva el historial, no crea un libro y deja de mostrar el deseo como activo', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T13:00:00.000Z'));
    try {
      const { database, sqlite } = loadSubject();
      await database.inicializarBaseDeDatos();
      const wishId = await database.addDeseo({ titulo: 'Deseo descartado', autor: 'Autor' });

      await expect(database.deleteDeseo(wishId)).resolves.toBe(1);
      const state = sqlite.__getState();

      expect(state.listaCompras).toHaveLength(1);
      expect(state.listaCompras[0]).toMatchObject({
        id: wishId,
        estado: 'descartado',
        libro_uuid_adquirido: null,
        fecha_resolucion: '2026-07-15T13:00:00.000Z',
      });
      expect(state.misLibros).toHaveLength(0);
      await expect(database.getDeseos()).resolves.toEqual([]);
      await expect(database.marcarComoAdquirido(wishId)).rejects.toThrow(/ya no está activo/i);
    } finally {
      jest.useRealTimers();
    }
  });
});

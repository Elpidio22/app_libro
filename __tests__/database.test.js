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
  test('aplica migraciones hasta user_version 4 y crea sesiones, etiquetas, FTS5 e índices', async () => {
    const { database, sqlite } = loadSubject();

    await database.inicializarBaseDeDatos();

    const state = sqlite.__getState();
    expect(state.userVersion).toBe(4);
    expect([...state.tables]).toEqual(expect.arrayContaining([
      'mis_libros',
      'lista_compras',
      'etiquetas',
      'libro_etiquetas',
      'mis_libros_fts',
      'sesiones_lectura',
    ]));
    expect([...state.columns.mis_libros]).toEqual(expect.arrayContaining(['fecha_fin', 'uuid']));
    expect([...state.columns.lista_compras]).toContain('uuid');
    expect([...state.indexes]).toEqual(expect.arrayContaining([
      'idx_mis_libros_uuid',
      'idx_lista_compras_uuid',
      'idx_mis_libros_estado',
      'idx_mis_libros_fecha_fin',
      'idx_libro_etiquetas_etiqueta',
      'idx_sesiones_fecha',
      'idx_sesiones_libro',
      'idx_sesion_activa_por_libro',
    ]));
    expect([...state.triggers]).toEqual(expect.arrayContaining([
      'mis_libros_fts_insert',
      'mis_libros_fts_delete',
      'mis_libros_fts_update',
    ]));
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
      expect(active).toMatchObject({ libro_uuid: book.uuid, hora_fin: null, paginas_leidas: 40 });
      await expect(database.obtenerSesionActiva(book.uuid)).resolves.toMatchObject({ id: active.id });

      jest.setSystemTime(new Date('2026-07-11T14:45:00.000Z'));
      const finished = await database.terminarSesionLectura(book.uuid, 65);
      expect(finished).toMatchObject({ paginas_leidas: 25, minutos: 45 });
      await expect(database.obtenerSesionActiva(book.uuid)).resolves.toBeNull();
      await expect(database.obtenerLibroPorId(bookId)).resolves.toMatchObject({ pagina_actual: 65 });

      const chronicles = await database.obtenerCronicas();
      expect(chronicles.metricas).toMatchObject({
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
      paginas_leidas: 10,
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

  test('exporta un backup versión 4 con todas las entidades relacionadas', async () => {
    const { database, fileSystem } = loadSubject();
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

    const backupUri = await database.exportarBackupJSON();
    const backup = JSON.parse(await new fileSystem.File(backupUri).text());

    expect(backup).toMatchObject({ tipo: 'mi-biblioteca-backup', version: 4 });
    expect(backup.libros).toEqual([expect.objectContaining({ uuid: book.uuid })]);
    expect(backup.lista_compras).toEqual([expect.objectContaining({ titulo: 'Deseo respaldado' })]);
    expect(backup.etiquetas).toEqual([expect.objectContaining({ uuid: etiqueta.uuid, nombre: 'Favoritos' })]);
    expect(backup.libro_etiquetas).toEqual([
      expect.objectContaining({ libro_uuid: book.uuid, etiqueta_uuid: etiqueta.uuid }),
    ]);
    expect(backup.sesiones_lectura).toEqual([
      expect.objectContaining({ libro_uuid: book.uuid, hora_fin: null, paginas_leidas: 12 }),
    ]);
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
      tipo: 'mi-biblioteca-backup', version: 4,
      libros: [{
        uuid: bookUuid, titulo: 'Libro completo', autor: 'Autor', paginas_totales: 200,
        pagina_actual: 30, estado: 'leyendo', fecha_agregado: '2026-07-01T00:00:00.000Z',
      }],
      lista_compras: [{
        uuid: wishUuid, titulo: 'Deseo completo', prioridad: 'media',
        fecha_agregado: '2026-07-02T00:00:00.000Z',
      }],
      etiquetas: [{ uuid: tagUuid, nombre: 'Ensayo' }],
      libro_etiquetas: [{ libro_uuid: bookUuid, etiqueta_uuid: tagUuid }],
      sesiones_lectura: [{
        libro_uuid: bookUuid, fecha: '2026-07-10', hora_inicio: '2026-07-10T10:00:00.000Z',
        hora_fin: '2026-07-10T10:30:00.000Z', paginas_leidas: 18,
      }],
    }));
    documentPicker.__setResult({ canceled: false, assets: [{ uri: backupFile.uri }] });

    await database.importarBackupJSON();
    await database.importarBackupJSON();

    const state = sqlite.__getState();
    expect(state.misLibros).toHaveLength(1);
    expect(state.listaCompras).toHaveLength(1);
    expect(state.etiquetas).toEqual([expect.objectContaining({ uuid: tagUuid, nombre: 'Ensayo' })]);
    expect(state.libroEtiquetas).toEqual([
      expect.objectContaining({ libro_uuid: bookUuid, etiqueta_uuid: tagUuid }),
    ]);
    expect(state.sesionesLectura).toEqual([
      expect.objectContaining({ libro_uuid: bookUuid, paginas_leidas: 18 }),
    ]);
  });

  test('revierte INSERT y conserva el deseo si falla el DELETE final', async () => {
    const { database, sqlite } = loadSubject();
    await database.inicializarBaseDeDatos();
    const wishId = await database.addDeseo({
      titulo: 'Libro transaccional',
      autor: 'Autor',
      prioridad: 'alta',
    });
    sqlite.__failNextWishlistDelete(new Error('fallo forzado al eliminar deseo'));

    await expect(database.marcarComoAdquirido(wishId)).rejects.toThrow('fallo forzado');

    const state = sqlite.__getState();
    expect(state.misLibros).toHaveLength(0);
    expect(state.listaCompras).toHaveLength(1);
    expect(state.listaCompras[0]).toMatchObject({ id: wishId, titulo: 'Libro transaccional' });
  });
});

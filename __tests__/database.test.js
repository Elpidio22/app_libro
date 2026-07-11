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
  test('aplica migraciones hasta user_version 3 y crea etiquetas, FTS5 e índices', async () => {
    const { database, sqlite } = loadSubject();

    await database.inicializarBaseDeDatos();

    const state = sqlite.__getState();
    expect(state.userVersion).toBe(3);
    expect([...state.tables]).toEqual(expect.arrayContaining([
      'mis_libros',
      'lista_compras',
      'etiquetas',
      'libro_etiquetas',
      'mis_libros_fts',
    ]));
    expect([...state.columns.mis_libros]).toEqual(expect.arrayContaining(['fecha_fin', 'uuid']));
    expect([...state.columns.lista_compras]).toContain('uuid');
    expect([...state.indexes]).toEqual(expect.arrayContaining([
      'idx_mis_libros_uuid',
      'idx_lista_compras_uuid',
      'idx_mis_libros_estado',
      'idx_mis_libros_fecha_fin',
      'idx_libro_etiquetas_etiqueta',
    ]));
    expect([...state.triggers]).toEqual(expect.arrayContaining([
      'mis_libros_fts_insert',
      'mis_libros_fts_delete',
      'mis_libros_fts_update',
    ]));
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

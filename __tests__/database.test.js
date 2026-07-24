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

async function snapshotEsquema(db) {
  return db.getAllAsync(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `);
}

async function tablaExiste(db, nombre) {
  return Boolean(await db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    nombre
  ));
}

async function snapshotSemantico(db) {
  const tablas = await snapshotEsquema(db);
  const conteos = {};
  const filas = {};
  for (const tabla of ['mis_libros', 'lista_compras', 'etiquetas', 'libro_etiquetas', 'sesiones_lectura']) {
    if (await tablaExiste(db, tabla)) {
      conteos[tabla] = (await db.getFirstAsync(`SELECT COUNT(*) AS total FROM ${tabla}`)).total;
      filas[tabla] = await db.getAllAsync(`SELECT * FROM ${tabla} ORDER BY rowid`);
    }
  }
  const version = await db.getFirstAsync('PRAGMA user_version');
  return { version: version.user_version, tablas, conteos, filas };
}

async function expectIntegridad(db) {
  await expect(db.getFirstAsync('PRAGMA integrity_check')).resolves.toEqual({ integrity_check: 'ok' });
  await expect(db.getAllAsync('PRAGMA foreign_key_check')).resolves.toEqual([]);
}

async function crearFixtureHistorico(db, version) {
  if (version < 1) return;
  await db.execAsync(`
    CREATE TABLE mis_libros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn TEXT UNIQUE,
      titulo TEXT NOT NULL,
      autor TEXT,
      portada_url TEXT,
      paginas_totales INTEGER,
      pagina_actual INTEGER DEFAULT 0,
      estado TEXT DEFAULT 'quiero leer',
      calificacion INTEGER,
      notas TEXT,
      fecha_agregado DATETIME DEFAULT CURRENT_TIMESTAMP,
      fecha_fin DATE
    );
    CREATE TABLE lista_compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      autor TEXT,
      prioridad TEXT NOT NULL DEFAULT 'media'
        CHECK (prioridad IN ('alta', 'media', 'baja')),
      precio_estimado REAL,
      fecha_agregado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.runAsync(
    `INSERT INTO mis_libros
      (isbn, titulo, autor, paginas_totales, pagina_actual, estado, fecha_agregado, fecha_fin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    '9780306406157', `Libro v${version}`, 'Autora', 120, 12, 'leyendo',
    '2026-01-01T00:00:00.000Z', null
  );
  await db.runAsync(
    `INSERT INTO lista_compras (titulo, autor, prioridad, precio_estimado, fecha_agregado)
     VALUES (?, ?, ?, ?, ?)`,
    `Deseo v${version}`, 'Autor deseo', 'media', 10.5, '2026-01-02T00:00:00.000Z'
  );

  if (version >= 2) {
    await db.execAsync(`
      ALTER TABLE mis_libros ADD COLUMN uuid TEXT;
      ALTER TABLE lista_compras ADD COLUMN uuid TEXT;
      UPDATE mis_libros SET uuid = 'book-historico-0001';
      UPDATE lista_compras SET uuid = 'wish-historico-0001';
      CREATE UNIQUE INDEX idx_mis_libros_uuid ON mis_libros(uuid);
      CREATE UNIQUE INDEX idx_lista_compras_uuid ON lista_compras(uuid);
      CREATE INDEX idx_mis_libros_estado ON mis_libros(estado);
      CREATE INDEX idx_mis_libros_fecha_fin ON mis_libros(fecha_fin);
    `);
  }

  if (version >= 3) {
    await db.execAsync(`
      CREATE TABLE etiquetas (
        uuid TEXT PRIMARY KEY,
        nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
        fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE libro_etiquetas (
        libro_uuid TEXT NOT NULL,
        etiqueta_uuid TEXT NOT NULL,
        PRIMARY KEY (libro_uuid, etiqueta_uuid),
        FOREIGN KEY (libro_uuid) REFERENCES mis_libros(uuid) ON DELETE CASCADE,
        FOREIGN KEY (etiqueta_uuid) REFERENCES etiquetas(uuid) ON DELETE CASCADE
      );
      CREATE INDEX idx_libro_etiquetas_etiqueta ON libro_etiquetas(etiqueta_uuid);
      CREATE VIRTUAL TABLE mis_libros_fts USING fts5(
        titulo,
        autor,
        content='mis_libros',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER mis_libros_fts_insert
      AFTER INSERT ON mis_libros BEGIN
        INSERT INTO mis_libros_fts(rowid, titulo, autor)
        VALUES (new.id, new.titulo, COALESCE(new.autor, ''));
      END;
      CREATE TRIGGER mis_libros_fts_delete
      AFTER DELETE ON mis_libros BEGIN
        INSERT INTO mis_libros_fts(mis_libros_fts, rowid, titulo, autor)
        VALUES ('delete', old.id, old.titulo, COALESCE(old.autor, ''));
      END;
      CREATE TRIGGER mis_libros_fts_update
      AFTER UPDATE OF titulo, autor ON mis_libros BEGIN
        INSERT INTO mis_libros_fts(mis_libros_fts, rowid, titulo, autor)
        VALUES ('delete', old.id, old.titulo, COALESCE(old.autor, ''));
        INSERT INTO mis_libros_fts(rowid, titulo, autor)
        VALUES (new.id, new.titulo, COALESCE(new.autor, ''));
      END;
      INSERT INTO etiquetas (uuid, nombre) VALUES ('tag-historico-0001', 'Historia');
      INSERT INTO libro_etiquetas (libro_uuid, etiqueta_uuid)
      VALUES ('book-historico-0001', 'tag-historico-0001');
      INSERT INTO mis_libros_fts(mis_libros_fts) VALUES ('rebuild');
    `);
  }

  if (version >= 4) {
    await db.execAsync(`
      CREATE TABLE sesiones_lectura (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        libro_uuid TEXT NOT NULL,
        fecha TEXT NOT NULL,
        hora_inicio TEXT NOT NULL,
        hora_fin TEXT,
        paginas_leidas INTEGER NOT NULL DEFAULT 0 CHECK (paginas_leidas >= 0),
        FOREIGN KEY (libro_uuid) REFERENCES mis_libros(uuid) ON DELETE CASCADE
      );
      CREATE INDEX idx_sesiones_fecha ON sesiones_lectura(fecha);
      CREATE INDEX idx_sesiones_libro ON sesiones_lectura(libro_uuid);
      CREATE UNIQUE INDEX idx_sesion_activa_por_libro
      ON sesiones_lectura(libro_uuid) WHERE hora_fin IS NULL;
      INSERT INTO sesiones_lectura (libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas)
      VALUES ('book-historico-0001', '2026-01-03', '2026-01-03T10:00:00.000Z', '2026-01-03T10:30:00.000Z', 10);
    `);
  }

  if (version >= 5) {
    await db.execAsync(`
      CREATE UNIQUE INDEX idx_sesiones_libro_hora_inicio
      ON sesiones_lectura(libro_uuid, hora_inicio);
    `);
  }

  if (version >= 6) {
    await db.execAsync(`
      ALTER TABLE sesiones_lectura ADD COLUMN pagina_inicio INTEGER NULL;
      ALTER TABLE sesiones_lectura ADD COLUMN pagina_fin INTEGER NULL;
      ALTER TABLE sesiones_lectura ADD COLUMN duracion_segundos INTEGER NULL;
      ALTER TABLE lista_compras ADD COLUMN estado TEXT NOT NULL DEFAULT 'activo';
      ALTER TABLE lista_compras ADD COLUMN fecha_resolucion TEXT NULL;
      ALTER TABLE lista_compras ADD COLUMN libro_uuid_adquirido TEXT NULL;
      UPDATE sesiones_lectura
      SET pagina_inicio = 12, pagina_fin = 22, duracion_segundos = 1800;
      CREATE INDEX idx_lista_compras_estado_fecha
      ON lista_compras(estado, fecha_agregado);
    `);
  }

  await db.execAsync(`PRAGMA user_version = ${version};`);
}

describe('integridad de database.js', () => {
  test('inicializa una base limpia hasta versión 7 y repetir no cambia el estado', async () => {
    const { database } = loadSubject();

    const db = await database.inicializarBaseDeDatos();
    const primero = await snapshotSemantico(db);

    expect(primero.version).toBe(7);
    expect(primero.tablas.map((item) => item.name)).toEqual(expect.arrayContaining([
      'mis_libros', 'lista_compras', 'etiquetas', 'libro_etiquetas', 'mis_libros_fts', 'sesiones_lectura',
    ]));
    await expectIntegridad(db);
    await expect(database.buscarLibros({ texto: 'inexistente' })).resolves.toEqual([]);

    await database.inicializarBaseDeDatos();
    await expect(snapshotSemantico(db)).resolves.toEqual(primero);
  });

  test('migra fixtures históricos 1 a 6 hasta versión 7 conservando datos e integridad', async () => {
    for (const version of [1, 2, 3, 4, 5, 6]) {
      jest.resetModules();
      const sqlite = require('expo-sqlite');
      sqlite.__reset();
      const dbHistorica = await sqlite.openDatabaseAsync('biblioteca.db');
      await crearFixtureHistorico(dbHistorica, version);
      const antes = await snapshotSemantico(dbHistorica);
      const database = require('../src/database');

      await database.inicializarBaseDeDatos();

      const despues = await snapshotSemantico(dbHistorica);
      expect(despues.version).toBe(7);
      expect(despues.filas.mis_libros[0]).toMatchObject({
        titulo: `Libro v${version}`,
        uuid: version >= 2 ? 'book-historico-0001' : expect.any(String),
        fecha_inicio_lectura: null,
      });
      expect(despues.filas.lista_compras[0]).toMatchObject({
        titulo: `Deseo v${version}`,
        estado: 'activo',
      });
      if (version >= 3) {
        expect(despues.filas.etiquetas).toEqual([expect.objectContaining({ uuid: 'tag-historico-0001' })]);
        expect(despues.filas.libro_etiquetas).toHaveLength(1);
      }
      if (version >= 4) {
        expect(despues.filas.sesiones_lectura[0]).toMatchObject({
          libro_uuid: 'book-historico-0001',
          uuid: expect.stringMatching(/^ses-/),
          estado: 'completada',
          origen: 'cronometro',
        });
      }
      expect(despues.tablas.length).toBeGreaterThanOrEqual(antes.tablas.length);
      await expectIntegridad(dbHistorica);
    }
  });

  test('rollback atómico conserva base vacía si falla una instalación limpia', async () => {
    const { database } = loadSubject();
    const db = await database.getDatabase();
    const antes = await snapshotSemantico(db);

    await expect(database.inicializarBaseDeDatos({
      onMigrationCheckpoint: async (name) => {
        if (name === 'after-v4') throw new Error('fallo simulado intermedio');
      },
    })).rejects.toThrow(/fallo simulado intermedio/i);

    await expect(snapshotSemantico(db)).resolves.toEqual(antes);
    await expect(database.inicializarBaseDeDatos()).resolves.toBe(db);
    const despues = await snapshotSemantico(db);
    expect(despues.version).toBe(7);
    expect(despues.tablas.map((item) => item.name)).toContain('mis_libros');
    await expectIntegridad(db);
  });

  test('rollback atómico conserva esquema y datos v5 si falla la migración final y permite segundo intento', async () => {
    jest.resetModules();
    const sqlite = require('expo-sqlite');
    sqlite.__reset();
    const dbV5 = await sqlite.openDatabaseAsync('biblioteca.db');
    await crearFixtureHistorico(dbV5, 5);
    const antes = await snapshotSemantico(dbV5);
    const database = require('../src/database');

    await expect(database.inicializarBaseDeDatos({
      onMigrationCheckpoint: async (name) => {
        if (name === 'after-v7') throw new Error('fallo simulado final');
      },
    })).rejects.toThrow(/fallo simulado final/i);

    await expect(snapshotSemantico(dbV5)).resolves.toEqual(antes);
    await database.inicializarBaseDeDatos();
    const despues = await snapshotSemantico(dbV5);
    expect(despues.version).toBe(7);
    expect(despues.filas.mis_libros[0].titulo).toBe('Libro v5');
    expect(despues.filas.sesiones_lectura[0]).toMatchObject({
      estado: 'completada',
      duracion_segundos: 1800,
    });
    await expectIntegridad(dbV5);
  });

  test('rollback conserva user_version y datos si falla antes de confirmar user_version final', async () => {
    jest.resetModules();
    const sqlite = require('expo-sqlite');
    sqlite.__reset();
    const dbV6 = await sqlite.openDatabaseAsync('biblioteca.db');
    await crearFixtureHistorico(dbV6, 6);
    const antes = await snapshotSemantico(dbV6);
    const database = require('../src/database');

    await expect(database.inicializarBaseDeDatos({
      onMigrationCheckpoint: async (name) => {
        if (name === 'before-user-version') throw new Error('fallo antes de user_version');
      },
    })).rejects.toThrow(/fallo antes de user_version/i);

    await expect(snapshotSemantico(dbV6)).resolves.toEqual(antes);
    const version = await dbV6.getFirstAsync('PRAGMA user_version');
    expect(version.user_version).toBe(6);
  });

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

  test('exporta un backup versión 7 con campos actuales de libros y sesiones', async () => {
    const { database } = loadSubject();
    await database.inicializarBaseDeDatos();
    const bookId = await database.insertarLibro({
      titulo: 'Libro respaldado', autor: 'Autora', paginas_totales: 180,
      pagina_actual: 12, estado: 'leyendo', fecha_inicio_lectura: '2026-07-01',
    });
    const book = await database.obtenerLibroPorId(bookId);
    await database.addDeseo({ titulo: 'Deseo respaldado', prioridad: 'alta' });
    const etiqueta = await database.crearEtiqueta('Favoritos');
    await database.asignarEtiquetaALibro(book.uuid, etiqueta.uuid);
    const db = await database.getDatabase();
    await db.runAsync(
      `INSERT INTO sesiones_lectura
        (uuid, libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas, pagina_inicio,
         pagina_fin, duracion_segundos, estado, origen, nota, duracion_acumulada_segundos,
         ultimo_inicio, pausada_en, fecha_creacion, fecha_actualizacion, editada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ses-export-active-0001', book.uuid, '2026-07-10', '2026-07-10T10:00:00.000Z',
      null, 0, 12, null, null, 'activa', 'cronometro', 'En pausa',
      930, '2026-07-10T10:10:00.000Z', '2026-07-10T10:25:30.000Z',
      '2026-07-10T10:00:00.000Z', '2026-07-10T10:25:30.000Z', 1
    );

    const documento = await database.crearDocumentoBackupJSON();
    const backup = JSON.parse(documento.contenido);

    expect(backup).toMatchObject({ tipo: 'mi-biblioteca-backup', version: 7 });
    expect(backup.libros).toEqual([expect.objectContaining({
      uuid: book.uuid,
      fecha_inicio_lectura: '2026-07-01',
      fecha_fin: null,
      portada_base64: null,
    })]);
    expect(backup.lista_compras).toEqual([expect.objectContaining({ titulo: 'Deseo respaldado' })]);
    expect(backup.etiquetas).toEqual([expect.objectContaining({ uuid: etiqueta.uuid, nombre: 'Favoritos' })]);
    expect(backup.libro_etiquetas).toEqual([
      expect.objectContaining({ libro_uuid: book.uuid, etiqueta_uuid: etiqueta.uuid }),
    ]);
    expect(backup.sesiones_lectura).toEqual([
      expect.objectContaining({
        uuid: 'ses-export-active-0001',
        libro_uuid: book.uuid,
        estado: 'activa',
        origen: 'cronometro',
        nota: 'En pausa',
        hora_fin: null,
        paginas_leidas: 0,
        pagina_inicio: 12,
        pagina_fin: null,
        duracion_segundos: null,
        duracion_acumulada_segundos: 930,
        pausada_en: '2026-07-10T10:25:30.000Z',
        editada: 1,
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

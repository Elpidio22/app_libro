function loadSubject() {
  jest.resetModules();
  const sqlite = require('expo-sqlite');
  const fileSystem = require('expo-file-system');
  sqlite.__reset();
  fileSystem.__reset();
  const database = require('../src/database');
  const analytics = require('../src/database/analyticsRepository');
  const revisions = require('../src/database/revisions');
  revisions.resetDatabaseRevisionsForTests();
  return { database, analytics, revisions };
}

async function insertarSesion(db, {
  libroUuid,
  fecha,
  inicio,
  fin,
  paginas,
  paginaInicio = 0,
  paginaFin = paginas,
  duracion,
}) {
  await db.runAsync(
    `INSERT INTO sesiones_lectura
      (libro_uuid, fecha, hora_inicio, hora_fin, paginas_leidas,
       pagina_inicio, pagina_fin, duracion_segundos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    libroUuid,
    fecha,
    inicio,
    fin,
    paginas,
    paginaInicio,
    paginaFin,
    duracion
  );
}

describe('analyticsRepository', () => {
  test('calcula velocidad ponderada, actividad, wishlist y etiquetas múltiples sin ocultar duplicación', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    try {
      const { database, analytics } = loadSubject();
      await database.inicializarBaseDeDatos();
      const bookId = await database.insertarLibro({
        titulo: 'Libro analítico', paginas_totales: 200, pagina_actual: 80, estado: 'leyendo',
      });
      await database.insertarLibro({ titulo: 'Libro terminado', estado: 'terminado', pagina_actual: 100, paginas_totales: 100 });
      const book = await database.obtenerLibroPorId(bookId);
      const db = await database.getDatabase();
      await insertarSesion(db, {
        libroUuid: book.uuid, fecha: '2026-07-09',
        inicio: '2026-07-09T10:00:00.000Z', fin: '2026-07-09T10:20:00.000Z',
        paginas: 5, paginaInicio: null, paginaFin: null, duracion: null,
      });
      await insertarSesion(db, {
        libroUuid: book.uuid, fecha: '2026-07-10',
        inicio: '2026-07-10T10:00:00.000Z', fin: '2026-07-10T10:10:00.000Z',
        paginas: 10, paginaInicio: 20, paginaFin: 30, duracion: 600,
      });
      await insertarSesion(db, {
        libroUuid: book.uuid, fecha: '2026-07-11',
        inicio: '2026-07-11T10:00:00.000Z', fin: '2026-07-11T11:00:00.000Z',
        paginas: 30, paginaInicio: 30, paginaFin: 60, duracion: 3600,
      });
      await insertarSesion(db, {
        libroUuid: book.uuid, fecha: '2026-07-12',
        inicio: '2026-07-12T10:00:00.000Z', fin: '2026-07-13T00:00:00.000Z',
        paginas: 100, paginaInicio: 60, paginaFin: 160, duracion: 50400,
      });
      await insertarSesion(db, {
        libroUuid: book.uuid, fecha: '2026-07-13',
        inicio: '2026-07-13T10:00:00.000Z', fin: '2026-07-13T10:10:00.000Z',
        paginas: 20, paginaInicio: 80, paginaFin: 70, duracion: 600,
      });
      await insertarSesion(db, {
        libroUuid: book.uuid, fecha: '2026-07-14',
        inicio: '2026-07-14T10:00:00.000Z', fin: null,
        paginas: 0, paginaInicio: 80, paginaFin: null, duracion: null,
      });

      const ensayo = await database.crearEtiqueta('Ensayo');
      const favorito = await database.crearEtiqueta('Favorito');
      await database.asignarEtiquetaALibro(book.uuid, ensayo.uuid);
      await database.asignarEtiquetaALibro(book.uuid, favorito.uuid);

      const adquirido = await database.addDeseo({ titulo: 'Deseo adquirido' });
      const descartado = await database.addDeseo({ titulo: 'Deseo descartado' });
      await db.runAsync(
        'UPDATE lista_compras SET fecha_agregado = ? WHERE id = ?',
        '2026-07-10T12:00:00.000Z',
        adquirido
      );
      await database.marcarComoAdquirido(adquirido);
      await database.deleteDeseo(descartado);

      const dashboard = await analytics.obtenerDashboardAnalitico({
        desde: '2026-07-01', hasta: '2026-07-31',
      });

      expect(dashboard.resumen).toMatchObject({
        paginas: 45,
        duracion_segundos: 4200,
        sesiones: 3,
        dias_activos: 3,
        libros_terminados: 1,
      });
      expect(dashboard.velocidad.paginasPorHora).toBeCloseTo((40 * 3600) / 4200, 5);
      expect(dashboard.velocidad.paginasPorHora).not.toBeCloseTo(45, 1);
      expect(dashboard.velocidad.muestraSuficiente).toBe(true);
      expect(dashboard.actividadDiaria).toEqual([
        expect.objectContaining({ fecha: '2026-07-09', paginas: 5, duracion_segundos: 0 }),
        expect.objectContaining({ fecha: '2026-07-10', paginas: 10, duracion_segundos: 600 }),
        expect.objectContaining({ fecha: '2026-07-11', paginas: 30, duracion_segundos: 3600 }),
      ]);
      expect(dashboard.etiquetas).toEqual(expect.arrayContaining([
        expect.objectContaining({ nombre: 'Ensayo', paginas: 45 }),
        expect.objectContaining({ nombre: 'Favorito', paginas: 45 }),
      ]));
      expect(dashboard._meta.etiquetas_atribucion).toMatch(/cada etiqueta/i);
      expect(dashboard._meta.needsRecompute).toBe(false);
      expect(dashboard.wishlist).toMatchObject({
        activos: 0, adquiridos: 1, descartados: 1, tasa_adquisicion: 0.5,
        segundos_promedio_hasta_adquirir: 432000,
      });
      expect(dashboard.velocidad.estimaciones_restantes).toEqual([
        expect.objectContaining({ libro_uuid: book.uuid, paginas_restantes: 120 }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    { paginas: 30, segundos: 3600 },
    { paginas: 15, segundos: 1800 },
  ])('$paginas páginas en $segundos segundos son 30 páginas por hora', async ({ paginas, segundos }) => {
    const { database, analytics } = loadSubject();
    await database.inicializarBaseDeDatos();
    const bookId = await database.insertarLibro({ titulo: 'Unidad de velocidad', estado: 'leyendo', pagina_actual: 0 });
    const book = await database.obtenerLibroPorId(bookId);
    const db = await database.getDatabase();
    await insertarSesion(db, {
      libroUuid: book.uuid,
      fecha: '2026-07-10',
      inicio: '2026-07-10T10:00:00.000Z',
      fin: new Date(Date.parse('2026-07-10T10:00:00.000Z') + segundos * 1000).toISOString(),
      paginas,
      paginaInicio: 0,
      paginaFin: paginas,
      duracion: segundos,
    });

    const dashboard = await analytics.obtenerDashboardAnalitico({ desde: '2026-07-01', hasta: '2026-07-31' });
    expect(dashboard.velocidad.paginasPorHora).toBe(30);
    expect(dashboard.velocidad.muestraSuficiente).toBe(false);
    expect(dashboard.velocidad.estimaciones_restantes).toEqual([]);
  });

  test('solo estima con dos sesiones temporizadas, páginas restantes positivas y libros en lectura', async () => {
    const { database, analytics, revisions } = loadSubject();
    await database.inicializarBaseDeDatos();
    const readingId = await database.insertarLibro({
      titulo: 'Libro por estimar', estado: 'leyendo', pagina_actual: 20, paginas_totales: 100,
    });
    await database.insertarLibro({
      titulo: 'Libro finalizado', estado: 'terminado', pagina_actual: 100, paginas_totales: 100,
    });
    const reading = await database.obtenerLibroPorId(readingId);
    const db = await database.getDatabase();
    await insertarSesion(db, {
      libroUuid: reading.uuid, fecha: '2026-07-10',
      inicio: '2026-07-10T10:00:00.000Z', fin: '2026-07-10T11:00:00.000Z',
      paginas: 30, paginaInicio: 0, paginaFin: 30, duracion: 3600,
    });
    await insertarSesion(db, {
      libroUuid: reading.uuid, fecha: '2026-07-11',
      inicio: '2026-07-11T10:00:00.000Z', fin: '2026-07-11T10:30:00.000Z',
      paginas: 15, paginaInicio: null, paginaFin: null, duracion: null,
    });
    revisions.bumpDatabaseRevisions('sessions');

    const insuficiente = await analytics.obtenerDashboardAnalitico({ desde: '2026-07-01', hasta: '2026-07-31' });
    expect(insuficiente.velocidad).toMatchObject({ paginasPorHora: 30, muestraSuficiente: false });
    expect(insuficiente.velocidad.estimaciones_restantes).toEqual([]);

    await insertarSesion(db, {
      libroUuid: reading.uuid, fecha: '2026-07-12',
      inicio: '2026-07-12T10:00:00.000Z', fin: '2026-07-12T10:30:00.000Z',
      paginas: 15, paginaInicio: 30, paginaFin: 45, duracion: 1800,
    });
    revisions.bumpDatabaseRevisions('sessions');
    const suficiente = await analytics.obtenerDashboardAnalitico({ desde: '2026-07-01', hasta: '2026-07-31' });

    expect(suficiente.velocidad).toMatchObject({ paginasPorHora: 30, muestraSuficiente: true });
    expect(suficiente.velocidad.estimaciones_restantes).toEqual([
      expect.objectContaining({
        libro_uuid: reading.uuid,
        paginas_restantes: 80,
        segundos_estimados: 9600,
      }),
    ]);
    expect(suficiente.velocidad.estimaciones_restantes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ titulo: 'Libro finalizado' }),
    ]));
  });

  test('no divide por cero ni estima cuando la muestra no contiene páginas leídas', async () => {
    const { database, analytics, revisions } = loadSubject();
    await database.inicializarBaseDeDatos();
    const bookId = await database.insertarLibro({
      titulo: 'Sin avance', estado: 'leyendo', pagina_actual: 25, paginas_totales: 100,
    });
    const book = await database.obtenerLibroPorId(bookId);
    const db = await database.getDatabase();
    for (const [dia, inicio] of [['10', '10:00'], ['11', '11:00']]) {
      await insertarSesion(db, {
        libroUuid: book.uuid,
        fecha: `2026-07-${dia}`,
        inicio: `2026-07-${dia}T${inicio}:00.000Z`,
        fin: `2026-07-${dia}T${inicio.slice(0, 3)}30:00.000Z`,
        paginas: 0,
        paginaInicio: 25,
        paginaFin: 25,
        duracion: 1800,
      });
    }
    revisions.bumpDatabaseRevisions('sessions');

    const dashboard = await analytics.obtenerDashboardAnalitico({ desde: '2026-07-01', hasta: '2026-07-31' });
    expect(dashboard.velocidad).toMatchObject({ paginasPorHora: 0, muestraSuficiente: false });
    expect(Number.isFinite(dashboard.velocidad.paginasPorHora)).toBe(true);
    expect(dashboard.velocidad.estimaciones_restantes).toEqual([]);
  });

  test('invalida la caché por revisiones y expone generaciones monotónicas', async () => {
    const { database, analytics, revisions } = loadSubject();
    await database.inicializarBaseDeDatos();
    const bookId = await database.insertarLibro({ titulo: 'Revisiones', estado: 'leyendo', pagina_actual: 0 });
    const book = await database.obtenerLibroPorId(bookId);

    const primero = await analytics.obtenerDashboardAnalitico({ desde: '2026-01-01', hasta: '2026-12-31' });
    const cacheado = await analytics.obtenerDashboardAnalitico({ desde: '2026-01-01', hasta: '2026-12-31' });
    expect(cacheado).toBe(primero);
    const revisionAnterior = revisions.getDatabaseRevisions().sessionsRevision;

    await database.iniciarSesionLectura(book.uuid, 0);
    const actualizado = await analytics.obtenerDashboardAnalitico({ desde: '2026-01-01', hasta: '2026-12-31' });

    expect(actualizado).not.toBe(primero);
    expect(actualizado._meta.generation).toBeGreaterThan(primero._meta.generation);
    expect(actualizado._meta.revisions.sessionsRevision).toBeGreaterThan(revisionAnterior);
  });

  test('permite forzar una recarga aunque las revisiones no hayan cambiado', async () => {
    const { database, analytics } = loadSubject();
    await database.inicializarBaseDeDatos();
    const rango = { desde: '2026-01-01', hasta: '2026-12-31' };

    const primero = await analytics.obtenerDashboardAnalitico(rango);
    const cacheado = await analytics.obtenerDashboardAnalitico(rango);
    const forzado = await analytics.obtenerDashboardAnalitico({ ...rango, force: true });

    expect(cacheado).toBe(primero);
    expect(forzado).not.toBe(primero);
    expect(forzado._meta.generation).toBeGreaterThan(primero._meta.generation);
  });

  test('invalida cada dominio al iniciar/finalizar sesiones, editar, etiquetar y resolver deseos', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T10:00:00.000Z'));
    try {
      const { database, revisions } = loadSubject();
      await database.inicializarBaseDeDatos();
      const bookId = await database.insertarLibro({
        titulo: 'Dominios', estado: 'leyendo', pagina_actual: 10, paginas_totales: 100,
      });
      const book = await database.obtenerLibroPorId(bookId);

      const antesInicio = revisions.getDatabaseRevisions();
      await database.iniciarSesionLectura(book.uuid, 10);
      const trasInicio = revisions.getDatabaseRevisions();
      expect(trasInicio.sessionsRevision).toBe(antesInicio.sessionsRevision + 1);
      expect(trasInicio.booksRevision).toBe(antesInicio.booksRevision + 1);

      jest.setSystemTime(new Date('2026-07-15T10:30:00.000Z'));
      await database.terminarSesionLectura(book.uuid, 25);
      const trasCierre = revisions.getDatabaseRevisions();
      expect(trasCierre.sessionsRevision).toBe(trasInicio.sessionsRevision + 1);
      expect(trasCierre.booksRevision).toBe(trasInicio.booksRevision + 1);

      await database.actualizarProgreso(bookId, 30, 'leyendo');
      const trasProgreso = revisions.getDatabaseRevisions();
      expect(trasProgreso.booksRevision).toBe(trasCierre.booksRevision + 1);

      const etiqueta = await database.crearEtiqueta('Auditoría');
      const trasCrearEtiqueta = revisions.getDatabaseRevisions();
      expect(trasCrearEtiqueta.tagsRevision).toBe(trasProgreso.tagsRevision + 1);
      await database.asignarEtiquetaALibro(book.uuid, etiqueta.uuid);
      const trasAsignarEtiqueta = revisions.getDatabaseRevisions();
      expect(trasAsignarEtiqueta.tagsRevision).toBe(trasCrearEtiqueta.tagsRevision + 1);

      const adquirido = await database.addDeseo({ titulo: 'Adquirido' });
      const trasAgregarAdquirido = revisions.getDatabaseRevisions();
      await database.marcarComoAdquirido(adquirido);
      const trasAdquirir = revisions.getDatabaseRevisions();
      expect(trasAdquirir.wishlistRevision).toBe(trasAgregarAdquirido.wishlistRevision + 1);
      expect(trasAdquirir.booksRevision).toBe(trasAgregarAdquirido.booksRevision + 1);

      const descartado = await database.addDeseo({ titulo: 'Descartado' });
      const trasAgregarDescartado = revisions.getDatabaseRevisions();
      await database.deleteDeseo(descartado);
      const trasDescartar = revisions.getDatabaseRevisions();
      expect(trasDescartar.wishlistRevision).toBe(trasAgregarDescartado.wishlistRevision + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('una respuesta analítica antigua no sobrescribe una respuesta nueva en caché', async () => {
    const { database, analytics } = loadSubject();
    await database.inicializarBaseDeDatos();
    const db = await database.getDatabase();
    const originalGetFirstAsync = db.getFirstAsync.bind(db);
    let liberarConsultaAntigua;
    let primeraConsulta = true;
    db.getFirstAsync = (...args) => {
      if (!primeraConsulta) return originalGetFirstAsync(...args);
      primeraConsulta = false;
      return new Promise((resolve, reject) => {
        liberarConsultaAntigua = () => originalGetFirstAsync(...args).then(resolve, reject);
      });
    };

    const rango = { desde: '2026-01-01', hasta: '2026-12-31' };
    const antiguaPromise = analytics.obtenerDashboardAnalitico(rango);
    while (!liberarConsultaAntigua) await Promise.resolve();
    const nueva = await analytics.obtenerDashboardAnalitico(rango);
    liberarConsultaAntigua();
    const antigua = await antiguaPromise;
    const cacheada = await analytics.obtenerDashboardAnalitico(rango);

    expect(antigua._meta.generation).toBeLessThan(nueva._meta.generation);
    expect(cacheada).toBe(nueva);
  });

  test('needsRecompute provoca una recomputación y entrega un snapshot estable', async () => {
    const { database, analytics, revisions } = loadSubject();
    await database.inicializarBaseDeDatos();
    const db = await database.getDatabase();
    const originalGetFirstAsync = db.getFirstAsync.bind(db);
    let revisionInyectada = false;
    db.getFirstAsync = async (...args) => {
      const result = await originalGetFirstAsync(...args);
      if (!revisionInyectada) {
        revisionInyectada = true;
        revisions.bumpDatabaseRevisions('sessions');
      }
      return result;
    };

    const dashboard = await analytics.obtenerDashboardAnalitico({ desde: '2026-01-01', hasta: '2026-12-31' });

    expect(revisionInyectada).toBe(true);
    expect(dashboard._meta.generation).toBeGreaterThanOrEqual(2);
    expect(dashboard._meta.needsRecompute).toBe(false);
    expect(dashboard._meta.revisions.sessionsRevision).toBe(1);
  });

  test('ejecuta EXPLAIN QUERY PLAN para las consultas principales', async () => {
    const { database, analytics } = loadSubject();
    await database.inicializarBaseDeDatos();

    const planes = await analytics.obtenerPlanesDashboardAnalitico({
      desde: '2026-01-01', hasta: '2026-12-31',
    });

    expect(planes.resumen.length).toBeGreaterThan(0);
    expect(planes.etiquetas.length).toBeGreaterThan(0);
    expect(JSON.stringify(planes.resumen)).toMatch(/idx_sesiones_fecha/i);
    expect(JSON.stringify(planes.etiquetas)).toMatch(/idx_sesiones_fecha/i);
  });
});

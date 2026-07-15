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
      expect(dashboard.velocidad.paginas_por_hora).toBeCloseTo((40 * 3600) / 4200, 5);
      expect(dashboard.velocidad.paginas_por_hora).not.toBeCloseTo(45, 1);
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

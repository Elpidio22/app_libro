import {
  calcularDiasCalendario,
  calcularRachaMaxima,
  construirResumenesLectura,
  esSesionValidaParaResumen,
} from '../src/database/analyticsRepository';

const book = {
  id: 1,
  uuid: 'book-summary-0001',
  isbn: '9789870000001',
  titulo: 'Libro terminado',
  autor: 'Autora',
  portada_url: 'file:///portada.jpg',
  paginas_totales: 300,
  pagina_actual: 300,
  estado: 'terminado',
  calificacion: 5,
  notas: 'Una reflexión.',
  fecha_fin: '2026-07-15',
};

function session(overrides = {}) {
  return {
    id: 1,
    libro_uuid: book.uuid,
    fecha: '2026-07-10',
    hora_inicio: '2026-07-10T10:00:00.000Z',
    hora_fin: '2026-07-10T11:00:00.000Z',
    paginas_leidas: 30,
    pagina_inicio: 0,
    pagina_fin: 30,
    duracion_segundos: 3600,
    ...overrides,
  };
}

function summary(sessions = [], bookOverrides = {}, tags = []) {
  return construirResumenesLectura([{ ...book, ...bookOverrides }], sessions, tags)[0];
}

describe('resúmenes de lectura: cálculos puros', () => {
  test('libro terminado con varias sesiones agrega actividad real', () => {
    const result = summary([
      session(),
      session({ id: 2, fecha: '2026-07-11', hora_inicio: '2026-07-11T10:00:00Z', hora_fin: '2026-07-11T10:30:00Z', paginas_leidas: 20, pagina_inicio: 30, pagina_fin: 50, duracion_segundos: 1800 }),
    ]);
    expect(result.actividad).toMatchObject({ sesiones: 2, paginas_registradas: 50, duracion_segundos: 5400 });
  });

  test('libro terminado sin sesiones conserva identidad y no inventa métricas', () => {
    const result = summary([]);
    expect(result).toMatchObject({ titulo: book.titulo, paginas_totales: 300, actividad: null });
  });

  test('sesiones parciales se señalan mediante cobertura', () => {
    expect(summary([session()]).actividad).toMatchObject({ cobertura_sesiones: 0.1, cobertura_parcial: true });
  });

  test('primera sesión registrada usa la fecha mínima válida', () => {
    const result = summary([session({ fecha: '2026-07-12' }), session({ id: 2, fecha: '2026-07-09' })]);
    expect(result.actividad.primera_sesion).toBe('2026-07-09');
  });

  test('última sesión registrada usa la fecha máxima válida', () => {
    const result = summary([session({ fecha: '2026-07-09' }), session({ id: 2, fecha: '2026-07-14' })]);
    expect(result.actividad.ultima_sesion).toBe('2026-07-14');
  });

  test('conserva una fecha de finalización existente', () => {
    expect(summary([]).fecha_fin).toBe('2026-07-15');
  });

  test('acepta datos antiguos sin fecha de finalización', () => {
    expect(summary([], { fecha_fin: null }).fecha_fin).toBeNull();
  });

  test('un único día de lectura devuelve un día calendario', () => {
    expect(summary([session()]).actividad.dias_calendario).toBe(1);
  });

  test('cuenta días activos distintos', () => {
    const result = summary([session(), session({ id: 2 }), session({ id: 3, fecha: '2026-07-12' })]);
    expect(result.actividad.dias_activos).toBe(2);
  });

  test('calcula racha máxima consecutiva', () => {
    expect(calcularRachaMaxima(['2026-07-01', '2026-07-02', '2026-07-04', '2026-07-05', '2026-07-06'])).toBe(3);
  });

  test('días no consecutivos no incrementan la racha', () => {
    expect(calcularRachaMaxima(['2026-07-01', '2026-07-03', '2026-07-05'])).toBe(1);
  });

  test('suma páginas registradas', () => {
    expect(summary([session(), session({ id: 2, paginas_leidas: 25 })]).actividad.paginas_registradas).toBe(55);
  });

  test('calcula promedio de páginas por sesión', () => {
    expect(summary([session(), session({ id: 2, paginas_leidas: 10 })]).actividad.paginas_promedio_sesion).toBe(20);
  });

  test('calcula promedio de minutos por sesión', () => {
    const result = summary([session(), session({ id: 2, duracion_segundos: 1800 })]);
    expect(result.actividad.minutos_promedio_sesion).toBe(45);
  });

  test('calcula velocidad ponderada y no promedia velocidades individuales', () => {
    const result = summary([
      session({ paginas_leidas: 60, duracion_segundos: 3600 }),
      session({ id: 2, paginas_leidas: 10, duracion_segundos: 1800 }),
    ]);
    expect(result.actividad.velocidad_paginas_hora).toBeCloseTo((70 * 3600) / 5400, 5);
    expect(result.actividad.velocidad_paginas_hora).not.toBe(40);
  });

  test('excluye una sesión abierta', () => {
    const result = summary([session({ hora_fin: null, duracion_segundos: null })]);
    expect(result.actividad).toBeNull();
    expect(result.sesiones_registradas_total).toBe(1);
  });

  test('excluye una sesión con duración negativa', () => {
    expect(esSesionValidaParaResumen(session({ duracion_segundos: -20 }))).toBe(false);
  });

  test('excluye una sesión con páginas negativas', () => {
    expect(esSesionValidaParaResumen(session({ paginas_leidas: -1 }))).toBe(false);
  });

  test('excluye una sesión superior a doce horas', () => {
    expect(esSesionValidaParaResumen(session({ duracion_segundos: (12 * 3600) + 1 }))).toBe(false);
  });

  test('conserva un libro sin portada', () => {
    expect(summary([], { portada_url: null }).portada_url).toBeNull();
  });

  test('conserva un libro sin autor', () => {
    expect(summary([], { autor: null }).autor).toBeNull();
  });

  test('asocia etiquetas sin duplicar el libro', () => {
    const result = summary([], {}, [
      { libro_uuid: book.uuid, uuid: 'tag-1', nombre: 'Ensayo' },
      { libro_uuid: book.uuid, uuid: 'tag-2', nombre: 'Favorito' },
    ]);
    expect(result.etiquetas.map((tag) => tag.nombre)).toEqual(['Ensayo', 'Favorito']);
  });

  test('la regularidad divide días activos por días calendario', () => {
    const result = summary([session({ fecha: '2026-07-01' }), session({ id: 2, fecha: '2026-07-03' })]);
    expect(result.actividad).toMatchObject({ dias_calendario: 3, dias_activos: 2, regularidad: 2 / 3 });
  });

  test('la diferencia inclusiva entre primera y última fecha nunca devuelve cero', () => {
    expect(calcularDiasCalendario('2026-07-10', '2026-07-10')).toBe(1);
  });

  test('informa cuántas sesiones fueron excluidas', () => {
    const result = summary([session(), session({ id: 2, hora_fin: null, duracion_segundos: null })]);
    expect(result.actividad).toMatchObject({ sesiones: 1, sesiones_excluidas: 1 });
  });
});

describe('resúmenes de lectura: integración SQLite', () => {
  function loadSubject() {
    jest.resetModules();
    const sqlite = require('expo-sqlite');
    const fileSystem = require('expo-file-system');
    sqlite.__reset();
    fileSystem.__reset();
    const database = require('../src/database');
    const analytics = require('../src/database/analyticsRepository');
    require('../src/database/revisions').resetDatabaseRevisionsForTests();
    return { database, analytics };
  }

  test('un libro no terminado no aparece', async () => {
    const { database, analytics } = loadSubject();
    await database.inicializarBaseDeDatos();
    await database.insertarLibro({ titulo: 'En curso', estado: 'leyendo' });
    const data = await analytics.obtenerDashboardAnalitico({ desde: '2026-01-01', hasta: '2026-12-31' });
    expect(data.resumenesLectura).toEqual([]);
  });

  test('cambiar a Terminado actualiza Crónicas y registra fecha real', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    try {
      const { database, analytics } = loadSubject();
      await database.inicializarBaseDeDatos();
      const id = await database.insertarLibro({ titulo: 'Transición', estado: 'leyendo' });
      const before = await analytics.obtenerDashboardAnalitico({ desde: '2026-01-01', hasta: '2026-12-31' });
      await database.actualizarLibro(id, { estado: 'terminado' });
      const after = await analytics.obtenerDashboardAnalitico({ desde: '2026-01-01', hasta: '2026-12-31' });
      expect(before.resumenesLectura).toHaveLength(0);
      expect(after.resumenesLectura[0]).toMatchObject({ titulo: 'Transición', fecha_fin: '2026-07-16' });
    } finally {
      jest.useRealTimers();
    }
  });

  test('salir de Terminado conserva la fecha histórica sin duplicar información', async () => {
    const { database } = loadSubject();
    await database.inicializarBaseDeDatos();
    const id = await database.insertarLibro({ titulo: 'Historial', estado: 'terminado' });
    const before = await database.obtenerLibroPorId(id);
    await database.actualizarLibro(id, { estado: 'leyendo' });
    const after = await database.obtenerLibroPorId(id);
    expect(after.fecha_fin).toBe(before.fecha_fin);
    expect(after.estado).toBe('leyendo');
  });

  test('editar otro campo de un terminado no altera su fecha', async () => {
    const { database } = loadSubject();
    await database.inicializarBaseDeDatos();
    const id = await database.insertarLibro({ titulo: 'Sin alteración', estado: 'terminado' });
    const before = await database.obtenerLibroPorId(id);
    await database.actualizarLibro(id, { notas: 'Nueva nota' });
    const after = await database.obtenerLibroPorId(id);
    expect(after.fecha_fin).toBe(before.fecha_fin);
  });

  test('una importación invalida y actualiza los resúmenes', async () => {
    const { database, analytics } = loadSubject();
    await database.inicializarBaseDeDatos();
    const options = { desde: '2026-01-01', hasta: '2026-12-31' };
    const before = await analytics.obtenerDashboardAnalitico(options);
    await database.ejecutarImportacionBackup({
      tipo: 'mi-biblioteca-backup',
      version: 6,
      fecha_exportacion: '2026-07-17T12:00:00.000Z',
      libros: [{
        uuid: 'imported-summary-book-0001', titulo: 'Importado terminado', autor: null,
        isbn: null, portada_url: null, portada_base64: null, paginas_totales: 120,
        pagina_actual: 120, estado: 'terminado', calificacion: null, notas: null,
        fecha_fin: '2026-07-17',
      }],
      lista_compras: [], etiquetas: [], libro_etiquetas: [], sesiones_lectura: [],
    });
    const after = await analytics.obtenerDashboardAnalitico(options);
    expect(before.resumenesLectura).toHaveLength(0);
    expect(after.resumenesLectura).toEqual([
      expect.objectContaining({ titulo: 'Importado terminado', actividad: null }),
    ]);
    expect(after._meta.generation).toBeGreaterThan(before._meta.generation);
  });
});

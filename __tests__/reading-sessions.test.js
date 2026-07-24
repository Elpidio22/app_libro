import {
  buildLocalSessionInstant,
  calculateReadPages,
  elapsedSessionSeconds,
  normalizeLocalDate,
  normalizeLocalTime,
  readingCalendarDays,
  validateSessionInstantIsNotFuture,
  validateDurationSeconds,
  validateReadingDates,
} from '../src/services/readingSessionService';

function loadSubject() {
  jest.resetModules();
  const sqlite = require('expo-sqlite');
  const fileSystem = require('expo-file-system');
  sqlite.__reset();
  fileSystem.__reset();
  const database = require('../src/database');
  require('../src/database/revisions').resetDatabaseRevisionsForTests();
  return { database, sqlite };
}

function localInputParts(date) {
  return {
    fecha: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    hora: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
}

describe('reglas centrales de sesiones', () => {
  test('calcula páginas desde un único lugar', () => expect(calculateReadPages(10, 25, 100)).toBe(15));
  test('rechaza página final anterior', () => expect(() => calculateReadPages(25, 10, 100)).toThrow(/menor/i));
  test('rechaza página final superior al libro', () => expect(() => calculateReadPages(10, 110, 100)).toThrow(/total/i));
  test('acepta sesión sin página final como dato pendiente fuera del cálculo', () => expect(() => calculateReadPages(10, null)).toThrow());
  test('rechaza duración cero', () => expect(() => validateDurationSeconds(0)).toThrow(/mayor/i));
  test('rechaza duración superior a doce horas', () => expect(() => validateDurationSeconds(43201)).toThrow(/12 horas/i));
  test('normaliza una fecha real', () => expect(normalizeLocalDate('2026-07-23')).toBe('2026-07-23'));
  test('rechaza una fecha inexistente', () => expect(normalizeLocalDate('2026-02-31')).toBeNull());
  test('valida hora local sin aceptar valores imposibles', () => {
    expect(normalizeLocalTime('09:35')).toBe('09:35');
    expect(normalizeLocalTime('25:00')).toBeNull();
  });
  test('rechaza fin anterior al inicio', () => expect(() => validateReadingDates('2026-07-20', '2026-07-15')).toThrow(/anterior/i));
  test('diferencia días calendario inclusivos', () => expect(readingCalendarDays('2026-07-20', '2026-07-23')).toBe(4));
  test('reconstruye tiempo desde timestamp y acumulado', () => {
    expect(elapsedSessionSeconds({
      estado: 'activa', hora_inicio: '2026-07-23T10:00:00Z',
      ultimo_inicio: '2026-07-23T10:30:00Z', duracion_acumulada_segundos: 900,
    }, new Date('2026-07-23T11:00:00Z'))).toBe(2700);
  });
  test('una sesión pausada no sigue sumando tiempo', () => {
    expect(elapsedSessionSeconds({
      estado: 'activa', pausada_en: '2026-07-23T11:00:00Z', duracion_acumulada_segundos: 1800,
    }, new Date('2026-07-23T14:00:00Z'))).toBe(1800);
  });
  test('valida timestamps locales completos contra now', () => {
    const now = new Date('2026-07-23T10:30:00.000Z');
    const exactParts = localInputParts(now);
    const exact = buildLocalSessionInstant(exactParts.fecha, exactParts.hora).instant;
    expect(validateSessionInstantIsNotFuture(exact, now).toISOString()).toBe(now.toISOString());
    const oneSecondFuture = buildLocalSessionInstant(exactParts.fecha, exactParts.hora, { seconds: 1 }).instant;
    expect(() => validateSessionInstantIsNotFuture(oneSecondFuture, now)).toThrow(/futuro/i);
    const futureParts = localInputParts(new Date(now.getTime() + 60000));
    const future = buildLocalSessionInstant(futureParts.fecha, futureParts.hora).instant;
    expect(() => validateSessionInstantIsNotFuture(future, now)).toThrow(/futuro/i);
  });
});

describe('sesiones de lectura integradas con SQLite', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-23T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  async function setupBook(data = {}) {
    const { database, sqlite } = loadSubject();
    await database.inicializarBaseDeDatos();
    const id = await database.insertarLibro({
      titulo: 'Libro de prueba', paginas_totales: 300, pagina_actual: 100, estado: 'quiero leer', ...data,
    });
    const book = await database.obtenerLibroPorId(id);
    return { database, sqlite, id, book };
  }

  test('primera sesión crea fecha de inicio y estado leyendo', async () => {
    const { database, book, id } = await setupBook();
    await database.iniciarSesionLectura(book.uuid, 100);
    await expect(database.obtenerLibroPorId(id)).resolves.toMatchObject({
      fecha_inicio_lectura: '2026-07-23', estado: 'leyendo',
    });
  });

  test('sesiones posteriores no sobrescriben fecha de inicio', async () => {
    const { database, book, id } = await setupBook({ fecha_inicio_lectura: '2026-07-10', estado: 'leyendo' });
    await database.iniciarSesionLectura(book.uuid, 100);
    expect((await database.obtenerLibroPorId(id)).fecha_inicio_lectura).toBe('2026-07-10');
  });

  test('detener congela sin finalizar', async () => {
    const { database, book } = await setupBook();
    await database.iniciarSesionLectura(book.uuid, 100);
    jest.setSystemTime(new Date('2026-07-23T11:00:00Z'));
    const paused = await database.pausarSesionLectura(book.uuid);
    expect(paused).toMatchObject({ estado: 'activa', duracion_segundos: 3600 });
    expect(paused.pausada_en).toBeTruthy();
  });

  test('completar después guarda tiempo, no páginas ni progreso', async () => {
    const { database, book, id } = await setupBook();
    await database.iniciarSesionLectura(book.uuid, 100);
    jest.setSystemTime(new Date('2026-07-23T11:00:00Z'));
    await database.pausarSesionLectura(book.uuid);
    const pending = await database.completarSesionDespues(book.uuid, 'Falta la página');
    expect(pending).toMatchObject({ estado: 'pendiente', duracion_segundos: 3600, pagina_fin: null });
    expect((await database.obtenerLibroPorId(id)).pagina_actual).toBe(100);
  });

  test('completar pendiente calcula páginas y avanza progreso', async () => {
    const { database, book, id } = await setupBook();
    await database.iniciarSesionLectura(book.uuid, 100);
    jest.setSystemTime(new Date('2026-07-23T11:00:00Z'));
    await database.pausarSesionLectura(book.uuid);
    const pending = await database.completarSesionDespues(book.uuid);
    const completed = await database.completarSesionPendiente(pending.id, { paginaInicio: 100, paginaFinal: 115 });
    expect(completed).toMatchObject({ estado: 'completada', paginas_leidas: 15 });
    expect((await database.obtenerLibroPorId(id)).pagina_actual).toBe(115);
  });

  test('seguir leyendo reutiliza la misma sesión y conserva tiempo', async () => {
    const { database, book } = await setupBook();
    const original = await database.iniciarSesionLectura(book.uuid, 100);
    jest.setSystemTime(new Date('2026-07-23T10:30:00Z'));
    await database.pausarSesionLectura(book.uuid);
    jest.setSystemTime(new Date('2026-07-23T11:00:00Z'));
    const resumed = await database.reanudarSesionLectura(book.uuid);
    expect(resumed.id).toBe(original.id);
    expect(resumed.duracion_acumulada_segundos).toBe(1800);
  });

  test('recupera la sesión activa desde SQLite tras recargar módulos', async () => {
    const { database, book } = await setupBook();
    const created = await database.iniciarSesionLectura(book.uuid, 100);
    const recovered = await database.obtenerSesionActiva(book.uuid);
    expect(recovered).toMatchObject({ id: created.id, estado: 'activa', pagina_inicio: 100 });
  });

  test('expone el libro de la sesión activa para recuperarla desde Biblioteca', async () => {
    const { database, book, id } = await setupBook();
    await database.iniciarSesionLectura(book.uuid, 100);
    await expect(database.obtenerSesionActivaConLibro()).resolves.toMatchObject({
      libro_id: id, libro_titulo: 'Libro de prueba', libro_uuid: book.uuid,
    });
  });

  test('impide dos sesiones activas incluso en libros distintos', async () => {
    const { database, book } = await setupBook();
    const otherId = await database.insertarLibro({ titulo: 'Otro libro' });
    const other = await database.obtenerLibroPorId(otherId);
    await database.iniciarSesionLectura(book.uuid, 100);
    await expect(database.iniciarSesionLectura(other.uuid, 0)).rejects.toThrow(/sesión activa/i);
  });

  test('doble guardado no duplica una sesión', async () => {
    const { database, book } = await setupBook();
    await database.iniciarSesionLectura(book.uuid, 100);
    jest.setSystemTime(new Date('2026-07-23T10:30:00Z'));
    await database.pausarSesionLectura(book.uuid);
    await database.guardarSesionActiva(book.uuid, 115);
    await expect(database.guardarSesionActiva(book.uuid, 120)).rejects.toThrow(/activa/i);
    expect(await database.obtenerSesionesDeLibro(book.uuid)).toHaveLength(1);
  });

  test('sesión manual contextual se asigna al libro', async () => {
    const { database, book } = await setupBook();
    const manual = await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', duracionSegundos: 1800, paginaInicio: 100, paginaFinal: 110, nota: 'Manual',
    });
    expect(manual).toMatchObject({ libro_uuid: book.uuid, origen: 'manual', paginas_leidas: 10 });
  });

  test('sesión manual acepta fecha pasada, hora pasada del día actual e instante exacto', async () => {
    const { database, book } = await setupBook();
    const now = new Date('2026-07-23T10:30:00.000Z');
    const exact = localInputParts(now);
    const earlierToday = localInputParts(new Date(now.getTime() - 60 * 60 * 1000));
    const yesterday = localInputParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    const exactSession = await database.agregarSesionManual(book.uuid, {
      ...exact, now, duracionSegundos: 1800, paginaInicio: 100, paginaFinal: 110, nota: 'Exacta',
    });
    await database.agregarSesionManual(book.uuid, {
      ...earlierToday, now, duracionSegundos: 1200, paginaInicio: 110, paginaFinal: 118, nota: 'Hoy pasada',
    });
    await database.agregarSesionManual(book.uuid, {
      ...yesterday, now, duracionSegundos: 900, paginaInicio: 118, paginaFinal: 124, nota: 'Ayer',
    });
    await database.agregarSesionManual(book.uuid, {
      fecha: '2025-12-31', hora: '23:55', now, duracionSegundos: 600, paginaInicio: 124, paginaFinal: 128,
    });

    const rows = await database.obtenerSesionesDeLibro(book.uuid);
    expect(rows).toHaveLength(4);
    expect(exactSession).toMatchObject({
      origen: 'manual', estado: 'completada', nota: 'Exacta', paginas_leidas: 10,
      hora_inicio: now.toISOString(),
    });
  });

  test('sesión manual futura se rechaza sin crear filas ni modificar libro', async () => {
    const { database, book, id } = await setupBook({ pagina_actual: 100, fecha_inicio_lectura: null });
    const now = new Date('2026-07-23T10:30:59.000Z');
    const oneSecondFuture = localInputParts(new Date(now.getTime() + 1000));
    const oneHourFuture = localInputParts(new Date(now.getTime() + 60 * 60 * 1000));
    const tomorrow = localInputParts(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const farFuture = localInputParts(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000));
    const beforeBook = await database.obtenerLibroPorId(id);

    for (const parts of [oneSecondFuture, oneHourFuture, tomorrow, farFuture]) {
      await expect(database.agregarSesionManual(book.uuid, {
        ...parts, now, duracionSegundos: 1800, paginaInicio: 100, paginaFinal: 110,
      })).rejects.toThrow(/futuro/i);
    }

    expect(await database.obtenerSesionesDeLibro(book.uuid)).toHaveLength(0);
    await expect(database.obtenerLibroPorId(id)).resolves.toMatchObject({
      pagina_actual: beforeBook.pagina_actual,
      fecha_inicio_lectura: beforeBook.fecha_inicio_lectura,
      estado: beforeBook.estado,
    });
  });

  test('sesión manual rechaza fecha y hora inválidas sin residuos', async () => {
    const { database, book, id } = await setupBook({ pagina_actual: 100 });
    const now = new Date('2026-07-23T10:30:00.000Z');
    const beforeBook = await database.obtenerLibroPorId(id);

    await expect(database.agregarSesionManual(book.uuid, {
      fecha: '2026-02-31', hora: '09:00', now, duracionSegundos: 900, paginaInicio: 100, paginaFinal: 105,
    })).rejects.toThrow(/fecha/i);
    await expect(database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', hora: '25:00', now, duracionSegundos: 900, paginaInicio: 100, paginaFinal: 105,
    })).rejects.toThrow(/hora/i);
    await expect(database.agregarSesionManual(book.uuid, {
      fecha: '', hora: '09:00', now, duracionSegundos: 900, paginaInicio: 100, paginaFinal: 105,
    })).rejects.toThrow(/fecha/i);
    await expect(database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', hora: '', now, duracionSegundos: 900, paginaInicio: 100, paginaFinal: 105,
    })).rejects.toThrow(/hora/i);

    expect(await database.obtenerSesionesDeLibro(book.uuid)).toHaveLength(0);
    await expect(database.obtenerLibroPorId(id)).resolves.toMatchObject({
      pagina_actual: beforeBook.pagina_actual,
      fecha_inicio_lectura: beforeBook.fecha_inicio_lectura,
    });
  });

  test('permite varias sesiones manuales del mismo libro en un día', async () => {
    const { database, book } = await setupBook();
    await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', duracionSegundos: 900, paginaInicio: 100, paginaFinal: 105,
    });
    jest.setSystemTime(new Date('2026-07-23T10:01:00Z'));
    await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', duracionSegundos: 1200, paginaInicio: 105, paginaFinal: 112,
    });
    expect(await database.obtenerSesionesDeLibro(book.uuid)).toHaveLength(2);
  });

  test('sesión histórica no retrocede progreso', async () => {
    const { database, book, id } = await setupBook({ pagina_actual: 150 });
    await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', duracionSegundos: 1800, paginaInicio: 80, paginaFinal: 95,
    });
    expect((await database.obtenerLibroPorId(id)).pagina_actual).toBe(150);
  });

  test('sesión manual superior al progreso lo actualiza', async () => {
    const { database, book, id } = await setupBook({ pagina_actual: 100 });
    await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', duracionSegundos: 1800, paginaInicio: 100, paginaFinal: 125,
    });
    expect((await database.obtenerLibroPorId(id)).pagina_actual).toBe(125);
  });

  test('sesión manual crea fecha de inicio cuando es null', async () => {
    const { database, book, id } = await setupBook();
    await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-10', duracionSegundos: 1800, paginaInicio: 80, paginaFinal: 95,
    });
    expect((await database.obtenerLibroPorId(id)).fecha_inicio_lectura).toBe('2026-07-10');
  });

  test('sesión histórica anterior no sobrescribe inicio sin confirmación', async () => {
    const { database, book, id } = await setupBook({ fecha_inicio_lectura: '2026-07-15' });
    await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-10', duracionSegundos: 1800, paginaInicio: 80, paginaFinal: 95,
    });
    expect((await database.obtenerLibroPorId(id)).fecha_inicio_lectura).toBe('2026-07-15');
  });

  test('sesión histórica puede actualizar inicio con confirmación explícita', async () => {
    const { database, book, id } = await setupBook({ fecha_inicio_lectura: '2026-07-15' });
    await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-10', duracionSegundos: 1800, paginaInicio: 80, paginaFinal: 95, actualizarFechaInicio: true,
    });
    expect((await database.obtenerLibroPorId(id)).fecha_inicio_lectura).toBe('2026-07-10');
  });

  test('edita una sesión sin duplicarla', async () => {
    const { database, book } = await setupBook();
    const manual = await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', duracionSegundos: 1800, paginaInicio: 100, paginaFinal: 110,
    });
    await database.editarSesionLectura(manual.id, {
      fecha: '2026-07-19', duracionSegundos: 2400, paginaInicio: 100, paginaFinal: 115, nota: 'Corregida',
    });
    const rows = await database.obtenerSesionesDeLibro(book.uuid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paginas_leidas: 15, duracion_segundos: 2400, editada: 1 });
  });

  test('edición válida conserva la misma fila y acepta instante exacto', async () => {
    const { database, book } = await setupBook();
    const now = new Date('2026-07-23T10:30:00.000Z');
    const exact = localInputParts(now);
    const manual = await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', hora: '09:00', now, duracionSegundos: 1800,
      paginaInicio: 100, paginaFinal: 110, nota: 'Original',
    });

    const edited = await database.editarSesionLectura(manual.id, {
      ...exact, now, duracionSegundos: 2400, paginaInicio: 100, paginaFinal: 116, nota: 'Exacta',
    });

    const rows = await database.obtenerSesionesDeLibro(book.uuid);
    expect(rows).toHaveLength(1);
    expect(edited).toMatchObject({
      id: manual.id, uuid: manual.uuid, hora_inicio: now.toISOString(),
      paginas_leidas: 16, duracion_segundos: 2400, nota: 'Exacta',
    });
  });

  test('edición futura se rechaza y conserva la fila original intacta', async () => {
    const { database, book, id } = await setupBook({ pagina_actual: 110, fecha_inicio_lectura: '2026-07-20' });
    const now = new Date('2026-07-23T10:30:00.000Z');
    const manual = await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', hora: '09:00', now, duracionSegundos: 1800,
      paginaInicio: 100, paginaFinal: 110, nota: 'Original',
    });
    const beforeRows = await database.obtenerSesionesDeLibro(book.uuid);
    const beforeBook = await database.obtenerLibroPorId(id);
    const futureToday = localInputParts(new Date(now.getTime() + 60 * 60 * 1000));
    const tomorrow = localInputParts(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    for (const parts of [futureToday, tomorrow]) {
      await expect(database.editarSesionLectura(manual.id, {
        ...parts, now, duracionSegundos: 3600, paginaInicio: 100, paginaFinal: 130,
        nota: 'No debe persistir',
      })).rejects.toThrow(/futuro/i);
    }

    await expect(database.obtenerSesionesDeLibro(book.uuid)).resolves.toEqual(beforeRows);
    await expect(database.obtenerLibroPorId(id)).resolves.toMatchObject({
      pagina_actual: beforeBook.pagina_actual,
      fecha_inicio_lectura: beforeBook.fecha_inicio_lectura,
      estado: beforeBook.estado,
    });
  });

  test('un intento futuro fallido no deja residuos y luego permite un único intento válido', async () => {
    const { database, book } = await setupBook();
    const now = new Date('2026-07-23T10:30:00.000Z');
    const future = localInputParts(new Date(now.getTime() + 60 * 1000));
    const valid = localInputParts(new Date(now.getTime() - 60 * 1000));

    await expect(database.agregarSesionManual(book.uuid, {
      ...future, now, duracionSegundos: 900, paginaInicio: 100, paginaFinal: 105,
    })).rejects.toThrow(/futuro/i);
    await database.agregarSesionManual(book.uuid, {
      ...valid, now, duracionSegundos: 900, paginaInicio: 100, paginaFinal: 105,
    });

    expect(await database.obtenerSesionesDeLibro(book.uuid)).toHaveLength(1);
  });

  test('completa una pendiente conservando cambios de fecha, hora y duración', async () => {
    const { database, book } = await setupBook();
    await database.iniciarSesionLectura(book.uuid, 100);
    jest.setSystemTime(new Date('2026-07-23T11:00:00Z'));
    await database.pausarSesionLectura(book.uuid);
    const pending = await database.completarSesionDespues(book.uuid);
    const edited = await database.editarSesionLectura(pending.id, {
      fecha: '2026-07-20', hora: '09:30', duracionSegundos: 2700,
      paginaInicio: 100, paginaFinal: 118, estado: 'completada',
    });
    expect(edited).toMatchObject({
      fecha: '2026-07-20', duracion_segundos: 2700, paginas_leidas: 18, estado: 'completada',
    });
    expect(await database.obtenerSesionesDeLibro(book.uuid)).toHaveLength(1);
  });

  test('elimina una sesión sin reducir el progreso', async () => {
    const { database, book, id } = await setupBook({ pagina_actual: 150 });
    const manual = await database.agregarSesionManual(book.uuid, {
      fecha: '2026-07-20', duracionSegundos: 1800, paginaInicio: 140, paginaFinal: 160,
    });
    await database.eliminarSesionLectura(manual.id);
    expect(await database.obtenerSesionesDeLibro(book.uuid)).toHaveLength(0);
    expect((await database.obtenerLibroPorId(id)).pagina_actual).toBe(160);
  });

  test('cambiar a leyendo crea inicio sin alterar fecha agregada', async () => {
    const { database, id } = await setupBook();
    const before = await database.obtenerLibroPorId(id);
    await database.actualizarLibro(id, { estado: 'leyendo' });
    const after = await database.obtenerLibroPorId(id);
    expect(after.fecha_inicio_lectura).toBe('2026-07-23');
    expect(after.fecha_agregado).toBe(before.fecha_agregado);
  });

  test('marcar terminado conserva inicio y guarda fin', async () => {
    const { database, id } = await setupBook({ estado: 'leyendo', fecha_inicio_lectura: '2026-07-10' });
    await database.actualizarLibro(id, { estado: 'terminado', fecha_fin: '2026-07-22' });
    expect(await database.obtenerLibroPorId(id)).toMatchObject({
      estado: 'terminado', fecha_inicio_lectura: '2026-07-10', fecha_fin: '2026-07-22',
    });
  });

  test('rechaza fin anterior al inicio sin modificar datos', async () => {
    const { database, id } = await setupBook({ estado: 'leyendo', fecha_inicio_lectura: '2026-07-20' });
    await expect(database.actualizarLibro(id, { estado: 'terminado', fecha_fin: '2026-07-15' })).rejects.toThrow(/anterior/i);
    expect((await database.obtenerLibroPorId(id)).estado).toBe('leyendo');
  });

  test('permite editar manualmente ambas fechas', async () => {
    const { database, id } = await setupBook();
    await database.actualizarLibro(id, { fecha_inicio_lectura: '2026-07-01', fecha_fin: '2026-07-20' });
    expect(await database.obtenerLibroPorId(id)).toMatchObject({ fecha_inicio_lectura: '2026-07-01', fecha_fin: '2026-07-20' });
  });
});

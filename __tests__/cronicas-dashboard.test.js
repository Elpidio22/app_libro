import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback) => require('react').useEffect(callback, [callback]),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => {
  const MockReact = require('react');
  return { Ionicons: (props) => MockReact.createElement('Ionicons', props) };
});

jest.mock('../src/database/analyticsRepository', () => ({
  obtenerDashboardAnalitico: jest.fn(),
}));

jest.mock('../src/database/revisions', () => ({
  getDatabaseRevisions: jest.fn(() => ({
    sessionsRevision: 0,
    booksRevision: 0,
    tagsRevision: 0,
    wishlistRevision: 0,
  })),
}));

const analytics = require('../src/database/analyticsRepository');
const {
  default: CronicasScreen,
  __resetCronicasCacheForTests,
} = require('../src/app/cronicas');
const { default: TagActivityChart } = require('../src/components/analytics/TagActivityChart');
const { default: MonthlyActivityChart } = require('../src/components/analytics/MonthlyActivityChart');
const { default: ActivityHeatmap } = require('../src/components/analytics/ActivityHeatmap');
const { default: ReadingEstimateCard } = require('../src/components/analytics/ReadingEstimateCard');
const { default: WishlistConversionCard } = require('../src/components/analytics/WishlistConversionCard');
const { default: MonthlyNarrative } = require('../src/components/analytics/MonthlyNarrative');
const { default: ReadingSummaries } = require('../src/components/analytics/ReadingSummaries');
const { buildMonthlyNarrative } = require('../src/components/analytics/formatters');

function dashboard(overrides = {}) {
  const base = {
    resumen: {
      paginas: 324,
      duracion_segundos: 29520,
      sesiones: 7,
      dias_activos: 6,
      dia_semana_mas_lector: 0,
    },
    velocidad: {
      paginasPorHora: 39.51,
      muestraSuficiente: true,
      sesiones_consideradas: 7,
      estimaciones_restantes: [{
        libro_uuid: 'book-1', libro_id: 1, titulo: 'Meditaciones', paginas_restantes: 132, segundos_estimados: 12000,
      }],
    },
    actividadDiaria: [{ fecha: '2026-07-10', paginas: 45, duracion_segundos: 3600, sesiones: 1 }],
    tendenciaMensual: [
      { mes: '2026-02', paginas: 0, duracion_segundos: 0, dias_activos: 0 },
      { mes: '2026-03', paginas: 80, duracion_segundos: 7200, dias_activos: 2 },
      { mes: '2026-04', paginas: 120, duracion_segundos: 10800, dias_activos: 3 },
      { mes: '2026-05', paginas: 190, duracion_segundos: 18000, dias_activos: 4 },
      { mes: '2026-06', paginas: 200, duracion_segundos: 19000, dias_activos: 5 },
      { mes: '2026-07', paginas: 324, duracion_segundos: 29520, dias_activos: 6 },
    ],
    etiquetas: [
      { uuid: 'tag-1', nombre: 'Filosofía', paginas: 200, duracion_segundos: 18000, sesiones: 4 },
      { uuid: 'tag-2', nombre: 'Favoritos', paginas: 200, duracion_segundos: 18000, sesiones: 4 },
    ],
    librosDestacados: [{ uuid: 'book-1', titulo: 'Meditaciones', paginas: 200, duracion_segundos: 18000 }],
    wishlist: {
      activos: 3,
      adquiridos: 2,
      descartados: 1,
      tasa_adquisicion: 2 / 3,
      segundos_promedio_hasta_adquirir: 172800,
    },
    resumenesLectura: [],
    _meta: {
      generation: 1,
      revisions: { sessionsRevision: 0, booksRevision: 0, tagsRevision: 0, wishlistRevision: 0 },
      etiquetas_atribucion: 'Cada sesión aporta por completo a cada etiqueta del libro.',
    },
  };
  return {
    ...base,
    ...overrides,
    resumen: { ...base.resumen, ...overrides.resumen },
    velocidad: { ...base.velocidad, ...overrides.velocidad },
    wishlist: { ...base.wishlist, ...overrides.wishlist },
    _meta: { ...base._meta, ...overrides._meta },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Dashboard de Crónicas', () => {
  let consoleError;

  beforeEach(() => {
    __resetCronicasCacheForTests();
    analytics.obtenerDashboardAnalitico.mockReset();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('muestra el esqueleto durante la primera carga', async () => {
    const pending = deferred();
    analytics.obtenerDashboardAnalitico.mockReturnValue(pending.promise);
    const screen = await render(<CronicasScreen />);

    expect(screen.getByTestId('dashboard-skeleton')).toBeTruthy();
    await act(async () => pending.resolve(dashboard()));
    await waitFor(() => expect(screen.getByText('Tu actividad de lectura')).toBeTruthy());
  });

  test('renderiza datos completos, tarjetas y gráfico mensual', async () => {
    analytics.obtenerDashboardAnalitico.mockResolvedValue(dashboard());
    const screen = await render(<CronicasScreen />);

    await waitFor(() => expect(screen.getByText('Tu actividad de lectura')).toBeTruthy());
    expect(screen.getByText('324')).toBeTruthy();
    expect(screen.getByText('8 h 12 min')).toBeTruthy();
    expect(screen.getByText('40 pág/h')).toBeTruthy();
    expect(screen.getByTestId('monthly-svg-chart')).toBeTruthy();
  });

  test('renderiza las secciones diferidas con datos completos', async () => {
    const data = dashboard();
    const screen = await render(
      <>
        <ReadingEstimateCard velocity={data.velocidad} />
        <WishlistConversionCard data={data.wishlist} />
        <MonthlyNarrative data={data} />
      </>
    );

    expect(screen.getByText('Te quedan aproximadamente 3 h 20 min')).toBeTruthy();
    expect(screen.getByText('Descartados')).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByText(/Este mes leíste 324 páginas durante 8 h 12 min/)).toBeTruthy();
  });

  test('maneja un dashboard sin sesiones y una muestra insuficiente', async () => {
    analytics.obtenerDashboardAnalitico.mockResolvedValue(dashboard({
      resumen: { paginas: 0, duracion_segundos: 0, sesiones: 0, dias_activos: 0, dia_semana_mas_lector: null },
      velocidad: { paginasPorHora: 0, muestraSuficiente: false, sesiones_consideradas: 0, estimaciones_restantes: [] },
      actividadDiaria: [],
      tendenciaMensual: [],
      etiquetas: [],
      librosDestacados: [],
      wishlist: { activos: 0, adquiridos: 0, descartados: 0, tasa_adquisicion: 0, segundos_promedio_hasta_adquirir: null },
    }));
    const screen = await render(<CronicasScreen />);

    await waitFor(() => expect(screen.getByText('Tu historia empieza con una sesión')).toBeTruthy());
    expect(screen.getByText('Todavía no hay actividad mensual para representar.')).toBeTruthy();
    expect(screen.getByText('Cuando termines un libro, acá aparecerá la historia de esa lectura.')).toBeTruthy();
  });

  test('abre el detalle de un resumen terminado con actividad registrada', async () => {
    const screen = await render(
      <ReadingSummaries data={[{
        id: 7, uuid: 'summary-book-0001', isbn: '9789870000001', titulo: 'Lectura resumida',
        autor: 'Autora', portada_url: null, paginas_totales: 200, pagina_actual: 200,
        estado: 'terminado', calificacion: 5, notas: 'Nota final', fecha_fin: '2026-07-15',
        etiquetas: [{ uuid: 'tag-summary-01', nombre: 'Ensayo' }],
        actividad: {
          sesiones: 2, sesiones_excluidas: 0, primera_sesion: '2026-07-10',
          ultima_sesion: '2026-07-12', dias_calendario: 3, dias_activos: 2,
          racha_maxima: 1, regularidad: 2 / 3, paginas_registradas: 80,
          duracion_segundos: 7200, paginas_promedio_sesion: 40,
          minutos_promedio_sesion: 60, velocidad_paginas_hora: 40,
          cobertura_sesiones: 0.4, cobertura_parcial: true,
        },
      }]} />
    );

    await act(async () => fireEvent.press(screen.getByTestId('reading-summary-summary-book-0001')));
    await waitFor(() => expect(screen.getByText('Resumen de lectura')).toBeTruthy());
    expect(screen.getByText('Actividad registrada')).toBeTruthy();
    expect(screen.getByText(/Cobertura aproximada por sesiones: 40%/)).toBeTruthy();
    expect(screen.getByText('Nota final')).toBeTruthy();
  });

  test('explica una muestra insuficiente sin inventar estimaciones', async () => {
    const screen = await render(
      <ReadingEstimateCard velocity={{
        paginasPorHora: 0,
        muestraSuficiente: false,
        sesiones_consideradas: 0,
        estimaciones_restantes: [],
      }} />
    );

    expect(screen.getByText('Aún estamos aprendiendo tu ritmo')).toBeTruthy();
  });

  test('tolera secciones nulas y mantiene estados vacíos utilizables', async () => {
    const screen = await render(
      <>
        <MonthlyActivityChart data={null} />
        <ActivityHeatmap data={null} />
        <TagActivityChart data={null} />
        <ReadingEstimateCard velocity={null} />
        <WishlistConversionCard data={null} />
      </>
    );

    expect(screen.getByText('Todavía no hay actividad mensual para representar.')).toBeTruthy();
    expect(screen.getByText('Asigna etiquetas a tus libros para descubrir patrones.')).toBeTruthy();
    expect(screen.getByText('Aún estamos aprendiendo tu ritmo')).toBeTruthy();
    expect(screen.getByText('Descartados')).toBeTruthy();
    expect(screen.getByText('Todavía no hay tiempo medio disponible.')).toBeTruthy();
  });

  test('mantiene seguro el gráfico cuando todos los valores son cero', async () => {
    const screen = await render(<MonthlyActivityChart data={[
      { mes: '2026-06', paginas: 0, duracion_segundos: 0 },
      { mes: '2026-07', paginas: 0, duracion_segundos: 0 },
    ]} />);

    expect(screen.queryByTestId('monthly-svg-chart')).toBeNull();
    expect(screen.getByText('Todavía no hay actividad mensual para representar.')).toBeTruthy();
  });

  test('muestra etiquetas superpuestas como actividad y no como porcentajes exclusivos', async () => {
    const screen = await render(
      <TagActivityChart
        data={dashboard().etiquetas}
        attribution="Cada sesión aporta por completo a cada etiqueta del libro."
      />
    );
    expect(screen.getByText('Filosofía')).toBeTruthy();
    expect(screen.getByText('Favoritos')).toBeTruthy();
    expect(screen.getAllByText('200 pág.')).toHaveLength(2);
    expect(screen.getByText(/Cada sesión aporta por completo/)).toBeTruthy();
  });

  test('expone el error y permite reintentar', async () => {
    analytics.obtenerDashboardAnalitico
      .mockRejectedValueOnce(new Error('sqlite no disponible'))
      .mockResolvedValueOnce(dashboard());
    const screen = await render(<CronicasScreen />);

    await waitFor(() => expect(screen.getByTestId('dashboard-error')).toBeTruthy());
    fireEvent.press(screen.getByText('REINTENTAR'));
    await waitFor(() => expect(screen.getByText('324')).toBeTruthy());
    expect(analytics.obtenerDashboardAnalitico).toHaveBeenLastCalledWith({ force: true });
  });

  test('pull-to-refresh fuerza una consulta nueva sin ocultar los datos', async () => {
    analytics.obtenerDashboardAnalitico
      .mockResolvedValueOnce(dashboard())
      .mockResolvedValueOnce(dashboard({ resumen: { paginas: 400 } }));
    const screen = await render(<CronicasScreen />);
    await waitFor(() => expect(screen.getByText('324')).toBeTruthy());

    await act(async () => {
      screen.getByTestId('cronicas-dashboard').props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(screen.getByText('400')).toBeTruthy());
    expect(analytics.obtenerDashboardAnalitico).toHaveBeenLastCalledWith({ force: true });
  });

  test('reutiliza la caché visible mientras revalida al volver', async () => {
    analytics.obtenerDashboardAnalitico.mockResolvedValueOnce(dashboard());
    const first = await render(<CronicasScreen />);
    await waitFor(() => expect(first.getByText('324')).toBeTruthy());
    first.unmount();

    const pending = deferred();
    analytics.obtenerDashboardAnalitico.mockReturnValueOnce(pending.promise);
    const second = await render(<CronicasScreen />);
    expect(second.getByText('324')).toBeTruthy();
    expect(second.queryByTestId('dashboard-skeleton')).toBeNull();
    await act(async () => pending.resolve(dashboard()));
  });

  test('construye una narrativa segura con datos parciales', () => {
    expect(buildMonthlyNarrative({ resumen: { paginas: 1, duracion_segundos: 60 }, librosDestacados: [] }))
      .toBe('Este mes leíste 1 página durante 1 min.');
  });
});

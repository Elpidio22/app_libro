jest.mock('expo-router', () => {
  const React = require('react');
  const router = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
  return {
    useLocalSearchParams: () => ({ id: '1' }),
    useRouter: () => router,
    useFocusEffect: (callback) => React.useEffect(() => callback(), [callback]),
    __router: router,
  };
});

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///virtual/cache/seleccion-ui.jpg' }],
  })),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: (props) => React.createElement('Ionicons', props) };
});

const { fireEvent, render, waitFor } = require('@testing-library/react-native');
const { Alert, Image } = require('react-native');
const SQLite = require('expo-sqlite');
const FileSystem = require('expo-file-system');
const database = require('../src/database');
const LibroDetalleScreen = require('../src/app/libro/[id]').default;

describe('edición de portada desde la ficha del libro', () => {
  let consoleError;

  beforeEach(async () => {
    SQLite.__reset();
    FileSystem.__reset();
    Image.getSize = jest.fn((uri, success) => success(700, 1050));
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    await database.inicializarBaseDeDatos();
    await database.insertarLibro({
      titulo: 'Libro editable',
      autor: 'Autora',
      paginas_totales: 120,
      pagina_actual: 10,
      estado: 'leyendo',
    });
    const source = new FileSystem.File(FileSystem.Paths.cache, 'seleccion-ui.jpg');
    source.create();
    source.write('imagen-ui');
  });

  afterEach(() => {
    Alert.alert.mockRestore();
    consoleError.mockRestore();
  });

  test('revierte físicamente la portada si guardar desde la UI falla', async () => {
    const screen = await render(<LibroDetalleScreen />);
    await waitFor(() => expect(screen.getByText('Libro editable')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Editar libro'));
    await fireEvent.press(screen.getByText('GALERÍA'));
    await waitFor(() => {
      expect(FileSystem.__list().some((uri) => uri.includes('/portadas-temporales/portada_temporal_'))).toBe(true);
    });

    SQLite.__failNextBookUpdate(new Error('fallo SQLite desde la UI'));
    await fireEvent.press(screen.getByText('GUARDAR CRÓNICA'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('No se pudo guardar', 'fallo SQLite desde la UI');
    });
    expect(FileSystem.__list().some((uri) => uri.includes('/portadas-temporales/portada_temporal_'))).toBe(false);
    expect(FileSystem.__list().some((uri) => uri.includes('/portadas/portada_optimizada_'))).toBe(false);
  });
});

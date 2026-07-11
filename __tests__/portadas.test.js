function loadSubject() {
  jest.resetModules();
  const { Image } = require('react-native');
  Image.getSize = jest.fn((uri, success) => success(700, 1050));
  const sqlite = require('expo-sqlite');
  const fileSystem = require('expo-file-system');
  sqlite.__reset();
  fileSystem.__reset();
  return {
    sqlite,
    fileSystem,
    portadas: require('../src/portadas'),
    database: require('../src/database'),
  };
}

function createSource(fileSystem) {
  const source = new fileSystem.File(fileSystem.Paths.cache, 'entrada.jpg');
  source.create();
  source.write('imagen-original');
  return source;
}

describe('pipeline de portadas', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('elimina la portada promovida si SQLite falla al actualizar', async () => {
    const { database, fileSystem, portadas, sqlite } = loadSubject();
    await database.inicializarBaseDeDatos();
    const bookId = await database.insertarLibro({
      titulo: 'Libro sin portada',
      autor: 'Autor',
      paginas_totales: 100,
      pagina_actual: 0,
      estado: 'quiero leer',
    });
    const source = createSource(fileSystem);
    const temporaryCover = await portadas.optimizarYGuardarPortada(source.uri, { temporal: true });
    expect(fileSystem.__has(temporaryCover)).toBe(true);
    sqlite.__failNextBookUpdate(new Error('SQLite no pudo guardar'));

    await expect(database.actualizarLibro(bookId, { portada_url: temporaryCover }))
      .rejects.toThrow('SQLite no pudo guardar');

    expect(fileSystem.__has(temporaryCover)).toBe(false);
    expect(fileSystem.__list().filter((uri) => uri.includes('/portadas/portada_optimizada_'))).toHaveLength(0);
    expect((await database.obtenerLibroPorId(bookId)).portada_url).toBeNull();
  });

  test.each([
    ['ENOSPC: no space left on device', 'SIN_ESPACIO'],
    ['EACCES: permission denied', 'PERMISO_DENEGADO'],
  ])('clasifica el error de filesystem %s como %s', async (message, expectedCode) => {
    const { fileSystem, portadas } = loadSubject();
    const source = createSource(fileSystem);
    fileSystem.__setFailure('file.copy', new Error(message));

    await expect(portadas.optimizarYGuardarPortada(source.uri, { temporal: true }))
      .rejects.toMatchObject({
        name: 'PortadaError',
        codigo: expectedCode,
      });
  });
});

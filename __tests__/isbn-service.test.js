jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const {
  buscarLibroPorISBN,
  convertirISBN10a13,
  convertirISBN13a10,
  normalizarISBN,
  obtenerVariantesISBN,
  validarISBN10,
  validarISBN13,
} = require('../src/services/isbnService');

const ISBN10 = '0306406152';
const ISBN13 = '9780306406157';
const ISBN10_X = '080442957X';
const ISBN13_X = '9780804429573';
const ISBN979 = '9791090636071';

function googleItem(isbn, data = {}) {
  return {
    volumeInfo: {
      industryIdentifiers: [{ type: isbn.length === 10 ? 'ISBN_10' : 'ISBN_13', identifier: isbn }],
      ...data,
    },
  };
}

function configurarHTTP({ googleItems = [], openDirect = null, openDocs = [], mercadoItems = [] } = {}) {
  axios.get.mockImplementation(async (url, config) => {
    if (url.includes('googleapis.com')) return { data: { items: googleItems } };
    if (url.endsWith('/api/books')) {
      const key = config.params.bibkeys;
      return { data: openDirect ? { [key]: openDirect } : {} };
    }
    if (url.endsWith('/search.json')) return { data: { docs: openDocs } };
    if (url.includes('mercadolibre.com')) return { data: { results: mercadoItems } };
    throw new Error(`URL inesperada: ${url}`);
  });
}

describe('normalización y validación ISBN', () => {
  test('normaliza prefijos, espacios y guiones', () => {
    expect(normalizarISBN(' ISBN-13: 978-0-306-40615-7 ')).toBe(ISBN13);
    expect(normalizarISBN('ISBN 0-8044-2957-x')).toBe(ISBN10_X);
    expect(normalizarISBN('978.0.306.40615.7')).toBeNull();
  });

  test('acepta ISBN-10 válido y rechaza checksum inválido', () => {
    expect(validarISBN10(ISBN10)).toBe(true);
    expect(validarISBN10('0306406153')).toBe(false);
  });

  test('acepta X únicamente como control final de ISBN-10', () => {
    expect(validarISBN10(ISBN10_X)).toBe(true);
    expect(validarISBN10('08044X9570')).toBe(false);
    expect(normalizarISBN('X804429570')).toBeNull();
  });

  test('acepta ISBN-13 bibliográficos 978 y 979', () => {
    expect(validarISBN13(ISBN13)).toBe(true);
    expect(validarISBN13(ISBN979)).toBe(true);
  });

  test('rechaza checksum inválido y EAN no bibliográfico', () => {
    expect(validarISBN13('9780306406158')).toBe(false);
    expect(validarISBN13('4006381333931')).toBe(false);
    expect(obtenerVariantesISBN('4006381333931')).toEqual([]);
  });

  test('convierte variantes equivalentes sin duplicarlas', () => {
    expect(convertirISBN10a13(ISBN10)).toBe(ISBN13);
    expect(convertirISBN10a13(ISBN10_X)).toBe(ISBN13_X);
    expect(convertirISBN13a10(ISBN13)).toBe(ISBN10);
    expect(convertirISBN13a10(ISBN979)).toBeNull();
    expect(obtenerVariantesISBN(ISBN10)).toEqual([ISBN10, ISBN13]);
    expect(obtenerVariantesISBN(ISBN979)).toEqual([ISBN979]);
  });
});

describe('búsqueda bibliográfica exacta', () => {
  beforeEach(() => {
    axios.get.mockReset();
  });

  test('selecciona la coincidencia exacta entre varios resultados', async () => {
    configurarHTTP({
      googleItems: [
        googleItem('9788408172177', { title: 'Otra edición' }),
        googleItem(ISBN13, { title: 'La edición correcta', authors: ['Autora'] }),
      ],
    });

    const resultado = await buscarLibroPorISBN(ISBN10);

    expect(resultado).toMatchObject({
      status: 'found', isbn: ISBN10, variantes: [ISBN10, ISBN13],
      data: { titulo: 'La edición correcta', autor: 'Autora' },
      fuentes: ['Google Books'],
    });
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('googleapis.com'), expect.objectContaining({
      params: expect.objectContaining({ printType: 'books', maxResults: 5 }),
    }));
  });

  test('descarta resultados pertenecientes a otra edición', async () => {
    configurarHTTP({ googleItems: [googleItem('9788408172177', { title: 'Edición distinta' })] });

    const resultado = await buscarLibroPorISBN(ISBN13);

    expect(resultado.status).toBe('not_found');
    expect(resultado.data).toBeNull();
  });

  test('acepta datos parciales de una edición verificada', async () => {
    configurarHTTP({ googleItems: [googleItem(ISBN13, { title: 'Solo título' })] });

    const resultado = await buscarLibroPorISBN(ISBN13);

    expect(resultado.status).toBe('found');
    expect(resultado.data).toMatchObject({ titulo: 'Solo título', autor: '', paginas_totales: '' });
    expect(resultado.fuentesPorCampo).toEqual({ titulo: 'Google Books' });
  });

  test('combina campos faltantes entre proveedores exactos sin sobrescribir', async () => {
    configurarHTTP({
      googleItems: [googleItem(ISBN13, { title: 'Título Google', publisher: 'Editorial G' })],
      openDirect: {
        title: 'Título Open',
        identifiers: { isbn_13: [ISBN13] },
        authors: [{ name: 'Autor Open' }],
        number_of_pages: 321,
      },
    });

    const resultado = await buscarLibroPorISBN(ISBN13);

    expect(resultado.data).toMatchObject({
      titulo: 'Título Google', autor: 'Autor Open', paginas_totales: '321', editorial: 'Editorial G',
    });
    expect(resultado.fuentes).toEqual(['Google Books', 'Open Library']);
    expect(resultado.fuentesPorCampo).toMatchObject({
      titulo: 'Google Books', autor: 'Open Library', paginas_totales: 'Open Library',
    });
  });

  test('devuelve error de red cuando no pudo consultar los catálogos', async () => {
    const error = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    axios.get.mockRejectedValue(error);

    const resultado = await buscarLibroPorISBN(ISBN13);

    expect(resultado.status).toBe('network_error');
    expect(resultado.errores).not.toHaveLength(0);
  });

  test('distingue timeout', async () => {
    const error = Object.assign(new Error('timeout of 10s exceeded'), { code: 'ECONNABORTED' });
    axios.get.mockRejectedValue(error);

    const resultado = await buscarLibroPorISBN(ISBN13);

    expect(resultado.status).toBe('timeout');
  });

  test('un proveedor puede fallar mientras otro completa la búsqueda', async () => {
    axios.get.mockImplementation(async (url, config) => {
      if (url.includes('googleapis.com')) throw Object.assign(new Error('sin red'), { code: 'ERR_NETWORK' });
      if (url.endsWith('/api/books')) {
        return {
          data: {
            [config.params.bibkeys]: {
              title: 'Encontrado en Open Library',
              identifiers: { isbn_13: [ISBN13] },
              authors: [{ name: 'Autora OL' }],
            },
          },
        };
      }
      if (url.endsWith('/search.json')) return { data: { docs: [] } };
      return { data: { results: [] } };
    });

    const resultado = await buscarLibroPorISBN(ISBN13);

    expect(resultado.status).toBe('found');
    expect(resultado.data.titulo).toBe('Encontrado en Open Library');
    expect(resultado.errores).toEqual(expect.arrayContaining([
      expect.objectContaining({ fuente: 'Google Books', codigo: 'network_error' }),
    ]));
  });

  test('respeta una cancelación sin iniciar HTTP', async () => {
    const controller = new AbortController();
    controller.abort();

    const resultado = await buscarLibroPorISBN(ISBN13, { signal: controller.signal });

    expect(resultado.status).toBe('canceled');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('rechaza la búsqueda antes de HTTP si el ISBN es inválido', async () => {
    const resultado = await buscarLibroPorISBN('9780306406158');
    expect(resultado.status).toBe('invalid_isbn');
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('duplicados por ISBN equivalente', () => {
  test('ISBN-10 e ISBN-13 978 comparten el mismo conjunto de identidad', () => {
    expect(obtenerVariantesISBN(ISBN10)).toEqual(expect.arrayContaining(obtenerVariantesISBN(ISBN13)));
    expect(obtenerVariantesISBN(ISBN13)).toEqual(expect.arrayContaining(obtenerVariantesISBN(ISBN10)));
  });
});

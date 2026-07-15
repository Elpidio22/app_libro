import axios from 'axios';

const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY_BOOKS_URL = 'https://openlibrary.org/api/books';
const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';
const MERCADO_LIBRE_URL = 'https://api.mercadolibre.com/sites/MLA/search';
const REQUEST_TIMEOUT = 10000;

const STATUS = Object.freeze({
  FOUND: 'found',
  NOT_FOUND: 'not_found',
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate_limited',
  CANCELED: 'canceled',
  INVALID_ISBN: 'invalid_isbn',
});

const CAMPOS = [
  'titulo',
  'autor',
  'paginas_totales',
  'portada_url',
  'editorial',
  'fecha_publicacion',
  'idioma',
];

export function normalizarISBN(value) {
  const sinPrefijo = String(value ?? '').trim().replace(/^ISBN(?:-1[03])?\s*:?[\s-]*/i, '');
  const normalizado = sinPrefijo.replace(/[\s-]/g, '').toUpperCase();
  if (!/^(?:\d{9}[\dX]|\d{13})$/.test(normalizado)) return null;
  return normalizado;
}

export function validarISBN10(value) {
  const isbn = normalizarISBN(value);
  if (!isbn || !/^\d{9}[\dX]$/.test(isbn)) return false;
  const suma = [...isbn].reduce((total, caracter, index) => {
    const digito = caracter === 'X' ? 10 : Number(caracter);
    return total + digito * (10 - index);
  }, 0);
  return suma % 11 === 0;
}

export function validarISBN13(value) {
  const isbn = normalizarISBN(value);
  if (!isbn || !/^97[89]\d{10}$/.test(isbn)) return false;
  const suma = [...isbn].reduce(
    (total, caracter, index) => total + Number(caracter) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return suma % 10 === 0;
}

export function convertirISBN10a13(value) {
  if (!validarISBN10(value)) return null;
  const base = `978${normalizarISBN(value).slice(0, 9)}`;
  const suma = [...base].reduce(
    (total, caracter, index) => total + Number(caracter) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return `${base}${(10 - (suma % 10)) % 10}`;
}

export function convertirISBN13a10(value) {
  if (!validarISBN13(value)) return null;
  const isbn = normalizarISBN(value);
  if (!isbn.startsWith('978')) return null;
  const base = isbn.slice(3, 12);
  const suma = [...base].reduce(
    (total, caracter, index) => total + Number(caracter) * (10 - index),
    0
  );
  const control = (11 - (suma % 11)) % 11;
  return `${base}${control === 10 ? 'X' : control}`;
}

export function obtenerVariantesISBN(value) {
  const isbn = normalizarISBN(value);
  if (!isbn) return [];
  if (validarISBN10(isbn)) return [...new Set([isbn, convertirISBN10a13(isbn)].filter(Boolean))];
  if (validarISBN13(isbn)) return [...new Set([isbn, convertirISBN13a10(isbn)].filter(Boolean))];
  return [];
}

function texto(value) {
  if (Array.isArray(value)) return value.map(texto).filter(Boolean).join(', ');
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function enteroComoTexto(value) {
  const numero = Number(value);
  return Number.isInteger(numero) && numero > 0 ? String(numero) : '';
}

function portadaSegura(value) {
  const url = texto(value);
  return url ? url.replace(/^http:/i, 'https:') : null;
}

function coincideConVariantes(identificadores, variantes) {
  const declarados = identificadores
    .flatMap((value) => obtenerVariantesISBN(value))
    .filter(Boolean);
  return declarados.some((isbn) => variantes.includes(isbn));
}

function crearCandidato(fuente, identificadores, data) {
  return { fuente, identificadores, data };
}

function candidatoGoogle(item, variantes) {
  const info = item?.volumeInfo;
  const identificadores = (info?.industryIdentifiers || [])
    .filter((entry) => entry?.type === 'ISBN_10' || entry?.type === 'ISBN_13')
    .map((entry) => entry.identifier);
  if (!coincideConVariantes(identificadores, variantes)) return null;
  return crearCandidato('Google Books', identificadores, {
    titulo: texto(info?.title),
    autor: texto(info?.authors),
    paginas_totales: enteroComoTexto(info?.pageCount),
    portada_url: portadaSegura(info?.imageLinks?.extraLarge || info?.imageLinks?.large
      || info?.imageLinks?.medium || info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail),
    editorial: texto(info?.publisher),
    fecha_publicacion: texto(info?.publishedDate),
    idioma: texto(info?.language),
  });
}

function identificadoresOpenLibrary(info) {
  return [
    ...(info?.identifiers?.isbn_10 || []),
    ...(info?.identifiers?.isbn_13 || []),
    ...(info?.isbn || []),
  ];
}

function candidatoOpenLibraryDirect(info, variantes) {
  const identificadores = identificadoresOpenLibrary(info);
  if (!coincideConVariantes(identificadores, variantes)) return null;
  return crearCandidato('Open Library', identificadores, {
    titulo: texto(info?.title),
    autor: texto((info?.authors || []).map((author) => author?.name)),
    paginas_totales: enteroComoTexto(info?.number_of_pages),
    portada_url: portadaSegura(info?.cover?.large || info?.cover?.medium || info?.cover?.small),
    editorial: texto((info?.publishers || []).map((publisher) => publisher?.name || publisher)),
    fecha_publicacion: texto(info?.publish_date),
    idioma: texto((info?.languages || []).map((language) => language?.key?.split('/').pop() || language)),
  });
}

function candidatoOpenLibrarySearch(info, variantes) {
  const identificadores = identificadoresOpenLibrary(info);
  if (!coincideConVariantes(identificadores, variantes)) return null;
  return crearCandidato('Open Library', identificadores, {
    titulo: texto(info?.title),
    autor: texto(info?.author_name),
    paginas_totales: enteroComoTexto(info?.number_of_pages_median),
    portada_url: info?.cover_i ? `https://covers.openlibrary.org/b/id/${info.cover_i}-L.jpg` : null,
    editorial: texto(Array.isArray(info?.publisher) ? info.publisher[0] : info?.publisher),
    fecha_publicacion: texto(info?.first_publish_year),
    idioma: texto(Array.isArray(info?.language) ? info.language[0] : info?.language),
  });
}

function isbnDesdeAtributosMercadoLibre(item) {
  const valores = [];
  for (const atributo of item?.attributes || []) {
    const nombre = `${atributo?.id || ''} ${atributo?.name || ''}`.toUpperCase();
    if (!nombre.includes('ISBN')) continue;
    valores.push(atributo?.value_name);
    for (const value of atributo?.values || []) valores.push(value?.name);
  }
  return valores.filter(Boolean);
}

function candidatoMercadoLibre(item, variantes) {
  const identificadores = isbnDesdeAtributosMercadoLibre(item);
  if (!coincideConVariantes(identificadores, variantes)) return null;
  return crearCandidato('Mercado Libre', identificadores, {
    titulo: texto(item?.title),
    autor: '',
    paginas_totales: '',
    portada_url: portadaSegura(item?.secure_thumbnail || item?.thumbnail),
    editorial: '',
    fecha_publicacion: '',
    idioma: '',
  });
}

function clasificarError(error, fuente) {
  let codigo = STATUS.NETWORK_ERROR;
  if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError') {
    codigo = STATUS.CANCELED;
  } else if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    codigo = STATUS.TIMEOUT;
  } else if (error?.response?.status === 429) {
    codigo = STATUS.RATE_LIMITED;
  }
  return { fuente, codigo, mensaje: texto(error?.message) || 'Error al consultar el catálogo.' };
}

async function consultarGoogle(variantes, { client, signal, timeout, apiKey }) {
  const resultados = await Promise.allSettled(variantes.map((isbn) => client.get(GOOGLE_BOOKS_URL, {
    params: {
      q: `isbn:${isbn}`,
      printType: 'books',
      maxResults: 5,
      ...(apiKey ? { key: apiKey } : {}),
    },
    timeout,
    signal,
  })));
  const candidatos = [];
  const errores = [];
  resultados.forEach((resultado) => {
    if (resultado.status === 'rejected') errores.push(clasificarError(resultado.reason, 'Google Books'));
    else for (const item of resultado.value?.data?.items || []) {
      const candidato = candidatoGoogle(item, variantes);
      if (candidato) candidatos.push(candidato);
    }
  });
  return { candidatos, errores };
}

async function consultarOpenLibrary(variantes, { client, signal, timeout }) {
  const solicitudes = variantes.flatMap((isbn) => [
    client.get(OPEN_LIBRARY_BOOKS_URL, {
      params: { bibkeys: `ISBN:${isbn}`, format: 'json', jscmd: 'data' }, timeout, signal,
    }).then((response) => ({ tipo: 'directo', isbn, data: response.data })),
    client.get(OPEN_LIBRARY_SEARCH_URL, {
      params: {
        isbn,
        limit: 5,
        fields: 'key,title,author_name,isbn,number_of_pages_median,cover_i,publisher,first_publish_year,language',
      },
      timeout,
      signal,
    }).then((response) => ({ tipo: 'busqueda', isbn, data: response.data })),
  ]);
  const resultados = await Promise.allSettled(solicitudes);
  const candidatos = [];
  const errores = [];
  resultados.forEach((resultado) => {
    if (resultado.status === 'rejected') {
      errores.push(clasificarError(resultado.reason, 'Open Library'));
      return;
    }
    if (resultado.value.tipo === 'directo') {
      const info = resultado.value.data?.[`ISBN:${resultado.value.isbn}`];
      const candidato = candidatoOpenLibraryDirect(info, variantes);
      if (candidato) candidatos.push(candidato);
      return;
    }
    for (const info of resultado.value.data?.docs || []) {
      const candidato = candidatoOpenLibrarySearch(info, variantes);
      if (candidato) candidatos.push(candidato);
    }
  });
  return { candidatos, errores };
}

async function consultarMercadoLibre(variantes, { client, signal, timeout }) {
  const resultados = await Promise.allSettled(variantes.map((isbn) => client.get(MERCADO_LIBRE_URL, {
    params: { q: isbn, limit: 5 }, timeout, signal,
  })));
  const candidatos = [];
  const errores = [];
  resultados.forEach((resultado) => {
    if (resultado.status === 'rejected') errores.push(clasificarError(resultado.reason, 'Mercado Libre'));
    else for (const item of resultado.value?.data?.results || []) {
      const candidato = candidatoMercadoLibre(item, variantes);
      if (candidato) candidatos.push(candidato);
    }
  });
  return { candidatos, errores };
}

function fusionarCandidatos(isbn, variantes, candidatos, errores) {
  const data = {
    titulo: '', autor: '', paginas_totales: '', portada_url: null,
    editorial: '', fecha_publicacion: '', idioma: '',
  };
  const fuentes = [];
  const fuentesPorCampo = {};
  for (const candidato of candidatos) {
    let aporto = false;
    for (const campo of CAMPOS) {
      if (!data[campo] && candidato.data[campo]) {
        data[campo] = candidato.data[campo];
        fuentesPorCampo[campo] = candidato.fuente;
        aporto = true;
      }
    }
    if (aporto && !fuentes.includes(candidato.fuente)) fuentes.push(candidato.fuente);
  }
  return { status: STATUS.FOUND, isbn, variantes, data, fuentes, fuentesPorCampo, errores };
}

function estadoDeErrores(errores) {
  const codigos = errores.map((error) => error.codigo);
  if (codigos.includes(STATUS.CANCELED)) return STATUS.CANCELED;
  if (codigos.includes(STATUS.RATE_LIMITED)) return STATUS.RATE_LIMITED;
  if (codigos.includes(STATUS.TIMEOUT)) return STATUS.TIMEOUT;
  if (codigos.includes(STATUS.NETWORK_ERROR)) return STATUS.NETWORK_ERROR;
  return STATUS.NOT_FOUND;
}

export async function buscarLibroPorISBN(value, options = {}) {
  const isbn = normalizarISBN(value);
  const variantes = obtenerVariantesISBN(isbn);
  if (!isbn || variantes.length === 0) {
    return { status: STATUS.INVALID_ISBN, isbn: isbn || '', variantes: [], data: null, fuentes: [], errores: [] };
  }

  const config = {
    client: options.client || axios,
    signal: options.signal,
    timeout: options.timeout || REQUEST_TIMEOUT,
    apiKey: options.apiKey ?? process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY,
  };
  if (config.signal?.aborted) {
    return { status: STATUS.CANCELED, isbn, variantes, data: null, fuentes: [], errores: [] };
  }

  const principales = await Promise.allSettled([
    consultarGoogle(variantes, config),
    consultarOpenLibrary(variantes, config),
  ]);
  const candidatos = [];
  const errores = [];
  principales.forEach((resultado, index) => {
    const fuente = index === 0 ? 'Google Books' : 'Open Library';
    if (resultado.status === 'rejected') errores.push(clasificarError(resultado.reason, fuente));
    else {
      candidatos.push(...resultado.value.candidatos);
      errores.push(...resultado.value.errores);
    }
  });

  if (config.signal?.aborted) {
    return { status: STATUS.CANCELED, isbn, variantes, data: null, fuentes: [], errores };
  }

  if (candidatos.length === 0) {
    const mercadoLibre = await consultarMercadoLibre(variantes, config);
    candidatos.push(...mercadoLibre.candidatos);
    errores.push(...mercadoLibre.errores);
  }

  if (candidatos.length > 0) return fusionarCandidatos(isbn, variantes, candidatos, errores);
  return {
    status: estadoDeErrores(errores),
    isbn,
    variantes,
    data: null,
    fuentes: [],
    errores,
  };
}

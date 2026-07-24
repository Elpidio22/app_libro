const files = new Map();
const failures = new Map();
let textCalls = 0;

const Paths = Object.freeze({
  cache: 'file:///virtual/cache/',
  document: 'file:///virtual/document/',
});

function asUri(value) {
  if (value instanceof File || value instanceof Directory) return value.uri;
  if (value && typeof value === 'object' && value.uri) return value.uri;
  return String(value || '');
}

function join(parent, child) {
  const base = asUri(parent).replace(/\/+$/, '');
  return child === undefined ? base : `${base}/${String(child).replace(/^\/+/, '')}`;
}

function maybeFail(operation) {
  const failure = failures.get(operation);
  if (!failure) return;
  failures.delete(operation);
  throw failure;
}

class Directory {
  constructor(parent, name) {
    this.uri = join(parent, name);
  }

  get exists() {
    const prefix = `${this.uri.replace(/\/+$/, '')}/`;
    return files.has(this.uri) || [...files.keys()].some((uri) => uri.startsWith(prefix));
  }

  create() {
    maybeFail('directory.create');
    files.set(this.uri, { type: 'directory', data: null });
  }
}

class File {
  constructor(parent, name) {
    this.uri = join(parent, name);
    this.assetSize = parent && typeof parent === 'object' && !(parent instanceof File) && !(parent instanceof Directory)
      ? parent.size
      : undefined;
  }

  get exists() {
    return files.has(this.uri);
  }

  get size() {
    if (this.assetSize !== undefined) return this.assetSize;
    const entry = files.get(this.uri);
    if (!entry || entry.type !== 'file') return 0;
    const data = entry.data || '';
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(data)).length;
    return Buffer.from(typeof data === 'string' ? data : data).length;
  }

  create() {
    maybeFail('file.create');
    files.set(this.uri, { type: 'file', data: '' });
  }

  write(data) {
    maybeFail('file.write');
    files.set(this.uri, { type: 'file', data });
  }

  async text() {
    textCalls += 1;
    maybeFail('file.text');
    const entry = files.get(this.uri);
    return typeof entry?.data === 'string' ? entry.data : Buffer.from(entry?.data || []).toString('utf8');
  }

  async info() {
    maybeFail('file.info');
    return { exists: this.exists, size: this.size, uri: this.uri };
  }

  async base64() {
    maybeFail('file.base64');
    const data = files.get(this.uri)?.data || '';
    return Buffer.from(typeof data === 'string' ? data : data).toString('base64');
  }

  copy(destination) {
    maybeFail('file.copy');
    const target = destination instanceof File ? destination : new File(destination);
    if (!this.exists) throw new Error(`ENOENT: ${this.uri}`);
    const source = files.get(this.uri);
    files.set(target.uri, { type: 'file', data: source.data });
  }

  delete() {
    maybeFail('file.delete');
    files.delete(this.uri);
  }

  static async downloadFileAsync(source, destination) {
    maybeFail('file.download');
    const target = destination instanceof File ? destination : new File(destination);
    files.set(target.uri, { type: 'file', data: `download:${source}` });
    return { uri: target.uri };
  }
}

module.exports = {
  Directory,
  File,
  Paths,
  __reset() {
    files.clear();
    failures.clear();
    textCalls = 0;
  },
  __setFailure(operation, error) {
    failures.set(operation, error);
  },
  __has(uri) {
    return files.has(uri);
  },
  __list() {
    return [...files.keys()];
  },
  __textCalls() {
    return textCalls;
  },
};

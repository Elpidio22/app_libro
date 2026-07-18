let permissionResult = { granted: true, directoryUri: 'content://virtual/documents' };
let requestFailure = null;
let createFailure = null;
let writeFailure = null;
let createdFiles = [];
const contents = new Map();

const EncodingType = Object.freeze({ UTF8: 'utf8', Base64: 'base64' });

const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: jest.fn(async () => {
    if (requestFailure) throw requestFailure;
    return permissionResult;
  }),
  createFileAsync: jest.fn(async (directoryUri, name, mimeType) => {
    if (createFailure) throw createFailure;
    const uri = `${directoryUri}/${encodeURIComponent(name)}.json`;
    createdFiles.push({ uri, directoryUri, name, mimeType });
    return uri;
  }),
  writeAsStringAsync: jest.fn(async (uri, content, options) => {
    if (writeFailure) throw writeFailure;
    contents.set(uri, { content, options });
  }),
};

module.exports = {
  EncodingType,
  StorageAccessFramework,
  deleteAsync: jest.fn(async (uri) => { contents.delete(uri); }),
  __reset() {
    permissionResult = { granted: true, directoryUri: 'content://virtual/documents' };
    requestFailure = null;
    createFailure = null;
    writeFailure = null;
    createdFiles = [];
    contents.clear();
    Object.values(StorageAccessFramework).forEach((fn) => fn.mockClear());
    this.deleteAsync.mockClear();
  },
  __setPermissionResult(result) { permissionResult = result; },
  __setRequestFailure(error) { requestFailure = error; },
  __setCreateFailure(error) { createFailure = error; },
  __setWriteFailure(error) { writeFailure = error; },
  __createdFiles() { return [...createdFiles]; },
  __content(uri) { return contents.get(uri); },
};

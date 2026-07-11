jest.mock('expo-sqlite', () => require('./test/mocks/expo-sqlite'));
jest.mock('expo-file-system', () => require('./test/mocks/expo-file-system'));

jest.mock('expo-document-picker', () => {
  let result = { canceled: true, assets: [] };
  return {
    getDocumentAsync: jest.fn(async () => result),
    __setResult: (nextResult) => { result = nextResult; },
    __reset: () => { result = { canceled: true, assets: [] }; },
  };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-clipboard', () => ({
  hasImageAsync: jest.fn(async () => false),
  getImageAsync: jest.fn(async () => null),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => {
    const { File, Paths } = require('expo-file-system');
    const output = new File(Paths.cache, `manipulada-${Date.now()}-${Math.random()}.jpg`);
    output.create();
    output.write('imagen-jpeg-optimizada');
    return { uri: output.uri, width: 350, height: 525 };
  }),
}));

const { Image } = require('react-native');
Image.getSize = jest.fn((uri, success) => success(700, 1050));

const resolveConfig = require('../app.config');
const baseConfig = require('../app.json').expo;
const easConfig = require('../eas.json');

function configFor(variant) {
  const previous = process.env.APP_VARIANT;
  process.env.APP_VARIANT = variant;
  try {
    return resolveConfig({ config: baseConfig });
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
}

describe('variantes de la aplicación', () => {
  test('producción conserva identidad y package', () => {
    expect(configFor('production')).toMatchObject({
      name: 'Mi Biblioteca',
      scheme: 'applibro',
      android: { package: 'com.elpidioluna.mibiblioteca' },
      extra: { appVariant: 'production' },
    });
  });

  test('development conserva su identidad independiente', () => {
    expect(configFor('development')).toMatchObject({
      name: 'Mi Biblioteca Dev',
      scheme: 'mibiblioteca-dev',
      android: { package: 'com.elpidioluna.mibiblioteca.dev' },
      extra: { appVariant: 'development' },
    });
  });

  test('preview tiene package, scheme y nombre exclusivos', () => {
    expect(configFor('preview')).toMatchObject({
      name: 'Mi Biblioteca Prueba',
      scheme: 'mi-biblioteca-preview',
      android: { package: 'com.elpidioluna.mibiblioteca.preview' },
      extra: { appVariant: 'preview' },
    });
  });

  test('el perfil EAS preview genera APK interno sin development client', () => {
    expect(easConfig.build.preview).toMatchObject({
      developmentClient: false,
      distribution: 'internal',
      env: { APP_VARIANT: 'preview' },
      android: { buildType: 'apk' },
    });
  });
});

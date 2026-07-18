module.exports = ({ config: baseConfig }) => {
  const variant = process.env.APP_VARIANT || 'production';
  const variants = {
    production: {
      name: baseConfig.name,
      scheme: baseConfig.scheme,
      package: baseConfig.android.package,
    },
    development: {
      name: 'Mi Biblioteca Dev',
      scheme: 'mibiblioteca-dev',
      package: 'com.elpidioluna.mibiblioteca.dev',
    },
    preview: {
      name: 'Mi Biblioteca Prueba',
      scheme: 'mi-biblioteca-preview',
      package: 'com.elpidioluna.mibiblioteca.preview',
    },
  };
  const selected = variants[variant] || variants.production;

  return {
    ...baseConfig,
    name: selected.name,
    scheme: selected.scheme,
    android: {
      ...baseConfig.android,
      package: selected.package,
    },
    extra: {
      ...baseConfig.extra,
      appVariant: variant,
    },
  };
};

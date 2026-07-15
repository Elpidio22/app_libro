module.exports = ({ config: baseConfig }) => {
  const isDevelopment = process.env.APP_VARIANT === 'development';

  return {
    ...baseConfig,
    name: isDevelopment ? 'Mi Biblioteca Dev' : baseConfig.name,
    scheme: isDevelopment ? 'mibiblioteca-dev' : baseConfig.scheme,
    android: {
      ...baseConfig.android,
      package: isDevelopment
        ? 'com.elpidioluna.mibiblioteca.dev'
        : baseConfig.android.package,
    },
  };
};

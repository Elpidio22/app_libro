# WP-03 — Blindaje del esquema SQLite

Fecha: 2026-07-24

## Alcance ejecutado

- Paquete: WP-03 — Blindaje del esquema SQLite.
- ID incluido: DATA-004.
- Rama base: `fix/wp-02-atomic-migrations`.
- HEAD base: `eb4eee78c30e75edd4f5e3e7e6d2d3e751b5c859`.
- Rama de trabajo: `fix/wp-03-schema-constraints`.
- Commit funcional: `fdd3a2b fix: blindar restricciones del esquema SQLite`.

## Cambios técnicos

- `DATABASE_VERSION` sube de 7 a 8.
- `BACKUP_VERSION` permanece en 7.
- Se agregó la migración incremental v8 dentro del bloque transaccional existente.
- La migración v8 valida datos incompatibles antes de reconstruir tablas.
- Si encuentra datos inválidos, aborta la migración y conserva intacto el esquema anterior.
- Se reconstruyen las tablas principales para aplicar restricciones reales:
  - `mis_libros`
  - `lista_compras`
  - `etiquetas`
  - `libro_etiquetas`
  - `sesiones_lectura`
- Se restauran índices, claves foráneas, FTS5 y triggers después de la reconstrucción.

## Restricciones aplicadas

- UUIDs obligatorios y únicos en libros, deseos y sesiones.
- Estados restringidos mediante `CHECK`.
- Orígenes de sesiones restringidos a valores válidos.
- Campos obligatorios protegidos con `NOT NULL`.
- Conteos de páginas, progreso y duraciones protegidos contra valores negativos.
- Relaciones de etiquetas y sesiones protegidas con claves foráneas.
- Una única sesión activa global y una única sesión activa por libro se conservan mediante índices parciales.
- Deduplicación de sesiones por `(libro_uuid, hora_inicio)` se conserva.

## Validaciones de rollback

- Base limpia: migración completa hasta `user_version = 8`.
- Fixtures históricos v1 a v7: migran a v8 conservando datos e integridad.
- Falla simulada antes de `user_version`: conserva versión y datos previos.
- Falla simulada en migración final: conserva esquema y datos previos.
- Datos históricos incompatibles: la migración aborta sin subir `user_version`.

## Pruebas ejecutadas

- Pruebas dirigidas:
  - Comando: `npm test -- --runInBand __tests__/database.test.js __tests__/reading-sessions.test.js __tests__/backup-import-service.test.js`
  - Resultado: 3 suites aprobadas, 76 tests aprobados.

- Suite completa:
  - Comando: `npm test -- --runInBand`
  - Resultado: 11 suites aprobadas, 167 tests aprobados.

- Lint:
  - Comando: `npx expo lint`
  - Resultado: aprobado.

- Whitespace:
  - Comando: `git diff --check`
  - Resultado: aprobado, sólo avisos normales de conversión LF/CRLF en Windows.

## Exclusiones confirmadas

- No se modificó el formato de backup.
- No se modificó el escáner ISBN.
- No se modificaron sesiones de lectura fuera de restricciones de esquema.
- No se modificó UI/UX.
- No se agregaron dependencias.
- No se ejecutaron builds, EAS ni ADB.
- No se tocaron Producción, Preview ni Development.
- No se importaron, exportaron ni eliminaron datos reales.
- Stashes preservados intactos.

## Estado

WP-03 queda implementado y validado en la rama `fix/wp-03-schema-constraints`.

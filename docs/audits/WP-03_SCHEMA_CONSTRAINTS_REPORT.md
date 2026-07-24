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

## Evidencia complementaria de cierre

- HEAD inicial verificado para este cierre documental: `7cffc726204c39b4cfc555dbc6def9e2fab2a4bb`.
- Commit documental previo: `7cffc72 docs: registrar resultado de WP-03`.
- Rama/upstream verificados: `fix/wp-03-schema-constraints` -> `origin/fix/wp-03-schema-constraints`.
- La rama estaba limpia y sincronizada antes de modificar este reporte.
- No se modifico codigo productivo, migraciones, pruebas, configuracion ni dependencias durante este cierre documental.

## Segundo intento despues del rollback

Evidencia existente confirmada en `__tests__/database.test.js`:

- Prueba: `rollback atomico conserva esquema y datos v5 si falla la migracion final y permite segundo intento`.
- Simula una falla en `after-v8`.
- Verifica que la misma base temporal conserva el snapshot previo.
- Retira el fallo al volver a llamar `inicializarBaseDeDatos()`.
- Confirma que la segunda inicializacion llega a `user_version = 8`.
- Confirma que los datos historicos siguen presentes y que `PRAGMA integrity_check` / `foreign_key_check` quedan correctos.

## Regresion WP-01

Evidencia existente confirmada con `DATABASE_VERSION = 8` y `BACKUP_VERSION = 7`:

- `src/database.js` mantiene `BACKUP_VERSION = 7`.
- `__tests__/database.test.js` confirma que `crearDocumentoBackupJSON()` exporta `version: 7`.
- `__tests__/backup-import-service.test.js` confirma round-trip v7 en `importa v7 preservando libros, relaciones y sesiones completas`.
- La misma prueba importa el backup v7 dos veces y conserva sesiones por UUID sin duplicarlas.
- `fusionar dos veces es idempotente para libros, deseos, relaciones y sesiones` confirma Merge idempotente.
- `reemplazar exige confirmacion explicita` confirma Replace con confirmacion.
- `replace revierte SQLite y limpia portada creada si falla dentro de la transaccion` confirma rollback de Replace.
- Las sesiones v7 conservan `uuid`, `estado`, `origen` y `nota` en los casos activa, pendiente y manual.

## Regresion WP-02

Evidencia existente confirmada:

- `src/database.js` conserva una unica transaccion exterior para el salto de migraciones mediante `withExclusiveTransactionAsync`.
- La migracion v8 se ejecuta dentro de ese mismo bloque transaccional.
- `rollback atomico conserva base vacia si falla una instalacion limpia` confirma rollback completo de esquema/datos.
- `rollback atomico conserva esquema y datos v5 si falla la migracion final y permite segundo intento` confirma rollback y segundo intento exitoso.
- `rollback conserva user_version y datos si falla antes de confirmar user_version final` confirma que `user_version` no avanza ante error.

## Campos opcionales conservados

Los siguientes campos permanecen aceptando `NULL` deliberadamente porque el modelo actual permite libros incompletos, sesiones pendientes o metadatos opcionales:

- `mis_libros`: `isbn`, `autor`, `portada_url`, `paginas_totales`, `calificacion`, `notas`, `fecha_fin`, `fecha_inicio_lectura`.
- `lista_compras`: `autor`, `precio_estimado`, `fecha_resolucion`, `libro_uuid_adquirido`.
- `sesiones_lectura`: `hora_fin`, `pagina_inicio`, `pagina_fin`, `duracion_segundos`, `nota`, `ultimo_inicio`, `pausada_en`, `fecha_creacion`, `fecha_actualizacion`.

Motivo:

- Un libro puede cargarse sin ISBN, autor, portada, paginas totales, calificacion o notas.
- Un libro no terminado no debe exigir `fecha_fin`.
- Un libro pendiente o aun no iniciado no debe exigir `fecha_inicio_lectura`.
- Un deseo activo no tiene fecha de resolucion ni libro adquirido vinculado.
- Una sesion activa no tiene `hora_fin`, `pagina_fin` ni `duracion_segundos` definitivos.
- Una sesion pendiente puede no tener paginas finales.
- Los campos de pausa/reanudacion solo existen cuando la sesion pasa por esos estados.

## Matriz de datos incompatibles cubiertos

| Caso | Evidencia existente |
| --- | --- |
| UUID `NULL` | `__tests__/database.test.js` verifica `NOT NULL` en UUIDs de libros, deseos y sesiones mediante `PRAGMA table_info`. |
| UUID vacio | `src/database.js` aplica `CHECK (length(trim(uuid)) > 0)` en tablas reconstruidas y `__tests__/backup-import-service.test.js` rechaza backup con `uuid: ''`. |
| UUID duplicado | `__tests__/database.test.js` intenta insertar un libro con UUID duplicado y espera error `UNIQUE`. |
| Estado de libro invalido | `__tests__/database.test.js` intenta insertar estado `archivado` y espera error `CHECK`; `__tests__/backup-import-service.test.js` rechaza estado `desconocido`. |
| Estado de sesion invalido | `__tests__/database.test.js` intenta insertar estado `cerrada` y espera error `CHECK`; tambien valida que una migracion v7 con estado `cerrada` no sube `user_version`. |
| Origen invalido | `src/database.js` aplica `CHECK (origen IN ('cronometro', 'manual'))`; `__tests__/backup-import-service.test.js` rechaza origen `papel` en backup v7. |
| Referencia obligatoria inexistente | `__tests__/database.test.js` intenta insertar una sesion con `libro_uuid` inexistente y espera error `FOREIGN KEY`; `__tests__/backup-import-service.test.js` rechaza sesion huerfana. |

## Prueba dirigida de cierre documental

- Comando ejecutado: `npm test -- --runInBand __tests__/database.test.js __tests__/reading-sessions.test.js __tests__/backup-import-service.test.js`.
- Resultado real: 3 suites aprobadas, 76 tests aprobados.
- No se repitio la suite completa porque no hubo cambios de codigo desde `7cffc72`.

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

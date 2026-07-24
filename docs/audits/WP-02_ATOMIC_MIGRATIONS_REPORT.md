# WP-02 Atomic Migrations Report

Fecha: 2026-07-24

Rama: fix/wp-02-atomic-migrations

Commit base: 80b0f850827c8959f00eed704b9628ff59233c77

Commit funcional: e158a92 fix: hacer atomicas las migraciones SQLite

## Archivos modificados

- src/database.js
- __tests__/database.test.js

## Comportamiento anterior

La inicializacion aplicaba migraciones incrementales con bloques independientes y escribia `PRAGMA user_version` al terminar cada version intermedia.

Si una migracion posterior fallaba durante el mismo arranque, podia quedar una base parcialmente migrada y con `user_version` intermedio.

## Estrategia transaccional implementada

La preparacion no persistente imprescindible (`journal_mode = WAL` y `foreign_keys = ON`) se mantiene antes de migrar.

Si `PRAGMA user_version` ya es 7, la inicializacion retorna sin ejecutar migraciones.

Si hay migraciones pendientes, todo el salto desde la version inicial hasta 7 se ejecuta dentro de una unica `withExclusiveTransactionAsync`.

Las sentencias DDL y DML de las migraciones 1 a 7 usan la conexion transaccional recibida.

No se agrego migracion 8 y no se cambio el esquema final.

## Transaccion exterior unica

Existe una unica frontera transaccional exterior para todo el salto pendiente.

Las migraciones individuales ya no confirman `user_version` por separado ni abren transacciones internas.

## PRAGMA user_version

`PRAGMA user_version = 7` se escribe una sola vez, al final de la transaccion, despues de completar todas las migraciones pendientes.

Los tests demuestran que si falla antes de confirmar `user_version`, el valor anterior se conserva.

## Compatibilidad de instalacion limpia

La instalacion limpia `0 -> 7` completa correctamente.

Si falla durante el salto, la base vuelve al estado logico vacio: `user_version = 0`, sin tablas, indices, triggers ni datos propios de la aplicacion.

Un segundo intento sobre la misma base completa correctamente hasta version 7.

## Versiones historicas probadas

Se probaron fixtures sinteticos:

- 1 -> 7
- 2 -> 7
- 3 -> 7
- 4 -> 7
- 5 -> 7
- 6 -> 7

Los fixtures incluyen solo tablas, columnas y datos legitimos de cada version.

## Inyeccion de fallos en tests

Se agrego un callback opcional `onMigrationCheckpoint` en `inicializarBaseDeDatos(options)`.

El flujo productivo no lo usa. No depende de variables de entorno, almacenamiento persistente ni flags globales.

Puntos representativos probados:

- `after-v4`: fallo durante una migracion intermedia.
- `after-v7`: fallo durante la migracion final.
- `before-user-version`: fallo despues de DDL/DML y antes de confirmar `user_version = 7`.

## Rollback probado

Instalacion limpia fallida: snapshot posterior igual al snapshot previo vacio.

Fixture v5 fallido en migracion final: snapshot posterior igual al snapshot previo v5.

Fixture v6 fallido antes de `user_version`: snapshot posterior igual al snapshot previo v6 y `user_version = 6`.

## Comparacion de esquema y datos

Las pruebas comparan semanticamente:

- `user_version`
- `sqlite_master` normalizado
- tablas propias presentes
- columnas resultantes mediante filas preservadas
- indices y triggers propios
- conteos
- filas sinteticas
- relaciones

## Recuperacion en segundo intento

Despues de retirar el fallo simulado, la misma base temporal migra correctamente hasta version 7 sin borrar ni reparar manualmente.

## Integridad

`PRAGMA integrity_check`: aprobado en instalacion limpia y fixtures historicos.

`PRAGMA foreign_key_check`: sin errores en instalacion limpia y fixtures historicos.

FTS5: presente y usable despues de la migracion limpia mediante busqueda FTS existente.

## Pruebas ejecutadas

Pruebas previas relacionadas:

- `npm test -- --runInBand __tests__/database.test.js __tests__/reading-sessions.test.js __tests__/backup-import-service.test.js`
- Resultado: 3 suites aprobadas, 69 tests aprobados.

Pruebas dirigidas posteriores:

- `npm test -- --runInBand __tests__/database.test.js`
- Resultado: 1 suite aprobada, 22 tests aprobados.

Regresion dirigida:

- `npm test -- --runInBand __tests__/database.test.js __tests__/reading-sessions.test.js __tests__/backup-import-service.test.js`
- Resultado: 3 suites aprobadas, 74 tests aprobados.

Suite completa:

- `npm test -- --runInBand`
- Resultado: 11 suites aprobadas, 165 tests aprobados, 0 snapshots.

Lint:

- `npm run lint`
- Resultado: aprobado sin errores.

Whitespace:

- `git diff --check`
- Resultado: aprobado. Git informo solo advertencias locales LF/CRLF.

## ID resuelto

- DATA-003

## IDs fuera de alcance

- DATA-001 y DATA-002
- DATA-004
- DATA-005
- BUG-001 a BUG-004
- STAT-001 a STAT-003
- SECURITY-001
- PERF-001 a PERF-004
- TECH-001 a TECH-003
- SCANNER-001

## Riesgos pendientes

No se agregaron restricciones NOT NULL, CHECK o UNIQUE adicionales.

No se reconstruyeron tablas.

No se corrigieron sesiones manuales con timestamps futuros.

No se modificaron reglas de sesiones, estadisticas, backup, scanner, UI ni navegacion.

## Confirmacion de alcance

Produccion, Dev, Preview, bases reales, backups reales, portadas reales y stashes no fueron modificados.

No se uso ADB, no se instalaron dependencias, no se ejecuto Expo Doctor, no se genero APK/AAB y no se hizo build nativo.

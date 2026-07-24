# WP-01 Backup v7 Report

Fecha: 2026-07-24

Rama: fix/wp-01-backup-v7

Commit base: 47d525f9b4ec46ffff28959dbc89713e9a38ab7e

Commit funcional: b4cb0d5 fix: restaurar integralmente backups v7

Commit documental: 7637557 docs: registrar resultado de WP-01

Genealogia verificada: WP-01 desciende correctamente del cierre final de WP-00 en `47d525f9b4ec46ffff28959dbc89713e9a38ab7e`.

## Archivos modificados

- src/database.js
- src/services/backupImportService.js
- __tests__/backup-import-service.test.js
- __tests__/database.test.js

## Formato anterior

El exportador declaraba `version: 6` aunque el esquema local vigente era `DATABASE_VERSION = 7`.

La importacion aceptaba versiones 2 a 6 y restauraba sesiones usando solo campos historicos: libro, fecha, inicio, fin, paginas, pagina inicial/final y duracion. Los campos v7 quedaban omitidos o dependian de defaults SQLite.

## Formato nuevo

El backup exportado declara `version: 7` y mantiene `tipo: mi-biblioteca-backup`.

La importacion acepta versiones 2 a 7. Los formatos futuros siguen rechazandose.

## Campos incorporados

Libros:

- `fecha_inicio_lectura`
- preservacion explicita de `fecha_fin` validada junto con la fecha de inicio

Sesiones:

- `uuid`
- `estado`
- `origen`
- `nota`
- `duracion_acumulada_segundos`
- `ultimo_inicio`
- `pausada_en`
- `fecha_creacion`
- `fecha_actualizacion`
- `editada`

## Compatibilidad historica

Las versiones 2, 3, 4, 5 y 6 siguen importandose.

Los backups historicos no inventan `fecha_inicio_lectura`.

Las sesiones historicas sin estado explicito se tratan como sesiones completadas solo cuando tienen `hora_fin` valida. No se convierten en activas, pendientes o manuales sin evidencia del formato v7.

## Politica de Merge

Merge continua siendo transaccional.

Los libros se resuelven por UUID, ISBN equivalente o titulo/autor cuando no hay identificadores confiables.

Las sesiones se resuelven por `uuid` o por `(libro_uuid, hora_inicio)`, lo que mantiene idempotencia al importar dos veces.

Si un backup v7 intenta importar una sesion activa y ya existe otra sesion activa distinta en destino, se rechaza la importacion completa con un mensaje comprensible para evitar perdida silenciosa de datos.

## Politica de Replace

Replace sigue requiriendo confirmacion explicita.

La operacion borra e inserta dentro de una transaccion exclusiva. Si SQLite falla, se revierte el estado previo.

Las portadas creadas antes del fallo transaccional se eliminan durante el rollback fisico.

## Validaciones anadidas

- Version 7 soportada explicitamente.
- UUID obligatorio para libros y deseos v7.
- UUID de sesion preservado y validado.
- Estados de sesion limitados a `activa`, `pendiente` y `completada`.
- Origen limitado a `cronometro` y `manual`.
- Fechas de sesion validadas como fecha local.
- Timestamps de sesion validados.
- Duraciones negativas o superiores a reglas actuales rechazadas.
- Paginas negativas o invertidas rechazadas.
- Sesiones huerfanas omitidas con advertencia explicita.
- Conflicto de sesion activa global rechazado de forma atomica.

## Pruebas ejecutadas

Pruebas dirigidas previas:

- `npm test -- --runInBand __tests__/backup-import-service.test.js __tests__/backup-file-service.test.js __tests__/database.test.js`
- Resultado: 3 suites aprobadas, 40 tests aprobados.

Pruebas dirigidas posteriores:

- `npm test -- --runInBand __tests__/backup-import-service.test.js __tests__/database.test.js`
- Resultado: 2 suites aprobadas, 32 tests aprobados.

Suite completa:

- `npm test -- --runInBand`
- Resultado: 11 suites aprobadas, 160 tests aprobados, 0 snapshots.

Lint:

- `npm run lint`
- Resultado: aprobado sin errores.

Whitespace:

- `git diff --check`
- Resultado: aprobado. Git informo solo advertencias locales LF/CRLF.

## Rollback probado

Merge: fallo SQLite simulado revierte el update local y elimina la portada creada.

Replace: trigger SQLite simulado durante `INSERT INTO mis_libros` revierte la base al estado previo y elimina la portada creada antes de la transaccion fallida.

## IDs resueltos

- DATA-001
- DATA-002

## IDs fuera de alcance

- DATA-003
- DATA-004
- DATA-005
- BUG-001 a BUG-004
- STAT-001 a STAT-003
- SECURITY-001
- PERF-001 a PERF-004

## Riesgos pendientes

Las migraciones aun no son atomicas como paquete completo.

No se agregaron restricciones CHECK/NOT NULL ni reconstruccion de tablas.

No se modifico el flujo visual de Ajustes ni ningun comportamiento de UI.

## Confirmacion de alcance

Produccion, Dev, Preview, bases reales, backups reales, portadas reales y stashes no fueron modificados.

No se uso ADB, no se instalaron dependencias, no se ejecuto Expo Doctor, no se genero APK/AAB y no se hizo build nativo.

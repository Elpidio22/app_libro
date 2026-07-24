# WP-05 — Límite seguro para la importación de backups

Fecha: 2026-07-24

## Identificación

- Paquete: WP-05 — Límite seguro para la importación de backups.
- ID incluido: SECURITY-001, únicamente en su componente de importación de backups sin límite de tamaño.
- Estado de SECURITY-001: mitigado parcialmente en WP-05.
- Riesgo pendiente de SECURITY-001: cifrado opcional de backups.
- Rama: `fix/wp-05-backup-import-limits`.
- SHA completo del commit base: `c12381179aae53c525e32297731712516cf503a8`.
- Commit funcional: `79c7506 fix: limitar tamaño de backups importados`.

## Archivos modificados

- `src/services/backupFileService.js`
- `src/database.js`
- `test/mocks/expo-file-system.js`
- `__tests__/backup-file-service.test.js`
- `__tests__/backup-import-service.test.js`
- `__tests__/database.test.js`

## Causa original

El flujo de importación seleccionaba un respaldo, validaba extensión/MIME, leía el archivo completo con `File.text()` y recién después ejecutaba `JSON.parse()` y la sanitización. No existía un límite explícito previo, por lo que un archivo demasiado grande podía consumir memoria o bloquear la aplicación antes de ser rechazado.

## Riesgo mitigado

Se mitiga el riesgo de consumo excesivo de memoria o bloqueo por archivos de respaldo demasiado grandes. El cifrado de backups queda fuera de alcance y pendiente.

## Límite implementado

- Constante: `MAX_BACKUP_IMPORT_BYTES`.
- Valor exacto: `32 * 1024 * 1024`.
- Bytes exactos: `33.554.432`.
- Equivalencia legible: `32 MB`.
- Ubicación: `src/services/backupFileService.js`.

La regla exacta es:

`tamanoArchivo <= MAX_BACKUP_IMPORT_BYTES`

Se acepta un archivo exactamente en `33.554.432` bytes y se rechaza `33.554.433` bytes o superior.

## Capa de validación

La validación principal vive en `src/services/backupFileService.js`:

- `validarTamanoBackupImportacion()`
- `obtenerTamanoBackupImportacion()`
- `leerTextoBackupImportacion()`
- `medirBytesUTF8()`

`src/database.js` consume `leerTextoBackupImportacion()` desde `seleccionarBackupParaImportar()`, antes de `JSON.parse()` y antes de `validateBackupDocument()`.

## Fuente primaria y fallback

- Fuente primaria: `asset.size` devuelto por `expo-document-picker`, si existe y es válido.
- Fallback: `File.info().size` del nuevo `expo-file-system`.
- Si no puede verificarse el tamaño: se rechaza antes de leer con el mensaje `No se pudo verificar el tamaño del respaldo.`

## Comprobación secundaria

Después de leer el contenido, pero antes de `JSON.parse()`, se mide el tamaño real del texto en bytes UTF-8.

Mecanismo:

- `TextEncoder` cuando está disponible.
- Fallback manual compatible con React Native para contar bytes UTF-8 sin `Buffer` en código productivo.

Si el contenido real supera el límite, se rechaza antes de parsear, sanitizar, importar, crear portadas o abrir transacciones de importación.

## Momento exacto del rechazo

- Si `asset.size` o `File.info().size` supera el límite: rechazo antes de `File.text()`.
- Si el tamaño es desconocido o inválido: rechazo antes de `File.text()`.
- Si el contenido real supera el límite tras lectura: rechazo antes de `JSON.parse()`.

## Merge y Replace

Merge y Replace reutilizan el mismo flujo protegido porque ambos parten de `importarBackupJSON()` / `seleccionarBackupParaImportar()` antes de ejecutar `ejecutarImportacionBackup()`.

Casos cubiertos:

- Merge válido bajo el límite.
- Merge rechazado por tamaño.
- Replace válido bajo el límite.
- Replace rechazado por tamaño.

El rechazo ocurre antes de cualquier cambio propio de Merge o Replace.

## Ausencia de efectos laterales

Las pruebas confirman que un rechazo por tamaño:

- No lee el archivo si el tamaño ya se conoce.
- No ejecuta `JSON.parse()`.
- No invoca sanitización.
- No abre transacción de importación.
- No modifica SQLite.
- No crea portadas.
- No deja residuos.
- No impide que un intento válido posterior importe una sola vez.

## Compatibilidad histórica

Se confirmó compatibilidad de importación para backups:

- v2
- v3
- v4
- v5
- v6
- v7

No se modificó:

- `BACKUP_VERSION`.
- Estructura JSON.
- Deduplicación.
- Merge.
- Replace.
- Rollback.
- Importación de sesiones.
- Importación de etiquetas.
- Importación de deseos.
- Importación de portadas sintéticas.

## Regresiones cubiertas

- Round-trip v7 vigente.
- Merge idempotente.
- Replace.
- Rollback.
- Sesiones activa, pendiente, manual y editada.
- Fecha de inicio de lectura.
- Etiquetas.
- Deseos.
- Portadas sintéticas.
- UUID.
- Estados.
- Timestamps.
- Migraciones y `user_version`.

## Versiones finales

- `DATABASE_VERSION`: `8`.
- `BACKUP_VERSION`: `7`.
- No se agregó migración 9.
- No se modificó el esquema SQLite.
- No se cambió el formato de backup v7.

## Pruebas ejecutadas

- Baseline dirigido antes de modificar:
  - `npm test -- --runInBand __tests__/database.test.js __tests__/backup-file-service.test.js __tests__/backup-import-service.test.js`
  - Resultado: 3 suites aprobadas, 51 tests aprobados.

- Pruebas dirigidas finales:
  - `npm test -- --runInBand __tests__/database.test.js __tests__/backup-file-service.test.js __tests__/backup-import-service.test.js`
  - Resultado: 3 suites aprobadas, 62 tests aprobados.

- Suite completa:
  - `npm test -- --runInBand`
  - Resultado: 11 suites aprobadas, 185 tests aprobados.

- Lint:
  - `npm run lint`
  - Resultado: aprobado.

- Whitespace:
  - `git diff --check`
  - Resultado: aprobado, sólo avisos normales LF/CRLF en Windows.

## Stashes y variantes

- Stashes preservados intactos.
- Producción no modificada.
- Development no modificado.
- Preview no modificado.
- No se usó ADB.
- No se ejecutaron builds, APK, AAB, Gradle, EAS ni Expo Doctor.
- No se usaron bases, backups, portadas ni datos reales.

## IDs fuera de alcance

- Cifrado de backups dentro de SECURITY-001.
- DATA-001 a DATA-005.
- BUG-001 a BUG-004.
- STAT-001 a STAT-003.
- SCANNER-001.
- PERF-001 a PERF-004.
- TECH-001 a TECH-003.
- EXPO-001.
- FEATURE, UI, UX y A11Y.

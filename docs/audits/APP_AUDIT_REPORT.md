# Auditoría integral de Mi Biblioteca

**Fecha:** 23 de julio de 2026  
**Repositorio:** `E:\Proyectos\app_libro`  
**Rama auditada:** `feature/reading-sessions-and-book-detail`  
**Naturaleza:** auditoría de solo lectura; no se corrigió código ni se modificaron datos reales.

## 1. Resumen ejecutivo

### Veredicto

**Apta para Prueba, no para Producción.**

La aplicación abre, navega y presenta una experiencia visual consistente. Biblioteca, detalle de libro, La cacería, Añadir, Crónicas y Ajustes fueron observadas en `Mi Biblioteca Dev` con datos existentes. La suite automática pasa completa (156 pruebas), el lint termina sin errores y el bundle Android se exporta correctamente.

No obstante, existe un riesgo crítico de restauración: el esquema local pendiente ya es versión 7, pero el backup sigue declarándose versión 6 y el importador omite campos introducidos por la versión 7. Una restauración puede perder la fecha de inicio de lectura y metadatos de sesiones (UUID, estado, origen, nota, pausa y acumulado), y puede volver invisible una sesión activa restaurada.

Además, la confianza de compilación está sobreestimada: TypeScript no incluye los archivos JavaScript de producción y ESLint ignora componentes, hooks y constantes. El nuevo centro de sesiones —uno de los flujos con mayor riesgo de datos— queda fuera del lint y tiene cobertura de líneas cercana al 42%.

### Fortalezas principales

- Navegación principal funcional y visualmente coherente.
- Design System centralizado; no se hallaron colores residuales fuera de `Theme`.
- SQLite usa WAL, claves foráneas, consultas parametrizadas e índices relevantes.
- FTS5 está correctamente vinculado a `mis_libros` mediante triggers de alta, baja y actualización.
- Prevención global de dos sesiones activas mediante transacción e índice parcial.
- Sesiones pendientes suman tiempo, no suman páginas y no intervienen en velocidad.
- Movimiento Deseos → Biblioteca atómico.
- Importación SQLite transaccional y limpieza de portadas creadas ante rollback.
- Listas principales virtualizadas y dashboard con caché/revisiones.
- Error Boundary e interfaz de error de inicialización SQLite.

### Riesgos principales

1. Backup v6 incompatible con los campos del esquema v7.
2. Migraciones incrementales no agrupadas en una transacción única.
3. Edición de sesiones redondea la duración a minutos y altera el valor original.
4. Sesiones activas de más de 12 horas no pueden guardarse.
5. “Hora habitual” se calcula en UTC, no en hora local.
6. TypeScript no revisa el código JavaScript real.
7. ESLint excluye el nuevo centro de sesiones y otros componentes.
8. El escáner mantiene un caso conocido de lectura de un ISBN válido equivocado.

### Recomendación general

Puede seguir utilizándose en `Mi Biblioteca Prueba` con respaldo externo conservado, evitando una restauración como mecanismo de recuperación definitivo hasta corregir DATA-001. No promover la rama actual a Producción ni publicar un build definitivo antes de:

1. versionar y restaurar integralmente el esquema v7;
2. añadir round-trip tests del backup v7;
3. hacer transaccionales las migraciones;
4. corregir duración/hora local;
5. ampliar typecheck, lint y pruebas UI del centro de sesiones.

## 2. Alcance y limitaciones

### Revisado

- Git local y remoto.
- Configuración Expo/EAS y variantes.
- Rutas, pantallas, componentes, servicios, hooks y pruebas.
- Esquema SQLite y migraciones 1–7.
- FTS5, índices, triggers y transacciones.
- Sesiones, estadísticas, detalle, biblioteca, deseos, escáner, portadas y backup.
- Seguridad básica, permisos, credenciales y uso de SQL parametrizado.
- Tests, cobertura, lint, typecheck, Expo Doctor, compatibilidad de paquetes y export Android.
- Observación no destructiva en un teléfono Android conectado.
- Logcat de `Mi Biblioteca Dev`.

### Dispositivo y variantes

- Un teléfono Android físico conectado por ADB.
- Packages confirmados:
  - `com.elpidioluna.mibiblioteca`
  - `com.elpidioluna.mibiblioteca.dev`
  - `com.elpidioluna.mibiblioteca.preview`
- Se navegó únicamente en `Mi Biblioteca Dev`.
- Producción no fue abierta, actualizada, limpiada ni modificada.
- Prueba no fue abierta ni modificada.

### No ejecutado

- Operaciones manuales que escriben datos: iniciar/cerrar/editar/eliminar sesiones, guardar libros, deseos, etiquetas o notas.
- Importación o reemplazo de backups reales.
- Cámara y escaneo físico durante esta auditoría.
- Pruebas sin conexión.
- Lector de pantalla/TalkBack.
- Dynamic Type con escalas grandes.
- Teclado abierto en todos los formularios.
- Rotación (la app está configurada en portrait).
- Tablet o pantalla pequeña adicional.
- Build nativo Gradle/EAS, APK nuevo o instalación.
- Integridad de la base privada de Producción o Prueba.
- Diagnóstico SQL definitivo de la base Dev: se obtuvo una copia, pero el dispositivo no dispone de `sqlite3` y el contenido vigente estaba en WAL. No se forzó un checkpoint porque modificaría estado.

Las capturas temporales contenían títulos reales y no se incorporaron al repositorio para evitar exponer datos del usuario.

## 3. Estado de Git

### Estado observado

- Rama: `feature/reading-sessions-and-book-detail`.
- HEAD: `72b75d6 feat: agregar resúmenes de lectura en Crónicas`.
- Árbol de trabajo: **sucio**.
- `main`: `33dc0c7`, tres commits por delante de `origin/main`.
- `origin/main`: `0d2fe2b`.
- Diferencia `main...origin/main`: `3 0`.
- No se hizo push, merge, rebase, cherry-pick ni commit durante la auditoría.

### Commits recientes en la línea de trabajo

- `72b75d6 feat: agregar resúmenes de lectura en Crónicas`
- `b5f4624 feat: agregar variante autónoma de prueba`
- `dc7615d fix: permitir guardar e importar respaldos`
- `33dc0c7 chore: dejar de versionar archivo generado de Expo`
- `14a1b19 chore: ignorar archivo generado de Expo`
- `54acfdf feat: importar backups v5 de forma segura`

### Cambios locales sin confirmar

Modificados:

- `__tests__/analytics-repository.test.js`
- `__tests__/cronicas-dashboard.test.js`
- `__tests__/database.test.js`
- `src/app/_layout.js`
- `src/app/cronicas.js`
- `src/app/index.js`
- `src/app/libro/[id].js`
- `src/components/analytics/ReadingSummaries.js`
- `src/database.js`
- `src/database/analyticsRepository.js`

No rastreados:

- `__tests__/reading-sessions.test.js`
- `src/components/BookReadingCenter.js`
- `src/services/readingSessionService.js`

### Stashes

- `stash@{0}: On main: wip: bloque generado por Expo CLI en main`
- `stash@{1}: On fix/isbn-rate-limits: wip: experimento scanner ISBN pendiente`

Ambos permanecen intactos.

### Diferencias comprometidas respecto de main

La rama tiene 17 archivos en el diff comprometido frente a `main`, con aproximadamente 1.247 inserciones y 75 eliminaciones. Incluye variante Preview, backup de archivo, importación v5, resúmenes de lectura y dashboard. A esto se suman los cambios locales no confirmados de sesiones/detalle.

### Riesgo de integración

**Alto.** La función central de sesiones y la migración v7 solo existen en el working tree. No hay un commit reproducible que represente exactamente lo probado. Un cambio de rama, stash incompleto o build desde HEAD excluiría parte de la implementación observada mediante Metro.

## 4. Arquitectura

### Estructura

- Expo Router con `Tabs` como navegación raíz.
- Cinco pestañas visibles y una ruta oculta de detalle.
- No hay Context API, Redux, Zustand ni store persistente.
- Estado local con hooks y un registro de revisiones en memoria.
- Acceso SQLite concentrado principalmente en `src/database.js`.
- Analytics separado parcialmente en `src/database/analyticsRepository.js`.
- Servicios independientes para ISBN, sesiones, portadas y backup.
- Archivos de portada en almacenamiento privado de la app.
- Backups JSON mediante SAF, Sharing y Document Picker.
- Sin tareas explícitas en segundo plano.

### Navegación

| Ruta | Título | Función |
| --- | --- | --- |
| `index` | Mi Biblioteca | Listado, búsqueda FTS, filtros, orden y sesión activa |
| `scanner` | Añadir un libro | Selector escáner/manual, ISBN, portada y alta |
| `deseos` | La cacería | Alta, descarte y adquisición |
| `cronicas` | Crónicas | Dashboard, gráficos y resúmenes |
| `ajustes` | Ajustes | Guardar, compartir e importar backups |
| `libro/[id]` | Ficha del libro | Vista, edición, etiquetas, sesiones, fechas y notas |

### SQLite

Tablas reales:

- `mis_libros`
- `lista_compras`
- `etiquetas`
- `libro_etiquetas`
- `sesiones_lectura`
- `mis_libros_fts` y tablas auxiliares FTS5

Versión de código pendiente: `DATABASE_VERSION = 7`.

Migraciones:

1. Libros, deseos y normalización del estado leído.
2. UUID e índices base.
3. Etiquetas, relación N:M y FTS5.
4. Sesiones básicas.
5. Deduplicación e índice libro/hora de inicio.
6. Página inicial/final, duración y ciclo de deseos.
7. Fecha de inicio de lectura y ciclo persistente de sesiones.

## 5. Inventario funcional

| Área | Pantallas o archivos | Función | Estado | Riesgos |
| --- | --- | --- | --- | --- |
| Arranque | `_layout.js`, `database.js` | Fuentes, splash, migraciones y Error Boundary | Verificado por código y Dev | Error crudo visible; migraciones no atómicas |
| Biblioteca | `index.js` | FTS, etiquetas, orden, portadas y progreso | Observado y probado | Sin paginación SQL; warning de imágenes |
| Detalle | `libro/[id].js` | Museo, edición, portada, estado, fechas y etiquetas | Observado parcialmente | Sin back visible; pantalla extensa |
| Centro de lectura | `BookReadingCenter.js` | Resumen, historial, notas, ficha y sesiones | Verificado por código/tests | Cobertura UI baja; lista sin virtualizar |
| Sesión activa | `database.js`, `readingSessionService.js` | Inicio, pausa, reanudación y recuperación | Verificado por tests | >12 h queda sin salida de guardado |
| Sesión pendiente | mismos | Conserva tiempo sin páginas y completa después | Verificado por tests | Backup v6 no conserva estado |
| Sesión manual | mismos | Fecha, hora, duración, páginas y nota | Verificado por tests | Permite hora futura del día actual |
| Edición de sesión | mismos | Fecha, hora, duración, páginas y nota | Verificado por tests | UI redondea segundos a minutos |
| Eliminación de sesión | mismos | Elimina sin reducir progreso | Verificado por tests | Decisión irreversible; estadísticas dependen de refresh |
| Estados del libro | detalle/database | Quiero leer, leyendo, terminado y abandonado | Verificado por tests | Relectura no modelada como ciclo separado |
| Fechas | detalle/servicio | Inicio, fin y días calendario | Verificado por tests | Backup no conserva inicio |
| Crónicas | `cronicas.js`, analytics | Mes, tendencia, heatmap, tags, ritmo y wishlist | Observado y probado | Hora habitual UTC; sin filtros interactivos de período |
| Resúmenes | `ReadingSummaries.js` | Tres recientes y catálogo virtualizado buscable | Verificado por tests | Modal anidado no probado en dispositivo |
| Notas | detalle | Una nota general por libro y nota por sesión | Verificado por código | Sin citas/reflexiones estructuradas |
| Deseos | `deseos.js` | Alta, descarte y paso atómico a biblioteca | Observado y probado | No edita; no gestiona ISBN/portada |
| Escáner | `scanner.js`, `isbnService.js` | EAN-13, checksum, Google/Open Library/ML | Verificado por tests, no probado físicamente | Lectura errónea conocida no resuelta |
| Portadas | `portadas.js` | Optimiza, temporal, confirma y limpia | Verificado por tests | Warnings de render; fallback silencioso en alta remota |
| Backup | Ajustes/servicios/database | Guardar, compartir, fusionar y reemplazar | Verificado por tests v5/v6 | Crítico para esquema v7 |
| Variantes | app config/EAS | Producción, Development y Preview | Verificado | Android generado es solo Dev y no versionado |

### Funciones incompletas o ausentes

- Edición de deseos.
- ISBN y portada en deseos.
- Notas estructuradas (cita, reflexión, página).
- Modelo de relecturas con múltiples ciclos inicio/fin.
- Filtros semanales/anuales interactivos en Crónicas.
- Export cifrado o protegido.
- Suite E2E Android y accesibilidad automatizada.

## 6. Resultados automáticos

| Comando | Resultado | Duración aproximada | Detalle |
| --- | --- | ---: | --- |
| `npm test -- --runInBand` | OK | 15,5 s | 11 suites, 156 tests |
| Tests con cobertura en `%TEMP%` | OK | 27,6 s | 80,59% líneas global |
| `npm run lint` | OK | 4,1 s | Sin mensajes |
| `npx tsc --noEmit` | OK | 2,2 s | No incluye JS de producción |
| `npx expo-doctor` | FALLA | 5,9 s | 17/18 checks; Expo patch |
| `npx expo install --check` | FALLA | 1,5 s | `expo` 54.0.35, esperado ~54.0.36 |
| `npx expo export --platform android ...` | OK | 19,4 s | Bundle Hermes 3,77 MB, 46 assets |
| `adb devices` | OK | — | Un dispositivo conectado |
| `git fetch --prune` | OK | 1,1 s | Sin cambios reportados |

### Cobertura relevante

- Global: 75,24% statements, 67,29% branches, 69,87% functions, 80,59% lines.
- `database.js`: 88,10% líneas.
- `analyticsRepository.js`: 96,85% líneas.
- `libro/[id].js`: 41,14% líneas.
- `BookReadingCenter.js`: 41,80% líneas.
- `useKeyboardAwareScroll.js`: 33,33% líneas.
- `portadas.js`: 69,56% líneas.

### Advertencias Android observadas

- Repetición de `WrappingUtils: Don't know how to round that drawable` al mostrar portadas.
- Tres advertencias `Attempt to set local data for view with unknown tag: -1`.
- No se observó una excepción fatal de React Native o SQLite durante la navegación.

## 7. Auditoría funcional

### Biblioteca

**Verificado/observado**

- Carga 23 libros en Dev.
- Búsqueda FTS con debounce y protección por generación.
- Filtros por etiquetas respetados al volver al foco.
- Orden reciente, título, autor y progreso.
- `FlatList` configurada con ventana y lotes.
- Placeholder de portada y porcentaje de progreso.
- Refresco manual.
- Banner de sesión activa global.

**Fragilidad**

- Toda la consulta FTS devuelve el conjunto completo; no existe paginación SQL.
- El orden se recalcula en memoria.
- RN `Image` genera warnings por portadas redondeadas.
- Chips de etiqueta/orden carecen de estado accesible seleccionado.

### Alta y edición

**Verificado por código/tests**

- Título obligatorio, páginas enteras, progreso no negativo y límite por total.
- ISBN validado matemáticamente.
- Duplicado por ISBN-10/ISBN-13 equivalente.
- Portada temporal con rollback ante error SQLite.
- Etiquetas con lock sincrónico.
- Confirmación al terminar/reabrir un libro.
- Hook específico para mantener inputs visibles.

**No probado manualmente**

- Teclado en cada input.
- Guardado múltiple.
- Galería, portapapeles y falta de espacio real.

### Escáner ISBN

- Cámara solo se crea después de elegir Escanear.
- `barcodeTypes: ['ean13']`.
- Valida checksum antes de bloquear.
- Conserva `type` y `data`.
- Usa `AbortController`.
- Busca duplicados equivalentes.
- Consulta proveedores con coincidencia ISBN exacta.
- Linterna y zoom leve.
- Estados de red diferenciados en el servicio.

Existe un caso real reportado anteriormente donde la cámara devolvió repetidamente otro ISBN válido. La validación matemática no puede distinguir un código válido físicamente mal leído; el formulario de revisión reduce el impacto, pero no lo elimina. No se intentó reproducir en esta auditoría.

### La cacería

- Alta manual y prioridades.
- Lista virtualizada.
- Locks sincrónicos para doble toque.
- Descartar conserva historial.
- Adquirir crea libro y resuelve deseo en una transacción exclusiva.
- No hay edición de un deseo existente.
- No almacena ISBN ni portada.

### Detalle del libro

- Portada grande y modo visual.
- Pestañas Resumen, Historial, Notas y Ficha.
- Edición bajo FAB.
- Fechas y estado.
- Etiquetas.
- Confirmación de eliminación.
- Centro de sesiones contextual al libro.

Observación visual: la portada ocupa la mayor parte del primer viewport y la acción de sesión queda debajo del pliegue. La ruta está modelada como pantalla oculta dentro de Tabs; no mostró botón atrás visible, aunque Android Back y las pestañas permiten salir.

### Sesiones

**Confirmado por tests**

- Primera sesión fija fecha de inicio y cambia “quiero leer” a “leyendo”.
- Inicio transaccional e índice global impiden dos activas.
- Pausar congela.
- Reanudar conserva acumulado.
- Recuperación desde SQLite.
- Guardar actualiza sesión y progreso atómicamente.
- “Completar después” conserva tiempo, deja páginas en cero y no actualiza progreso.
- Completar pendiente calcula páginas y avanza progreso.
- Manual contextual, histórica y múltiples sesiones diarias.
- Editar no duplica.
- Eliminar no reduce progreso.
- Cronómetro usa timestamps persistidos, no un contador como fuente de verdad.

**Problemas**

- Una activa puede acumular más de 12 h, pero el cierre rechaza más de 12 h.
- La UI de edición convierte segundos a minutos redondeados.
- El `load()` del centro no tiene cancelación al desmontar.
- Historial usa `.map()` sin virtualización.
- Los controles principales carecen de semántica accesible suficiente.

### Estados y fechas

- Estados válidos: `quiero leer`, `leyendo`, `terminado`, `abandonado`.
- `fecha_agregado` no se usa como fecha de inicio.
- Fecha de inicio se crea al empezar a leer.
- Final no puede ser anterior a inicio.
- Terminar sugiere fecha local.
- Reabrir permite conservar o quitar fecha.

No existe una entidad de relectura. Un libro tiene una única fecha de inicio y una única fecha final; sesiones históricas múltiples no forman ciclos separados.

### Estadísticas y Crónicas

**Confirmado**

- Páginas y tiempo por período.
- Velocidad ponderada.
- Días activos.
- Tendencias mensuales.
- Heatmap.
- Etiquetas con atribución explícita no exclusiva.
- Wishlist.
- Resúmenes por libro terminado.
- Caché invalidada por revisiones.
- Edición/eliminación de sesiones fuerza recomputación por revisión.
- Pendiente suma tiempo.
- Pendiente aporta cero páginas.
- Pendiente queda fuera del cálculo de velocidad.
- Sesión histórica se asigna por su campo `fecha`.
- Resúmenes ahora limitan el dashboard a tres elementos y abren catálogo virtualizado.

**Problema confirmado**

- `strftime('%H', hora_inicio)` opera sobre timestamp UTC terminado en `Z`; “hora habitual” no es hora local.

### Notas

- Nota general por libro.
- Nota opcional por sesión.
- Texto multiline y persistencia SQLite.
- No hay CRUD de notas independientes, categorías cita/reflexión ni página asociada a nota general.

### Backup

**Bien implementado**

- Guardar y Compartir son acciones separadas.
- Nombre único.
- Portadas serializadas secuencialmente.
- SAF y Sharing limpian temporales.
- Importación valida tipo/versiones 2–6.
- Merge y Replace SQLite son transaccionales.
- Dedupe por UUID, ISBN equivalente y fallback título/autor.
- Relaciones huérfanas se omiten con advertencia.
- Portadas creadas antes de la transacción se limpian si SQLite falla.

**Crítico**

- Exporta todos los campos actuales, pero marca versión 6.
- El importador no hidrata `fecha_inicio_lectura`.
- El importador no hidrata campos v7 de sesión.
- Nuevas sesiones importadas pueden quedar con `uuid = NULL`.
- Una activa exportada puede volver como `estado='completada'` con `hora_fin=NULL`, invisible para recuperación.

## 8. Auditoría visual

### Consistencia

- Fondo, superficies, acento ámbar, bordes y tipografía son consistentes.
- Headers respetan safe area.
- Tarjetas y radios mantienen lenguaje común.
- Botones principales son visualmente claros.
- Crónicas ya no duplica título interno.
- Ajustes explica la diferencia entre Guardar y Compartir.

### Legibilidad

- Contraste general bueno en fondo oscuro.
- Títulos y cifras principales legibles.
- Algunos textos de 9–11 px son demasiado pequeños para lectura cómoda.
- Títulos largos se truncan en Biblioteca; esto evita desborde pero oculta parte del dato.
- No se verificó escalado de fuente.

### Navegación

- Cinco áreas principales claras.
- Detalle mantiene tab bar y no presenta back visible.
- El FAB de edición es reconocible y accesible por label.
- El centro de lectura introduce cuatro subpestañas; son entendibles visualmente, pero sin estado accesible.

### Formularios

- Inputs del detalle y scanner usan mitigación de teclado.
- Deseos usa modal y hook de scroll.
- Modales de sesiones no reutilizan ese hook.
- Estados de busy existen, aunque no todos tienen lock sincrónico.
- Errores se comunican con Alert.

### Estados de sistema

- Loading, vacío y error existen en Biblioteca/Crónicas/Deseos.
- Error de arranque protege contra cierre silencioso.
- Permiso de cámara y errores de portada tienen mensajes.
- No se probó sin conexión ni permiso denegado real.

## 9. Accesibilidad

### Correcto

- Tarjetas de libro tienen role/button y label.
- FAB de edición tiene label.
- Acciones principales de backup tienen label.
- Linterna tiene label dinámico.
- Heatmap y gráfico mensual exponen descripciones.
- Etiquetas usan role checkbox y checked.
- Áreas principales suelen medir 44–48 dp.

### Brechas

- `BookReadingCenter` no asigna roles, labels ni `accessibilityState` a pestañas y acciones críticas.
- Sus `TextInput` dependen de un `Text` visual sin asociación accesible explícita.
- Chips de filtros/orden no exponen estado selected.
- Botones de modo en Scanner no exponen selected.
- Varios botones iconográficos dependen solo del contenido visual.
- No se verificó foco en modales, anuncio de errores ni TalkBack.
- Tamaños de 9–11 px pueden ser insuficientes.

Impacto: alto para usuarios de lector de pantalla en sesiones; medio en filtros y dashboard.

## 10. Rendimiento y estabilidad

### Positivo

- Biblioteca usa `FlatList`.
- Crónicas usa secciones virtualizadas y render diferido.
- Catálogo de resúmenes usa `FlatList`.
- Búsquedas tienen debounce y control de generación.
- Requests ISBN son cancelables.
- Operaciones críticas usan locks `useRef` en Deseos/Ajustes/etiquetas/sesiones.
- Analytics usa caché por revisiones.
- Portadas se reducen a 350 px y JPEG 0,65.

### Riesgos

- Historial de sesiones renderiza todo dentro de un `ScrollView`.
- Backup construye JSON y Base64 completo en memoria.
- Importación carga el archivo completo y no limita tamaño.
- Analytics dispara múltiples consultas en paralelo sobre una conexión.
- Componentes grandes generan renders y mantenimiento costosos.
- RN Image registró warnings repetidos al redondear portadas.
- `BookReadingCenter.load()` puede completar después del desmontaje.

No se hizo profiling de CPU, memoria, FPS ni biblioteca >100 libros.

## 11. Integridad de datos

### Garantías existentes

- WAL y `foreign_keys = ON`.
- UUID en libros/deseos e índice único.
- UUID e índice único para sesiones en v7.
- Índice único global de sesión activa.
- Índice único `(libro_uuid, hora_inicio)`.
- Rango de páginas validado en servicio.
- Duración limitada a 12 h al completar/manual/editar.
- Transacciones exclusivas para sesiones, adquisición e importación.
- FTS reconstruida y mantenida por triggers.

### Debilidades

- Migraciones no están encerradas en una transacción de versión.
- Migración v5 elimina filas duplicadas antes de crear índice.
- Varias columnas siguen permitiendo NULL o estados inválidos a nivel SQL.
- Importador omite UUID y estados v7.
- Importador acepta fechas como texto no vacío sin normalización cronológica completa.
- Hora futura del día actual se acepta en sesión manual/edición.
- Borrar/editar una sesión no recalcula hacia abajo `pagina_actual`; es una decisión explícita, pero puede dejar progreso sin respaldo histórico.

### Consultas de diagnóstico recomendadas (solo lectura)

Ejecutar en una copia consistente con WAL aplicado:

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
PRAGMA user_version;

SELECT uuid, COUNT(*) FROM mis_libros
GROUP BY uuid HAVING uuid IS NULL OR uuid = '' OR COUNT(*) > 1;

SELECT uuid, COUNT(*) FROM sesiones_lectura
GROUP BY uuid HAVING uuid IS NULL OR uuid = '' OR COUNT(*) > 1;

SELECT libro_uuid, hora_inicio, COUNT(*)
FROM sesiones_lectura
GROUP BY libro_uuid, hora_inicio HAVING COUNT(*) > 1;

SELECT COUNT(*) FROM sesiones_lectura s
LEFT JOIN mis_libros l ON l.uuid = s.libro_uuid
WHERE l.uuid IS NULL;

SELECT * FROM sesiones_lectura
WHERE paginas_leidas < 0
   OR pagina_inicio < 0
   OR pagina_fin < 0
   OR (pagina_inicio IS NOT NULL AND pagina_fin IS NOT NULL AND pagina_fin < pagina_inicio)
   OR duracion_segundos < 0
   OR (hora_fin IS NOT NULL AND julianday(hora_fin) < julianday(hora_inicio));

SELECT COUNT(*) FROM sesiones_lectura WHERE estado = 'activa';
```

No se ejecutaron sobre Producción/Prueba.

## 12. Seguridad y privacidad

### Positivo

- No se detectaron API keys, secretos ni claves privadas versionadas.
- Google Books usa variable pública opcional.
- SQL usa parámetros; no se observó concatenación de entradas sin sanitizar.
- Bases y portadas residen en almacenamiento privado.
- Variantes tienen package independiente.
- Producción no fue tocada.

### Riesgos

- Backup JSON contiene títulos, notas, progreso, sesiones y portadas en texto/Base64 sin cifrar.
- Compartir transfiere una copia a aplicaciones externas; la UI advierte que debe guardarse en lugar seguro, pero no cifra.
- No hay límite de tamaño del JSON/Base64 importado.
- Error Boundary muestra el mensaje interno completo de SQLite.
- Logs de portadas incluyen URI y objeto de error.
- Android generado incluye READ/WRITE_EXTERNAL_STORAGE además de CAMERA/INTERNET; en APIs modernas son permisos legados, pero debe revisarse su necesidad efectiva para dispositivos antiguos.

## 13. Lista completa de errores

| ID | Severidad | Estado | Área | Problema | Evidencia | Impacto | Recomendación |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DATA-001 | Crítico | Confirmado | Backup | Formato v6 no restaura campos v7 | `database.js:35-36, 1144-1152`; `backupImportService.js:143-178, 300-326, 423-565` | Pérdida/corrupción al restaurar | Crear backup v7 y round-trip completo |
| DATA-002 | Alto | Confirmado | Importación | Fechas/estado/duración de sesión se validan de forma insuficiente | `backupImportService.js:300-326` | Datos imposibles entran al esquema | Sanitizar con servicios v7 |
| DATA-003 | Alto | Potencial | Migraciones | Secuencia no atómica; v5 borra duplicados | `database.js:120-369`, especialmente 255-264 | Upgrade interrumpido o pérdida | Una transacción por migración y backup previo |
| BUG-001 | Alto | Confirmado por código | Sesiones | Activa >12 h no puede cerrarse | `database.js:737-825`; `readingSessionService.js:41-45` | Solo queda descartar | Cortar/capar con decisión explícita |
| BUG-002 | Alto | Confirmado | Sesiones | Editar redondea segundos a minutos | `BookReadingCenter.js:161-165, 196-203` | Duración cambia sin intención | Editar segundos o conservar precisión |
| STAT-001 | Alto | Confirmado | Crónicas | Hora habitual calculada en UTC | `analyticsRepository.js:305-308` | Métrica horaria incorrecta | Convertir a hora local de forma explícita |
| TECH-001 | Alto | Confirmado | Tooling | TypeScript no incluye JS | `tsconfig.json` | “Typecheck verde” no cubre producción | `checkJs`/migración TS gradual |
| TECH-002 | Alto | Confirmado | Tooling | ESLint ignora components/hooks/constants | `eslint.config.js` | Centro de sesiones queda sin lint | Reducir ignores |
| SCANNER-001 | Alto | No reproducido en esta auditoría | Scanner | Cámara devolvió otro ISBN válido | Caso físico reportado previamente | Alta de edición incorrecta | Confirmación visual/fotográfica y telemetría local |
| BUG-003 | Medio | Confirmado por código | Lifecycle | `load()` actualiza estado sin mounted guard | `BookReadingCenter.js:95-125` | Estado obsoleto/alerta tras salir | Cancelación o token de generación |
| BUG-004 | Medio | Potencial | Alta | Guardar libro usa estado, no lock sincrónico | `scanner.js:313-358` | Doble alta sin ISBN | `useRef` de procesamiento |
| PERF-001 | Medio | Confirmado | Historial | Sesiones renderizadas con `.map()` | `BookReadingCenter.js:302-315` | Pantalla lenta con historial largo | FlatList/modal dedicado |
| PERF-002 | Medio | Confirmado por código | Backup | JSON/Base64 completo en memoria, sin límite | `database.js:1115-1159`; selector 1177-1195 | OOM con biblioteca grande | Límites, lotes o streaming |
| UX-001 | Medio | Observado | Detalle | Sin back visible y acción debajo de portada | `_layout.js:147`; `libro/[id].js:327-366` | Navegación/acción menos clara | Stack real o headerBack; compactar hero |
| A11Y-001 | Medio | Confirmado | Accesibilidad | Sesiones sin roles/labels/selected | `BookReadingCenter.js:59-73, 249-352` | Flujo inaccesible con TalkBack | Semántica y pruebas de foco |
| DATA-004 | Medio | Confirmado | Esquema | UUID/estados no blindados por NOT NULL/CHECK | migraciones v2/v7; import insert 557-562 | NULL e inconsistencias posibles | Rebuild de tabla en migración futura |
| DATA-005 | Medio | Confirmado por código | Sesión manual | Hora futura de hoy permitida | `database.js:854-875, 896-923` | Estadísticas futuras | Comparar timestamp completo con now |
| FEATURE-001 | Medio | Confirmado | Deseos | Sin edición, ISBN ni portada | `deseos.js`; funciones DB 1018-1113 | Flujo incompleto | Edición contextual en tarea separada |
| SECURITY-001 | Medio | Confirmado | Privacidad | Backup sin cifrar y sin límite de entrada | backup services/Ajustes | Exposición u OOM | Aviso fuerte, límite y cifrado opcional |
| EXPO-001 | Medio | Confirmado | Dependencias | Expo 54.0.35 vs 54.0.36 esperado | Doctor/install check | Compatibilidad no ideal | Actualizar solo en sprint controlado |
| PERF-003 | Bajo | Observado | Portadas | Warnings de drawable redondeado | Logcat Dev | Ruido y posible coste | Evaluar `expo-image` |
| UI-001 | Bajo | Potencial | Legibilidad | Textos fijos de 9–11 px | estilos analytics/sesiones | Lectura difícil/escalado | Subir mínimos y probar fontScale |
| TECH-003 | Bajo | Confirmado | Deuda | Archivos de 398–1.224 líneas | `database.js`, scanner, importer, center | Cambios riesgosos | Separar repositorios/casos de uso |
| UX-002 | Bajo | Confirmado | Sesiones | Duración visible redondea a mínimo 1 min | `BookReadingCenter.js:35-38` | Unos segundos parecen 1 min | Mostrar segundos bajo 1 min |

### Detalle reproducible de los hallazgos prioritarios

#### DATA-001 — Backup v6 frente a esquema v7

- **Pantalla/flujo:** Ajustes → Guardar/Compartir → Importar.
- **Pasos:** crear libro con fecha de inicio; crear sesión pendiente/activa con nota; exportar; restaurar en base vacía.
- **Actual:** el JSON contiene campos v7, pero el importador los descarta y usa defaults.
- **Esperado:** round-trip semánticamente idéntico.
- **Evidencia:** campos omitidos en `sanitizeBook`, `safeSession` e INSERT/UPDATE.
- **Impacto:** pérdida de fecha, nota, estado, origen, pausa, acumulado y UUID.
- **Riesgo de corregir:** alto; cambia formato portable.
- **Pruebas necesarias:** fixtures v6→v7, v7→v7, activa/pendiente/manual/editada, merge y replace.

#### BUG-001 — Sesión mayor a 12 horas

- **Pantalla/flujo:** Ficha → Iniciar → recuperar al día siguiente → detener/guardar.
- **Actual:** pausa almacena duración sin límite; cierre llama validador de 12 h y falla.
- **Esperado:** política explícita que permita recuperar, cortar o dividir sin perder el registro.
- **Impacto:** usuario no puede guardar; solo descartar.
- **Riesgo de corregir:** medio; afecta métricas y reglas.
- **Pruebas:** foreground/background >12 h, reloj cambiado, recuperación.

#### BUG-002 — Redondeo al editar

- **Pantalla/flujo:** Historial → Editar una sesión de 90 segundos → cambiar nota → Guardar.
- **Actual:** 90 s se muestran como 2 min y se guardan como 120 s.
- **Esperado:** conservar 90 s si duración no cambia.
- **Impacto:** estadísticas alteradas.
- **Riesgo de corregir:** bajo/medio.
- **Pruebas:** 1, 30, 59, 90 y 3.599 segundos.

#### STAT-001 — Hora habitual UTC

- **Pantalla/flujo:** Crónicas.
- **Pasos:** guardar sesión a una hora local distinta de UTC; revisar hora habitual.
- **Actual:** SQLite interpreta el ISO `Z` y agrupa por UTC.
- **Esperado:** hora local del usuario.
- **Impacto:** narrativa errónea.
- **Riesgo de corregir:** medio por zona horaria/DST.
- **Pruebas:** UTC-3, UTC+5 y cambio DST.

#### TECH-001/002 — Validación estática incompleta

- **Flujo:** CI/local.
- **Actual:** verde aunque JS principal no entra en TypeScript y componentes no entran en lint.
- **Esperado:** todos los archivos productivos revisados.
- **Impacto:** regresiones no detectadas.
- **Riesgo de corregir:** mediano; revelará deuda existente.
- **Pruebas:** activar gradualmente y fijar baseline.

Los demás hallazgos incluyen en la tabla su ubicación, impacto y corrección; deben transformarse en tareas independientes antes de modificar código.

## 14. Mejoras sugeridas

### Necesarias

- Backup v7 completo e idempotente.
- Migraciones transaccionales y pruebas de interrupción.
- Precisión de duración y timestamp local.
- Lint/typecheck sobre código productivo.
- Semántica accesible del centro de sesiones.

### Recomendadas

- Extraer repositorios: libros, sesiones, deseos, etiquetas y backup.
- Separar UI del centro de lectura en subcomponentes.
- Virtualizar historial.
- Limitar tamaño de backup e importación.
- Añadir prueba E2E de recuperación de sesión.

### Opcionales

- Usar `expo-image` para caché y redondeo.
- Cifrado opcional de backups.
- Selector de períodos en Crónicas.
- Edición completa de deseos.

### Futuras

- Notas estructuradas: nota, cita, reflexión y página.
- Modelo de relecturas.
- Sincronización/backup incremental.
- Suite de accesibilidad y matriz tablet/pantalla pequeña.
- Observabilidad local opt-in sin datos sensibles.

## 15. Plan de corrección priorizado

### Etapa 1: críticos y pérdida de datos

- **Incluye:** DATA-001, DATA-002, DATA-003, DATA-004.
- **Dependencias:** definir formato backup v7 y política de compatibilidad.
- **Riesgo:** alto.
- **Esfuerzo:** grande.
- **Pruebas:** round-trip, rollback, migración interrumpida, fixtures v2–v7, portadas.

### Etapa 2: errores funcionales

- **Incluye:** BUG-001, BUG-002, BUG-003, BUG-004, SCANNER-001.
- **Dependencias:** reglas definitivas de duración y escaneo.
- **Riesgo:** medio/alto.
- **Esfuerzo:** mediano.
- **Pruebas:** sesiones reales/temporizadas, doble toque, desmontaje, escaneo físico.

### Etapa 3: estadísticas e integridad

- **Incluye:** STAT-001, DATA-005, PERF-002.
- **Dependencias:** utilidades de fecha/zona horaria y límite de archivos.
- **Riesgo:** medio.
- **Esfuerzo:** mediano.
- **Pruebas:** zonas horarias, futuro, períodos, bibliotecas grandes.

### Etapa 4: experiencia visual y accesibilidad

- **Incluye:** UX-001, UX-002, A11Y-001, UI-001, FEATURE-001.
- **Dependencias:** navegación y componentes accesibles.
- **Riesgo:** bajo/medio.
- **Esfuerzo:** mediano.
- **Pruebas:** TalkBack, fontScale, teclado, pantalla pequeña, navegación atrás.

### Etapa 5: rendimiento y deuda técnica

- **Incluye:** PERF-001, PERF-003, TECH-001, TECH-002, TECH-003, EXPO-001.
- **Dependencias:** baseline de lint/TS y decisión sobre `expo-image`.
- **Riesgo:** medio.
- **Esfuerzo:** grande.
- **Pruebas:** CI, profiling, listas grandes, bundle y build Android.

## 16. Veredicto final

### Apta para Prueba, no para Producción

La app es funcional y visualmente sólida para continuar una validación controlada. Las pruebas automáticas son valiosas y cubren bien la lógica de SQLite y analytics. Sin embargo, el backup actual no representa fielmente el esquema v7 y el conjunto exacto probado todavía no está comprometido en Git. Esto impide considerar segura una recuperación de datos y hace que el release no sea reproducible.

Antes de Producción deben resolverse como mínimo DATA-001, DATA-003, BUG-001, BUG-002, STAT-001, TECH-001 y TECH-002, y debe completarse una validación manual no destructiva del build autónomo de Prueba.


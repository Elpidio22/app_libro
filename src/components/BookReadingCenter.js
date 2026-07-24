import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  actualizarLibro,
  agregarSesionManual,
  completarSesionDespues,
  descartarSesionActiva,
  editarSesionLectura,
  eliminarSesionLectura,
  guardarSesionActiva,
  iniciarSesionLectura,
  obtenerSesionActiva,
  obtenerSesionesDeLibro,
  pausarSesionLectura,
  reanudarSesionLectura,
} from '../database';
import {
  elapsedSessionSeconds,
  readingCalendarDays,
  SESSION_STATES,
} from '../services/readingSessionService';
import { Theme } from '../constants/theme';
import { PremiumCard } from './PremiumUI';

const TABS = ['Resumen', 'Historial', 'Notas', 'Ficha'];

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function duration(seconds) {
  if (seconds == null) return 'Sin datos';
  const minutes = Math.max(1, Math.round(Number(seconds) / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
}

function dateLabel(value) {
  if (!value) return 'No registrada';
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}

function localTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addDays(date, days) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).format(result);
}

function Field({ label, value, onChangeText, keyboardType = 'default', multiline = false, placeholder }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={Theme.colors.placeholder}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

function Metric({ label, value }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

export default function BookReadingCenter({ book, onReload }) {
  const [tab, setTab] = useState('Resumen');
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [closeVisible, setCloseVisible] = useState(false);
  const [manualVisible, setManualVisible] = useState(false);
  const [editSession, setEditSession] = useState(null);
  const [datesVisible, setDatesVisible] = useState(false);
  const [finalPage, setFinalPage] = useState(String(book.pagina_actual ?? 0));
  const [sessionNote, setSessionNote] = useState('');
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    const [history, current] = await Promise.all([
      obtenerSesionesDeLibro(book.uuid),
      obtenerSesionActiva(book.uuid),
    ]);
    setSessions(history);
    setActive(current);
    setElapsed(current ? elapsedSessionSeconds(current) : 0);
  }, [book.uuid]);

  useEffect(() => { load().catch((error) => console.error(error)); }, [load]);
  useEffect(() => {
    if (!active || active.pausada_en) return undefined;
    const timer = setInterval(() => setElapsed(elapsedSessionSeconds(active)), 1000);
    return () => clearInterval(timer);
  }, [active]);

  async function locked(action, { reloadParent = true } = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
      await load();
      if (reloadParent) await onReload?.();
    } catch (error) {
      Alert.alert('No se pudo completar la acción', error.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const completed = sessions.filter((item) => item.estado === 'completada');
  const timed = sessions.filter((item) => item.estado !== 'activa' && Number(item.duracion_segundos) > 0);
  const pending = sessions.filter((item) => item.estado === 'pendiente');
  const totalSeconds = timed.reduce((sum, item) => sum + Number(item.duracion_segundos), 0);
  const totalPages = completed.reduce((sum, item) => sum + Number(item.paginas_leidas || 0), 0);
  const speedSeconds = completed.reduce((sum, item) => sum + Number(item.duracion_segundos || 0), 0);
  const speed = speedSeconds > 0 ? Math.round((totalPages * 3600) / speedSeconds) : null;
  const longest = timed.length ? Math.max(...timed.map((item) => Number(item.duracion_segundos))) : null;
  const recentCompleted = completed.slice(0, 5);
  const recentPages = recentCompleted.reduce((sum, item) => sum + Number(item.paginas_leidas || 0), 0);
  const recentDays = new Set(recentCompleted.map((item) => item.fecha)).size;
  const recentPace = recentDays ? recentPages / recentDays : null;
  const remainingPages = book.paginas_totales
    ? Math.max(0, Number(book.paginas_totales) - Number(book.pagina_actual))
    : null;
  const estimatedFinish = recentPace > 0 && remainingPages > 0
    ? addDays(today(), Math.ceil(remainingPages / recentPace))
    : null;
  const activeDays = new Set(timed.map((item) => item.fecha)).size;
  const lastReading = timed[0]?.fecha || null;
  const progress = book.paginas_totales ? Math.min(100, Math.round((Number(book.pagina_actual) / Number(book.paginas_totales)) * 100)) : null;
  const calendarDays = book.fecha_inicio_lectura
    ? readingCalendarDays(book.fecha_inicio_lectura, book.estado === 'terminado' ? book.fecha_fin : today())
    : null;

  function openManual() {
    setForm({
      fecha: today(), hora: localTime(), duracion: '',
      inicio: String(book.pagina_actual ?? 0), fin: String(book.pagina_actual ?? 0), nota: '',
    });
    setManualVisible(true);
  }

  function openEdit(item) {
    setForm({
      fecha: item.fecha, hora: localTime(item.hora_inicio),
      duracion: String(Math.round(Number(item.duracion_segundos || 0) / 60)),
      inicio: item.pagina_inicio == null ? '' : String(item.pagina_inicio),
      fin: item.pagina_fin == null ? '' : String(item.pagina_fin), nota: item.nota || '',
      estado: item.estado,
    });
    setEditSession(item);
  }

  function persistManual(updateStart) {
    locked(async () => {
        await agregarSesionManual(book.uuid, {
          fecha: form.fecha, hora: form.hora, duracionSegundos: Number(form.duracion) * 60,
          paginaInicio: Number(form.inicio), paginaFinal: Number(form.fin),
          nota: form.nota, actualizarFechaInicio: updateStart,
        });
        setManualVisible(false);
    });
  }

  function saveManual() {
    const earlier = book.fecha_inicio_lectura && form.fecha < book.fecha_inicio_lectura;
    if (earlier) {
      Alert.alert('Sesión anterior al comienzo registrado', '¿Quieres actualizar la fecha de inicio del libro?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Conservar fecha', onPress: () => persistManual(false) },
        { text: 'Actualizar', onPress: () => persistManual(true) },
      ]);
      return;
    }
    persistManual(false);
  }

  function saveEdited() {
    locked(async () => {
      await editarSesionLectura(editSession.id, {
        fecha: form.fecha, hora: form.hora, duracionSegundos: Number(form.duracion) * 60,
        paginaInicio: form.inicio === '' ? null : Number(form.inicio),
        paginaFinal: form.fin === '' ? null : Number(form.fin),
        nota: form.nota, estado: form.estado,
      });
      setEditSession(null);
    });
  }

  function confirmDelete(item) {
    Alert.alert('Eliminar sesión', 'La sesión dejará de participar en las estadísticas. El progreso actual no se reducirá automáticamente.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => locked(() => eliminarSesionLectura(item.id)) },
    ]);
  }

  function confirmDiscardActive() {
    Alert.alert(
      'Descartar sesión activa',
      'Se eliminará este cronómetro sin modificar el progreso del libro.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar',
          style: 'destructive',
          onPress: () => locked(async () => {
            await descartarSesionActiva(book.uuid);
            setCloseVisible(false);
          }),
        },
      ]
    );
  }

  function openDates() {
    setForm({ inicioLectura: book.fecha_inicio_lectura || '', finLectura: book.fecha_fin || '' });
    setDatesVisible(true);
  }

  function saveDates() {
    locked(async () => {
      await actualizarLibro(book.id, {
        fecha_inicio_lectura: form.inicioLectura || null,
        fecha_fin: form.finLectura || null,
        estado: form.finLectura ? 'terminado' : (book.estado === 'terminado' ? 'leyendo' : book.estado),
      });
      setDatesVisible(false);
    });
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {TABS.map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}
      </View>

      {tab === 'Resumen' ? (
        <View style={styles.stack}>
          <PremiumCard>
            <View style={styles.progressHeader}><Text style={styles.sectionTitle}>Progreso de lectura</Text><Text style={styles.progress}>{progress == null ? '—' : `${progress}%`}</Text></View>
            <Text style={styles.primary}>{book.pagina_actual} {book.paginas_totales ? `/ ${book.paginas_totales} páginas` : 'páginas'}</Text>
            <Text style={styles.secondary}>{book.paginas_totales ? `${Math.max(0, Number(book.paginas_totales) - Number(book.pagina_actual))} páginas restantes` : 'Extensión no registrada'}</Text>
            <View style={styles.metrics}>
              <Metric label="Tiempo efectivo" value={totalSeconds ? duration(totalSeconds) : 'Sin datos'} />
              <Metric label="Páginas registradas" value={completed.length ? totalPages : 'Sin datos'} />
              <Metric label="Sesiones" value={timed.length || 'Sin datos'} />
              <Metric label="Ritmo" value={speed == null ? 'Sin datos' : `${speed} pág/h`} />
              <Metric label="Pendientes" value={pending.length} />
              <Metric label="Días con sesiones" value={activeDays || 'Sin datos'} />
              <Metric label="Sesión más larga" value={longest ? duration(longest) : 'Sin datos'} />
              <Metric label="Ritmo reciente" value={recentPace ? `${Math.round(recentPace)} pág/día` : 'Sin datos'} />
            </View>
            <Text style={styles.secondary}>Última lectura: {dateLabel(lastReading)}</Text>
            {estimatedFinish ? <Text style={styles.secondary}>Finalización estimada: {estimatedFinish}</Text> : null}
            {estimatedFinish ? <Text style={styles.hint}>Estimación basada en las páginas por día de tus últimas cinco sesiones completas.</Text> : null}
            {!speed ? <Text style={styles.hint}>Aún no hay suficientes sesiones completas para calcular tu ritmo.</Text> : null}
          </PremiumCard>

          <PremiumCard>
            <Text style={styles.sectionTitle}>Fechas de lectura</Text>
            <Text style={styles.rowText}>Comenzado: {dateLabel(book.fecha_inicio_lectura)}</Text>
            <Text style={styles.rowText}>Terminado: {book.fecha_fin ? dateLabel(book.fecha_fin) : 'En lectura'}</Text>
            <Text style={styles.rowText}>{book.estado === 'terminado' ? 'Duración de la lectura' : 'Días leyendo'}: {calendarDays ?? 'Sin datos'}</Text>
            <Pressable onPress={openDates} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>EDITAR FECHAS</Text></Pressable>
          </PremiumCard>

          <PremiumCard>
            <Text style={styles.sectionTitle}>{active ? 'Sesión recuperada' : 'Sesión de lectura'}</Text>
            {active ? <Text style={styles.timer}>{duration(elapsed)}</Text> : <Text style={styles.secondary}>El cronómetro se reconstruye desde SQLite aunque Android cierre la app.</Text>}
            <View style={styles.actions}>
              {!active ? (
                <Pressable disabled={busy} onPress={() => locked(() => iniciarSesionLectura(book.uuid, Number(book.pagina_actual)))} style={styles.primaryButton}><Text style={styles.primaryButtonText}>INICIAR SESIÓN</Text></Pressable>
              ) : active.pausada_en ? (
                <Pressable disabled={busy} onPress={() => locked(() => reanudarSesionLectura(book.uuid))} style={styles.primaryButton}><Text style={styles.primaryButtonText}>SEGUIR LEYENDO</Text></Pressable>
              ) : (
                <Pressable disabled={busy} onPress={() => locked(async () => { const paused = await pausarSesionLectura(book.uuid); setActive(paused); setElapsed(paused.duracion_segundos); setFinalPage(String(book.pagina_actual)); setSessionNote(''); setCloseVisible(true); }, { reloadParent: false })} style={styles.primaryButton}><Text style={styles.primaryButtonText}>DETENER SESIÓN</Text></Pressable>
              )}
              <Pressable onPress={openManual} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>AGREGAR SESIÓN MANUAL</Text></Pressable>
            </View>
          </PremiumCard>
        </View>
      ) : null}

      {tab === 'Historial' ? (
        <View style={styles.stack}>
          {sessions.filter((item) => item.estado !== 'activa').length ? sessions.filter((item) => item.estado !== 'activa').map((item) => (
            <PremiumCard key={item.uuid || item.id}>
              <View style={styles.progressHeader}><Text style={styles.sectionTitle}>{dateLabel(item.fecha)}</Text><Text style={[styles.badge, item.estado === 'pendiente' && styles.pending]}>{item.estado}</Text></View>
              <Text style={styles.primary}>{duration(item.duracion_segundos)} · {item.estado === 'pendiente' ? 'Páginas pendientes' : `${item.pagina_inicio} → ${item.pagina_fin} (${item.paginas_leidas} pág.)`}</Text>
              <Text style={styles.secondary}>{item.origen === 'manual' ? 'Sesión manual' : 'Cronómetro'}{item.editada ? ' · Editada' : ''}</Text>
              {item.nota ? <Text style={styles.note}>{item.nota}</Text> : null}
              <View style={styles.inlineActions}>
                <Pressable onPress={() => openEdit(item)}><Text style={styles.link}>{item.estado === 'pendiente' ? 'COMPLETAR' : 'EDITAR'}</Text></Pressable>
                <Pressable onPress={() => confirmDelete(item)}><Text style={[styles.link, styles.danger]}>ELIMINAR</Text></Pressable>
              </View>
            </PremiumCard>
          )) : <Text style={styles.empty}>Todavía no hay sesiones registradas para este libro.</Text>}
        </View>
      ) : null}

      {tab === 'Notas' ? <PremiumCard><Text style={styles.sectionTitle}>Notas del libro</Text><Text style={styles.note}>{book.notas || 'Todavía no escribiste notas para este libro.'}</Text></PremiumCard> : null}
      {tab === 'Ficha' ? <PremiumCard><Text style={styles.sectionTitle}>Ficha técnica</Text><Text style={styles.rowText}>ISBN: {book.isbn || 'No registrado'}</Text><Text style={styles.rowText}>Autor: {book.autor || 'No registrado'}</Text><Text style={styles.rowText}>Páginas: {book.paginas_totales || 'No registradas'}</Text><Text style={styles.rowText}>Agregado: {dateLabel(String(book.fecha_agregado || '').slice(0, 10))}</Text><Text style={styles.rowText}>Estado: {book.estado}</Text></PremiumCard> : null}

      <Modal visible={closeVisible} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={styles.overlay}><ScrollView style={styles.sheet}><Text style={styles.modalTitle}>Cerrar sesión</Text><Text style={styles.primary}>{book.titulo}</Text><Text style={styles.timer}>{duration(elapsed)}</Text><Text style={styles.secondary}>Página inicial: {active?.pagina_inicio}</Text>
          <Field label="Página final" value={finalPage} onChangeText={(value) => setFinalPage(value.replace(/\D/g, ''))} keyboardType="number-pad" />
          <Field label="Nota opcional" value={sessionNote} onChangeText={setSessionNote} multiline />
          <Pressable onPress={() => locked(async () => { await guardarSesionActiva(book.uuid, Number(finalPage), sessionNote); setCloseVisible(false); })} style={styles.primaryButton}><Text style={styles.primaryButtonText}>GUARDAR SESIÓN</Text></Pressable>
          <Pressable onPress={() => locked(async () => { await reanudarSesionLectura(book.uuid); setCloseVisible(false); })} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>SEGUIR LEYENDO</Text></Pressable>
          <Pressable onPress={() => locked(async () => { await completarSesionDespues(book.uuid, sessionNote); setCloseVisible(false); })} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>COMPLETAR DESPUÉS</Text></Pressable>
          <Pressable onPress={confirmDiscardActive} style={styles.secondaryButton}><Text style={[styles.secondaryButtonText, styles.danger]}>DESCARTAR SESIÓN</Text></Pressable>
        </ScrollView></View>
      </Modal>

      <Modal visible={manualVisible || Boolean(editSession)} transparent animationType="slide" onRequestClose={() => { setManualVisible(false); setEditSession(null); }}>
        <View style={styles.overlay}><ScrollView style={styles.sheet}><Text style={styles.modalTitle}>{editSession ? 'Editar sesión' : 'Agregar sesión manual'}</Text><Text style={styles.secondary}>{book.titulo}</Text>
          <Field label="Fecha (AAAA-MM-DD)" value={form.fecha || ''} onChangeText={(value) => setForm((old) => ({ ...old, fecha: value }))} />
          <Field label="Hora aproximada (HH:MM)" value={form.hora || ''} onChangeText={(value) => setForm((old) => ({ ...old, hora: value }))} keyboardType="numbers-and-punctuation" />
          <Field label="Duración (minutos)" value={form.duracion || ''} onChangeText={(value) => setForm((old) => ({ ...old, duracion: value.replace(/\D/g, '') }))} keyboardType="number-pad" />
          <Field label="Página inicial" value={form.inicio || ''} onChangeText={(value) => setForm((old) => ({ ...old, inicio: value.replace(/\D/g, '') }))} keyboardType="number-pad" />
          <Field label="Página final" value={form.fin || ''} onChangeText={(value) => setForm((old) => ({ ...old, fin: value.replace(/\D/g, '') }))} keyboardType="number-pad" />
          <Field label="Nota opcional" value={form.nota || ''} onChangeText={(value) => setForm((old) => ({ ...old, nota: value }))} multiline />
          {editSession ? <Pressable onPress={() => setForm((old) => ({ ...old, estado: old.estado === 'pendiente' ? 'completada' : 'pendiente' }))} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{form.estado === 'pendiente' ? 'MARCAR COMPLETADA' : 'MARCAR PENDIENTE'}</Text></Pressable> : null}
          <Pressable disabled={busy} onPress={editSession ? saveEdited : saveManual} style={styles.primaryButton}><Text style={styles.primaryButtonText}>GUARDAR</Text></Pressable>
          <Pressable onPress={() => { setManualVisible(false); setEditSession(null); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>CANCELAR</Text></Pressable>
        </ScrollView></View>
      </Modal>

      <Modal visible={datesVisible} transparent animationType="slide" onRequestClose={() => setDatesVisible(false)}>
        <View style={styles.overlay}><View style={styles.sheet}><Text style={styles.modalTitle}>Fechas de lectura</Text>
          <Field label="Comenzado (AAAA-MM-DD)" value={form.inicioLectura || ''} onChangeText={(value) => setForm((old) => ({ ...old, inicioLectura: value }))} placeholder="No registrada" />
          <Field label="Terminado (AAAA-MM-DD)" value={form.finLectura || ''} onChangeText={(value) => setForm((old) => ({ ...old, finLectura: value }))} placeholder="En lectura" />
          <Pressable onPress={saveDates} style={styles.primaryButton}><Text style={styles.primaryButtonText}>GUARDAR FECHAS</Text></Pressable>
          <Pressable onPress={() => setDatesVisible(false)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>CANCELAR</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  tabs: { flexDirection: 'row', gap: Theme.spacing.xs, marginBottom: Theme.spacing.lg },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Theme.radii.md, backgroundColor: Theme.colors.surface },
  tabActive: { backgroundColor: Theme.colors.accentGlow, borderWidth: 1, borderColor: Theme.colors.accentStroke },
  tabText: { color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, fontSize: 10 },
  tabTextActive: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold },
  stack: { gap: Theme.spacing.md },
  sectionTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Theme.spacing.md },
  progress: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 22 },
  primary: { marginTop: Theme.spacing.sm, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  secondary: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  hint: { marginTop: Theme.spacing.md, color: Theme.colors.warning, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm, marginVertical: Theme.spacing.lg },
  metric: { width: '47%', padding: Theme.spacing.md, borderRadius: Theme.radii.md, backgroundColor: Theme.colors.surfaceElevated },
  metricValue: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 16 },
  metricLabel: { marginTop: 2, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, fontSize: 10 },
  rowText: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  timer: { marginVertical: Theme.spacing.md, color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 28 },
  actions: { gap: Theme.spacing.sm, marginTop: Theme.spacing.lg },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: Theme.spacing.md, borderRadius: Theme.radii.md, backgroundColor: Theme.colors.accent },
  primaryButtonText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Theme.spacing.sm, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md },
  secondaryButtonText: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  inlineActions: { flexDirection: 'row', gap: Theme.spacing.xl, marginTop: Theme.spacing.md },
  link: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  danger: { color: Theme.colors.danger },
  badge: { color: Theme.colors.success, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label },
  pending: { color: Theme.colors.warning },
  note: { marginTop: Theme.spacing.md, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  empty: { padding: Theme.spacing.xl, color: Theme.colors.textSecondary, textAlign: 'center', fontFamily: Theme.typography.families.interface },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Theme.colors.overlay },
  sheet: { maxHeight: '88%', padding: Theme.spacing.xl, paddingBottom: Theme.spacing.xxxl, backgroundColor: Theme.colors.surface, borderTopLeftRadius: Theme.radii.xl, borderTopRightRadius: Theme.radii.xl },
  modalTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.title },
  field: { marginTop: Theme.spacing.md },
  label: { marginBottom: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.label },
  input: { minHeight: 48, paddingHorizontal: Theme.spacing.md, color: Theme.colors.textPrimary, backgroundColor: Theme.colors.surfaceElevated, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md, fontFamily: Theme.typography.families.interface },
  multiline: { minHeight: 88, paddingTop: Theme.spacing.md, textAlignVertical: 'top' },
});

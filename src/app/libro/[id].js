import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  actualizarLibro,
  actualizarProgreso,
  eliminarLibro,
  iniciarSesionLectura,
  obtenerLibroPorId,
  obtenerSesionActiva,
  terminarSesionLectura,
} from '../../database';
import {
  descartarPortadaTemporal,
  obtenerFeedbackPortada,
  optimizarYGuardarPortada,
  pegarPortadaDesdePortapapeles,
  PortadaError,
} from '../../portadas';
import { Theme } from '../../constants/theme';
import { PremiumButton, PremiumCard } from '../../components/PremiumUI';

const ESTADOS = ['quiero leer', 'leyendo', 'terminado', 'abandonado'];

export default function LibroDetalleScreen() {
  const scrollRef = useRef(null);
  const isMountedRef = useRef(false);
  const portadaTemporalRef = useRef(null);
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [libro, setLibro] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editando, setEditando] = useState(false);
  const [sesionActiva, setSesionActiva] = useState(null);
  const [paginaSesion, setPaginaSesion] = useState('0');
  const [procesandoSesion, setProcesandoSesion] = useState(false);

  const cargarLibro = useCallback(async (isActive = () => isMountedRef.current) => {
    if (isActive()) setLoading(true);
    try {
      const encontrado = await obtenerLibroPorId(id);
      if (!encontrado) {
        if (!isActive()) return;
        Alert.alert('Libro no encontrado', 'Este libro ya no existe en la biblioteca.', [
          { text: 'Volver', onPress: () => router.back() },
        ]);
        return;
      }
      const sesion = await obtenerSesionActiva(encontrado.uuid);
      if (!isActive()) return;
      setLibro({
        ...encontrado,
        paginas_totales: encontrado.paginas_totales == null ? '' : String(encontrado.paginas_totales),
        pagina_actual: String(encontrado.pagina_actual ?? 0),
        notas: encontrado.notas || '',
      });
      setSesionActiva(sesion);
      setPaginaSesion(String(encontrado.pagina_actual ?? 0));
    } catch (error) {
      console.error(error);
      if (isActive()) Alert.alert('Error', 'No se pudo cargar la ficha del libro.');
    } finally {
      if (isActive()) setLoading(false);
    }
  }, [id, router]);

  useFocusEffect(useCallback(() => {
    let isMounted = true;
    isMountedRef.current = true;
    cargarLibro(() => isMounted);
    return () => {
      isMounted = false;
      isMountedRef.current = false;
      descartarPortadaTemporal(portadaTemporalRef.current);
      portadaTemporalRef.current = null;
    };
  }, [cargarLibro]));

  function cambiarCampo(campo, valor) {
    setLibro((actual) => ({ ...actual, [campo]: valor }));
  }

  function mantenerInputVisible(event, extraOffset = 110) {
    const target = event.target || event.nativeEvent.target;
    setTimeout(() => {
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        target,
        extraOffset,
        true
      );
    }, Platform.OS === 'android' ? 280 : 80);
  }

  async function seleccionarPortada() {
    try {
      const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permiso.granted) {
        throw new PortadaError('PERMISO_DENEGADO', 'No se concedió acceso a la galería.');
      }
      const resultado = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [2, 3],
        quality: 0.9,
      });
      if (resultado.canceled) return;
      const portada = await optimizarYGuardarPortada(resultado.assets[0].uri, { temporal: true });
      descartarPortadaTemporal(portadaTemporalRef.current);
      portadaTemporalRef.current = portada;
      cambiarCampo('portada_url', portada);
    } catch (error) {
      console.error(error);
      const feedback = obtenerFeedbackPortada(error, 'Portada no disponible');
      Alert.alert(feedback.titulo, feedback.mensaje);
    }
  }

  async function pegarPortada() {
    try {
      const portada = await pegarPortadaDesdePortapapeles({ temporal: true });
      if (!portada) {
        Alert.alert(
          'No hay una imagen para pegar',
          'Copia una imagen desde el navegador, la galería u otra aplicación y vuelve a intentarlo.'
        );
        return;
      }
      descartarPortadaTemporal(portadaTemporalRef.current);
      portadaTemporalRef.current = portada;
      cambiarCampo('portada_url', portada);
    } catch (error) {
      console.error(error);
      const feedback = obtenerFeedbackPortada(error, 'No se pudo pegar la portada');
      Alert.alert(feedback.titulo, feedback.mensaje);
    }
  }

  async function guardar() {
    const paginaActual = Number(libro.pagina_actual);
    const paginasTotales = libro.paginas_totales === '' ? null : Number(libro.paginas_totales);
    if (!libro.titulo.trim()) {
      Alert.alert('Falta el título', 'El título es obligatorio.');
      return;
    }
    if (!Number.isInteger(paginaActual) || paginaActual < 0) {
      Alert.alert('Progreso inválido', 'La página actual debe ser un número entero mayor o igual a cero.');
      return;
    }
    if (paginasTotales !== null && (!Number.isInteger(paginasTotales) || paginasTotales < 0)) {
      Alert.alert('Páginas inválidas', 'Las páginas totales deben ser un número entero mayor o igual a cero.');
      return;
    }
    if (paginasTotales !== null && paginaActual > paginasTotales) {
      Alert.alert('Progreso inválido', 'La página actual no puede superar las páginas totales.');
      return;
    }

    setSaving(true);
    try {
      await actualizarLibro(id, {
        titulo: libro.titulo,
        autor: libro.autor,
        paginas_totales: paginasTotales,
        pagina_actual: paginaActual,
        estado: libro.estado,
        notas: libro.notas,
        portada_url: libro.portada_url || null,
      });
      Alert.alert('Crónica guardada', 'Los cambios fueron guardados en el dispositivo.');
      portadaTemporalRef.current = null;
      await cargarLibro();
      if (isMountedRef.current) setEditando(false);
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        if (error?.codigo) {
          const feedback = obtenerFeedbackPortada(error, 'No se pudo guardar la portada');
          Alert.alert(feedback.titulo, feedback.mensaje);
        } else {
          Alert.alert('No se pudo guardar', error.message || 'Ocurrió un error al actualizar el libro.');
        }
      }
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  }

  async function cancelarEdicion() {
    descartarPortadaTemporal(portadaTemporalRef.current);
    portadaTemporalRef.current = null;
    setEditando(false);
    await cargarLibro();
  }

  async function alternarSesionLectura() {
    if (procesandoSesion) return;
    const paginaActual = Number(paginaSesion);
    if (!Number.isInteger(paginaActual) || paginaActual < 0) {
      Alert.alert('Página inválida', 'Ingresa la página actual antes de terminar la sesión.');
      return;
    }
    const total = libro.paginas_totales === '' ? null : Number(libro.paginas_totales);
    if (total !== null && paginaActual > total) {
      Alert.alert('Página inválida', 'La página actual no puede superar las páginas totales del libro.');
      return;
    }

    setProcesandoSesion(true);
    try {
      if (!sesionActiva) {
        const sesion = await iniciarSesionLectura(libro.uuid, paginaActual);
        if (!isMountedRef.current) return;
        setSesionActiva(sesion);
        Alert.alert('Sesión iniciada', 'El tiempo de lectura comenzó a registrarse en este dispositivo.');
      } else {
        const sesionTerminada = await terminarSesionLectura(libro.uuid, paginaActual);
        await actualizarProgreso(libro.id, paginaActual, libro.estado);
        if (!isMountedRef.current) return;
        setSesionActiva(null);
        setLibro((actual) => ({ ...actual, pagina_actual: String(paginaActual) }));
        Alert.alert(
          'Sesión terminada',
          `Leíste ${sesionTerminada.paginas_leidas} páginas durante ${sesionTerminada.minutos} minutos.`
        );
      }
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        Alert.alert('No se pudo registrar la sesión', error.message || 'Inténtalo nuevamente.');
      }
    } finally {
      if (isMountedRef.current) setProcesandoSesion(false);
    }
  }

  function confirmarEliminacion() {
    Alert.alert(
      'Eliminar libro',
      `¿Quieres eliminar “${libro.titulo}”? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await eliminarLibro(id);
              router.replace('/');
            } catch (error) {
              console.error(error);
              Alert.alert('No se pudo eliminar', 'El libro permanece en la biblioteca.');
            }
          },
        },
      ]
    );
  }

  if (loading || !libro) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Theme.colors.accentBright} /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
      >
        {libro.portada_url ? (
          <Image source={{ uri: libro.portada_url }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.placeholder]}>
            <Ionicons name="book-outline" size={58} color={Theme.colors.textTertiary} />
          </View>
        )}

        {editando ? <View style={styles.coverActions}>
          <Pressable style={styles.coverButton} onPress={seleccionarPortada} disabled={saving}>
          <Ionicons name="image-outline" size={18} color={Theme.colors.textSecondary} />
            <Text style={styles.coverButtonText}>GALERÍA</Text>
          </Pressable>
          <Pressable style={styles.coverButton} onPress={pegarPortada} disabled={saving}>
          <Ionicons name="clipboard-outline" size={18} color={Theme.colors.textSecondary} />
            <Text style={styles.coverButtonText}>PEGAR IMAGEN</Text>
          </Pressable>
        </View> : null}

        <PremiumCard style={[styles.readCard, styles.sessionCard]}>
          <View style={styles.sessionHeading}>
            <View style={[styles.sessionIcon, sesionActiva && styles.sessionIconActive]}>
              <Ionicons
                name={sesionActiva ? 'timer' : 'timer-outline'}
                size={22}
                color={sesionActiva ? Theme.colors.accentInteractive : Theme.colors.textSecondary}
              />
            </View>
            <View style={styles.sessionCopy}>
              <Text style={styles.sessionTitle}>{sesionActiva ? 'Sesión en curso' : 'Sesión de lectura'}</Text>
              <Text style={styles.sessionHelp}>
                {sesionActiva ? 'Actualiza la página alcanzada antes de terminar.' : 'Registra tiempo y páginas leídas.'}
              </Text>
            </View>
          </View>
          {sesionActiva ? (
            <View style={styles.sessionPageRow}>
              <Text style={styles.readLabel}>PÁGINA ACTUAL</Text>
              <TextInput
                value={paginaSesion}
                onChangeText={(value) => setPaginaSesion(value.replace(/\D/g, ''))}
                style={styles.sessionPageInput}
                keyboardType="number-pad"
                accessibilityLabel="Página alcanzada en la sesión"
              />
            </View>
          ) : null}
          <PremiumButton
            style={styles.sessionButton}
            onPress={alternarSesionLectura}
            disabled={procesandoSesion}
          >
            {procesandoSesion ? (
              <ActivityIndicator color={Theme.colors.textPrimary} />
            ) : (
              <>
                <Ionicons name={sesionActiva ? 'stop' : 'play'} size={18} color={Theme.colors.textPrimary} />
                <Text style={styles.saveText}>{sesionActiva ? 'TERMINAR SESIÓN' : 'INICIAR SESIÓN DE LECTURA'}</Text>
              </>
            )}
          </PremiumButton>
        </PremiumCard>

        {editando ? <>
        <PremiumCard style={styles.card}>
          <Text style={styles.label}>TÍTULO</Text>
          <TextInput value={libro.titulo} onFocus={mantenerInputVisible} onChangeText={(value) => cambiarCampo('titulo', value)} style={styles.input} placeholderTextColor={Theme.colors.textTertiary} />
          <Text style={styles.label}>AUTOR</Text>
          <TextInput value={libro.autor || ''} onFocus={mantenerInputVisible} onChangeText={(value) => cambiarCampo('autor', value)} style={styles.input} placeholder="Autor desconocido" placeholderTextColor={Theme.colors.textTertiary} />
          <Text style={styles.label}>PÁGINAS TOTALES</Text>
          <TextInput value={libro.paginas_totales} onFocus={mantenerInputVisible} onChangeText={(value) => cambiarCampo('paginas_totales', value.replace(/\D/g, ''))} style={styles.input} keyboardType="number-pad" placeholder="Sin especificar" placeholderTextColor={Theme.colors.textTertiary} />
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <Text style={styles.sectionTitle}>Estado de lectura</Text>
          <View style={styles.states}>
            {ESTADOS.map((estado) => (
              <Pressable key={estado} onPress={() => cambiarCampo('estado', estado)} style={[styles.stateButton, libro.estado === estado && styles.stateButtonActive]}>
                <Text style={[styles.stateText, libro.estado === estado && styles.stateTextActive]}>{estado}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>PÁGINA ACTUAL</Text>
          <TextInput value={libro.pagina_actual} onFocus={mantenerInputVisible} onChangeText={(value) => cambiarCampo('pagina_actual', value.replace(/\D/g, ''))} style={styles.input} keyboardType="number-pad" />
          <Text style={styles.label}>NOTAS PERSONALES</Text>
          <TextInput value={libro.notas} onFocus={(event) => mantenerInputVisible(event, 150)} onChangeText={(value) => cambiarCampo('notas', value)} style={[styles.input, styles.notes]} multiline textAlignVertical="top" placeholder="Escribe aquí tu crónica…" placeholderTextColor={Theme.colors.textTertiary} />
        </PremiumCard>

        <PremiumButton style={styles.saveButton} onPress={guardar} disabled={saving}>
          {saving ? <ActivityIndicator color={Theme.colors.textPrimary} /> : <Text style={styles.saveText}>GUARDAR CRÓNICA</Text>}
        </PremiumButton>
        <Pressable style={styles.cancelButton} onPress={cancelarEdicion} disabled={saving}>
          <Text style={styles.coverButtonText}>CANCELAR EDICIÓN</Text>
        </Pressable>
        <Pressable style={styles.deleteButton} onPress={confirmarEliminacion} disabled={saving}>
          <Ionicons name="trash-outline" size={19} color={Theme.colors.textPrimary} />
          <Text style={styles.deleteText}>ELIMINAR LIBRO</Text>
        </Pressable>
        </> : <>
          <View style={styles.museumHeader}>
            <View style={styles.statusBadge}><View style={styles.statusDot} /><Text style={styles.statusText}>{libro.estado}</Text></View>
            <Text style={styles.museumTitle}>{libro.titulo}</Text>
            <Text style={styles.museumAuthor}>{libro.autor || 'Autor desconocido'}</Text>
          </View>
          <PremiumCard style={styles.readCard}>
            <Text style={styles.sectionTitle}>Ficha técnica</Text>
            <View style={styles.readRow}><Text style={styles.readLabel}>ISBN</Text><Text style={styles.readValue}>{libro.isbn || 'Sin ISBN'}</Text></View>
            <View style={styles.readDivider} />
            <View style={styles.readRow}><Text style={styles.readLabel}>Extensión</Text><Text style={styles.readValue}>{libro.paginas_totales ? `${libro.paginas_totales} páginas` : 'Sin especificar'}</Text></View>
            <View style={styles.readDivider} />
            <View style={styles.readRow}><Text style={styles.readLabel}>Progreso</Text><Text style={styles.readValue}>{libro.pagina_actual} {libro.paginas_totales ? `/ ${libro.paginas_totales}` : 'páginas'}</Text></View>
          </PremiumCard>
          <PremiumCard style={styles.readCard}>
            <Text style={styles.sectionTitle}>Notas personales</Text>
            <Text style={[styles.notesText, !libro.notas && styles.emptyNotes]}>{libro.notas || 'Todavía no escribiste notas para este libro.'}</Text>
          </PremiumCard>
        </>}
      </ScrollView>
      {!editando ? (
        <Pressable style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]} onPress={() => setEditando(true)} accessibilityRole="button" accessibilityLabel="Editar libro">
          <Ionicons name="create-outline" size={24} color={Theme.colors.textPrimary} />
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background },
  scroll: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.background },
  content: { alignItems: 'center', padding: Theme.spacing.xl, paddingBottom: 112 },
  cover: { width: 210, height: 315, borderRadius: Theme.radii.lg, backgroundColor: Theme.colors.surface, marginBottom: Theme.spacing.xl, ...Theme.shadows.modal },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Theme.colors.stroke },
  coverActions: { width: '100%', flexDirection: 'row', gap: Theme.spacing.sm, marginBottom: Theme.spacing.lg },
  coverButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Theme.spacing.sm, paddingHorizontal: Theme.spacing.md, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md },
  coverButtonText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label },
  card: { width: '100%', padding: Theme.spacing.lg, marginBottom: Theme.spacing.lg },
  sectionTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.section, marginBottom: Theme.spacing.md },
  label: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.sm },
  input: { minHeight: 48, paddingHorizontal: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md },
  notes: { minHeight: 130, paddingTop: Theme.spacing.md },
  states: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm, marginBottom: Theme.spacing.xs },
  stateButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Theme.spacing.md, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.pill, backgroundColor: Theme.colors.surface },
  stateButtonActive: { borderColor: Theme.colors.accentStroke, backgroundColor: Theme.colors.surfacePressed },
  stateText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary, textTransform: 'capitalize' },
  stateTextActive: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold },
  saveButton: { width: '100%', marginTop: Theme.spacing.xs },
  saveText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  cancelButton: { width: '100%', minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Theme.spacing.md, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md },
  deleteButton: { width: '100%', minHeight: 50, flexDirection: 'row', gap: Theme.spacing.sm, alignItems: 'center', justifyContent: 'center', marginTop: Theme.spacing.xl, backgroundColor: Theme.colors.accentPressed, borderWidth: 1, borderColor: Theme.colors.accentStroke, borderRadius: Theme.radii.md },
  deleteText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  disabled: { opacity: 0.55 },
  museumHeader: { width: '100%', alignItems: 'center', marginBottom: Theme.spacing.xxl },
  statusBadge: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm, paddingHorizontal: Theme.spacing.md, marginBottom: Theme.spacing.lg, backgroundColor: Theme.colors.surfacePressed, borderWidth: 1, borderColor: Theme.colors.strokeFocus, borderRadius: Theme.radii.pill },
  statusDot: { width: 7, height: 7, backgroundColor: Theme.colors.accentInteractive, borderRadius: Theme.radii.pill },
  statusText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label, textTransform: 'uppercase' },
  museumTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.display, textAlign: 'center' },
  museumAuthor: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
  readCard: { width: '100%', marginBottom: Theme.spacing.lg },
  sessionCard: { backgroundColor: Theme.colors.surfaceElevated },
  sessionHeading: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  sessionIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.surface, borderRadius: Theme.radii.pill },
  sessionIconActive: { backgroundColor: Theme.colors.accentGlow, borderWidth: 1, borderColor: Theme.colors.accentStroke },
  sessionCopy: { flex: 1 },
  sessionTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  sessionHelp: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  sessionPageRow: { flexDirection: 'row', alignItems: 'center', marginTop: Theme.spacing.lg },
  sessionPageInput: { width: 88, minHeight: 44, marginLeft: 'auto', paddingHorizontal: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.body, textAlign: 'center', backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.strokeFocus, borderRadius: Theme.radii.md },
  sessionButton: { width: '100%', marginTop: Theme.spacing.lg },
  readRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.lg },
  readLabel: { width: 90, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, textTransform: 'uppercase' },
  readValue: { flex: 1, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'right' },
  readDivider: { height: 1, backgroundColor: Theme.colors.stroke },
  notesText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  emptyNotes: { color: Theme.colors.textTertiary, fontStyle: 'italic' },
  fab: { position: 'absolute', right: Theme.spacing.xl, bottom: Theme.spacing.xl, width: 58, height: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.accentInteractive, borderRadius: Theme.radii.pill, borderWidth: 1, borderColor: Theme.colors.strokeFocus, shadowColor: Theme.colors.accent, shadowOpacity: 0.38, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 8 },
  fabPressed: { backgroundColor: Theme.colors.accentPressed, transform: [{ scale: 0.96 }] },
});

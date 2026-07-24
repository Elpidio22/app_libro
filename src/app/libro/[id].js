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
  asignarEtiquetaALibro,
  actualizarLibro,
  crearEtiqueta,
  eliminarLibro,
  obtenerEtiquetas,
  obtenerEtiquetasDeLibro,
  obtenerLibroPorId,
  quitarEtiquetaDelLibro,
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
import BookReadingCenter from '../../components/BookReadingCenter';
import { useKeyboardAwareScroll } from '../../hooks/useKeyboardAwareScroll';

const ESTADOS = ['quiero leer', 'leyendo', 'terminado', 'abandonado'];

function fechaLocalISO(fecha = new Date()) {
  return new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function LibroDetalleScreen() {
  const { scrollRef, keyboardHeight, onInputFocus, onScroll } = useKeyboardAwareScroll();
  const isMountedRef = useRef(false);
  const portadaTemporalRef = useRef(null);
  const isProcessingTagsRef = useRef(false);
  const libroPersistidoRef = useRef(null);
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [libro, setLibro] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editando, setEditando] = useState(false);
  const [etiquetas, setEtiquetas] = useState([]);
  const [etiquetasAsignadas, setEtiquetasAsignadas] = useState(new Set());
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('');
  const [procesandoEtiquetas, setProcesandoEtiquetas] = useState(false);

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
      const [todasLasEtiquetas, etiquetasDelLibro] = await Promise.all([
        obtenerEtiquetas(),
        obtenerEtiquetasDeLibro(encontrado.uuid),
      ]);
      if (!isActive()) return;
      setLibro({
        ...encontrado,
        paginas_totales: encontrado.paginas_totales == null ? '' : String(encontrado.paginas_totales),
        pagina_actual: String(encontrado.pagina_actual ?? 0),
        notas: encontrado.notas || '',
      });
      libroPersistidoRef.current = encontrado;
      setEtiquetas(todasLasEtiquetas);
      setEtiquetasAsignadas(new Set(etiquetasDelLibro.map((etiqueta) => etiqueta.uuid)));
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
    onInputFocus(event, Math.max(24, extraOffset - 86));
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

  async function guardar(options = {}) {
    const { fechasConfirmadas = false, fechaFin = libro.fecha_fin } = options?.nativeEvent ? {} : options;
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
    const original = libroPersistidoRef.current;
    if (!fechasConfirmadas && original?.estado !== 'terminado' && libro.estado === 'terminado') {
      const fechaSugerida = libro.fecha_fin || fechaLocalISO();
      Alert.alert(
        'Marcar como terminado',
        `Se registrará ${fechaSugerida} como fecha de finalización. Puedes cambiarla en el campo de fechas antes de confirmar.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: () => guardar({ fechasConfirmadas: true, fechaFin: fechaSugerida }) },
        ]
      );
      return;
    }
    if (!fechasConfirmadas && original?.estado === 'terminado' && libro.estado !== 'terminado') {
      Alert.alert(
        'Posible relectura',
        'Este libro ya tiene una lectura finalizada. ¿Quieres conservar esa fecha como registro histórico?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Quitar fecha', style: 'destructive', onPress: () => guardar({ fechasConfirmadas: true, fechaFin: null }) },
          { text: 'Conservar', onPress: () => guardar({ fechasConfirmadas: true, fechaFin: original.fecha_fin }) },
        ]
      );
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
        fecha_inicio_lectura: libro.fecha_inicio_lectura || null,
        fecha_fin: fechaFin || null,
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

  async function alternarEtiqueta(etiqueta) {
    if (isProcessingTagsRef.current) return;
    isProcessingTagsRef.current = true;
    setProcesandoEtiquetas(true);
    try {
      if (etiquetasAsignadas.has(etiqueta.uuid)) {
        await quitarEtiquetaDelLibro(libro.uuid, etiqueta.uuid);
        if (isMountedRef.current) {
          setEtiquetasAsignadas((actuales) => {
            const siguientes = new Set(actuales);
            siguientes.delete(etiqueta.uuid);
            return siguientes;
          });
        }
      } else {
        await asignarEtiquetaALibro(libro.uuid, etiqueta.uuid);
        if (isMountedRef.current) {
          setEtiquetasAsignadas((actuales) => new Set(actuales).add(etiqueta.uuid));
        }
      }
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        Alert.alert('No se pudo actualizar la etiqueta', error.message || 'Inténtalo nuevamente.');
      }
    } finally {
      isProcessingTagsRef.current = false;
      if (isMountedRef.current) setProcesandoEtiquetas(false);
    }
  }

  async function agregarEtiqueta() {
    const nombre = nuevaEtiqueta.trim();
    if (!nombre || isProcessingTagsRef.current) return;
    isProcessingTagsRef.current = true;
    setProcesandoEtiquetas(true);
    try {
      const etiqueta = await crearEtiqueta(nombre);
      await asignarEtiquetaALibro(libro.uuid, etiqueta.uuid);
      const todasLasEtiquetas = await obtenerEtiquetas();
      if (!isMountedRef.current) return;
      setEtiquetas(todasLasEtiquetas);
      setEtiquetasAsignadas((actuales) => new Set(actuales).add(etiqueta.uuid));
      setNuevaEtiqueta('');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        Alert.alert('No se pudo crear la etiqueta', error.message || 'Inténtalo nuevamente.');
      }
    } finally {
      isProcessingTagsRef.current = false;
      if (isMountedRef.current) setProcesandoEtiquetas(false);
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, Platform.OS === 'android' && { paddingBottom: 112 + keyboardHeight }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
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

        {!editando ? (
          <>
            <View style={styles.museumHeader}>
              <View style={styles.statusBadge}><View style={styles.statusDot} /><Text style={styles.statusText}>{libro.estado}</Text></View>
              <Text style={styles.museumTitle}>{libro.titulo}</Text>
              <Text style={styles.museumAuthor}>{libro.autor || 'Autor desconocido'}</Text>
            </View>
            <BookReadingCenter book={libro} onReload={cargarLibro} />
          </>
        ) : null}

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
              <Pressable key={estado} onPress={() => {
                cambiarCampo('estado', estado);
                if (estado === 'terminado' && !libro.fecha_fin) cambiarCampo('fecha_fin', fechaLocalISO());
              }} style={[styles.stateButton, libro.estado === estado && styles.stateButtonActive]}>
                <Text style={[styles.stateText, libro.estado === estado && styles.stateTextActive]}>{estado}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>PÁGINA ACTUAL</Text>
          <TextInput value={libro.pagina_actual} onFocus={mantenerInputVisible} onChangeText={(value) => cambiarCampo('pagina_actual', value.replace(/\D/g, ''))} style={styles.input} keyboardType="number-pad" />
          <Text style={styles.label}>FECHA DE INICIO (AAAA-MM-DD)</Text>
          <TextInput value={libro.fecha_inicio_lectura || ''} onFocus={mantenerInputVisible} onChangeText={(value) => cambiarCampo('fecha_inicio_lectura', value)} style={styles.input} placeholder="No registrada" placeholderTextColor={Theme.colors.textTertiary} />
          <Text style={styles.label}>FECHA DE FINALIZACIÓN (AAAA-MM-DD)</Text>
          <TextInput value={libro.fecha_fin || ''} onFocus={mantenerInputVisible} onChangeText={(value) => cambiarCampo('fecha_fin', value)} style={styles.input} placeholder="En lectura" placeholderTextColor={Theme.colors.textTertiary} />
          <Text style={styles.label}>NOTAS PERSONALES</Text>
          <TextInput value={libro.notas} onFocus={(event) => mantenerInputVisible(event, 150)} onChangeText={(value) => cambiarCampo('notas', value)} style={[styles.input, styles.notes]} multiline textAlignVertical="top" placeholder="Escribe aquí tu crónica…" placeholderTextColor={Theme.colors.textTertiary} />
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <Text style={styles.sectionTitle}>Etiquetas</Text>
          <Text style={styles.tagHelp}>Organiza este libro y úsalo después como filtro en la biblioteca.</Text>
          <View style={styles.tags}>
            {etiquetas.map((etiqueta) => {
              const asignada = etiquetasAsignadas.has(etiqueta.uuid);
              return (
                <Pressable
                  key={etiqueta.uuid}
                  onPress={() => alternarEtiqueta(etiqueta)}
                  disabled={procesandoEtiquetas}
                  style={[styles.tagChip, asignada && styles.tagChipActive]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: asignada, disabled: procesandoEtiquetas }}
                >
                  {asignada ? <Ionicons name="checkmark" size={15} color={Theme.colors.accentInteractive} /> : null}
                  <Text style={[styles.tagText, asignada && styles.tagTextActive]}>{etiqueta.nombre}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.newTagRow}>
            <TextInput
              value={nuevaEtiqueta}
              onChangeText={setNuevaEtiqueta}
              onFocus={mantenerInputVisible}
              onSubmitEditing={agregarEtiqueta}
              editable={!procesandoEtiquetas}
              returnKeyType="done"
              maxLength={40}
              style={[styles.input, styles.newTagInput]}
              placeholder="Nueva etiqueta"
              placeholderTextColor={Theme.colors.placeholder}
              accessibilityLabel="Nombre de la nueva etiqueta"
            />
            <Pressable
              onPress={agregarEtiqueta}
              disabled={!nuevaEtiqueta.trim() || procesandoEtiquetas}
              style={({ pressed }) => [
                styles.addTagButton,
                (!nuevaEtiqueta.trim() || procesandoEtiquetas) && styles.disabled,
                pressed && styles.addTagButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Crear y asignar etiqueta"
            >
              {procesandoEtiquetas
                ? <ActivityIndicator size="small" color={Theme.colors.textPrimary} />
                : <Ionicons name="add" size={22} color={Theme.colors.textPrimary} />}
            </Pressable>
          </View>
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
        </> : null}
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
  tagHelp: { marginBottom: Theme.spacing.md, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm },
  tagChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs, paddingHorizontal: Theme.spacing.md, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.pill, backgroundColor: Theme.colors.surface },
  tagChipActive: { borderColor: Theme.colors.accentStroke, backgroundColor: Theme.colors.accentGlow },
  tagText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.secondary },
  tagTextActive: { color: Theme.colors.textPrimary },
  newTagRow: { flexDirection: 'row', gap: Theme.spacing.sm, marginTop: Theme.spacing.lg },
  newTagInput: { flex: 1 },
  addTagButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.accentInteractive, borderRadius: Theme.radii.md },
  addTagButtonPressed: { backgroundColor: Theme.colors.accentPressed },
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

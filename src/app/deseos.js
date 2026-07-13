import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { addDeseo, deleteDeseo, getDeseos, marcarComoAdquirido } from '../database';
import { Theme } from '../constants/theme';
import { PremiumButton, PremiumCard } from '../components/PremiumUI';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';

const PRIORIDADES = ['alta', 'media', 'baja'];
const PRIORIDAD_COLOR = {
  alta: Theme.colors.accentBright,
  media: Theme.colors.textSecondary,
  baja: Theme.colors.textTertiary,
};
const FORMULARIO_VACIO = { titulo: '', autor: '', precio: '', prioridad: 'media' };

function formatearPrecio(precio) {
  if (precio === null || precio === undefined) return null;
  return `$ ${Number(precio).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

function DeseoRow({ deseo, ocupado, onAdquirir, onEliminar }) {
  return (
    <PremiumCard
      style={[styles.wishCard, { borderLeftColor: PRIORIDAD_COLOR[deseo.prioridad] }]}
      contentStyle={styles.wishCardContent}
    >
      <View style={styles.wishInfo}>
        <Text style={styles.wishTitle} numberOfLines={2}>{deseo.titulo}</Text>
        <Text style={styles.wishAuthor} numberOfLines={1}>{deseo.autor || 'Autor desconocido'}</Text>
        <View style={styles.metaRow}>
          <Text style={[styles.priority, { color: PRIORIDAD_COLOR[deseo.prioridad] }]}>
            PRIORIDAD {deseo.prioridad.toUpperCase()}
          </Text>
          {deseo.precio_estimado != null ? (
            <Text style={styles.price}>{formatearPrecio(deseo.precio_estimado)}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <PremiumButton
          style={styles.acquireButton}
          contentStyle={styles.acquireButtonContent}
          onPress={onAdquirir}
          disabled={ocupado}
        >
          <Ionicons name="checkmark" size={17} color={Theme.colors.textPrimary} />
          <Text style={styles.acquireText}>ADQUIRIDO</Text>
        </PremiumButton>
        <Pressable
          style={styles.deleteButton}
          onPress={onEliminar}
          disabled={ocupado}
          accessibilityLabel={`Eliminar ${deseo.titulo}`}
        >
          <Ionicons name="trash-outline" size={19} color={Theme.colors.textSecondary} />
        </Pressable>
      </View>
    </PremiumCard>
  );
}

export default function DeseosScreen() {
  const { scrollRef: modalScrollRef, keyboardHeight, onInputFocus, onScroll } = useKeyboardAwareScroll();
  const router = useRouter();
  const isMountedRef = useRef(false);
  const isProcessing = useRef(false);
  const [deseos, setDeseos] = useState([]);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [procesandoId, setProcesandoId] = useState(null);
  const [error, setError] = useState('');

  const cargarDeseos = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const resultado = await getDeseos();
      if (!isMountedRef.current) return;
      setDeseos(resultado);
      setError('');
    } catch (reason) {
      console.error(reason);
      if (isMountedRef.current) setError('No fue posible abrir la lista de deseos.');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let isMounted = true;
    isMountedRef.current = true;
    const cargarAlEnfocar = async () => {
      setLoading(true);
      try {
        const resultado = await getDeseos();
        if (!isMounted) return;
        setDeseos(resultado);
        setError('');
      } catch (reason) {
        console.error(reason);
        if (isMounted) setError('No fue posible abrir la lista de deseos.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    cargarAlEnfocar();
    return () => {
      isMounted = false;
      isMountedRef.current = false;
    };
  }, []));

  function cambiarCampo(campo, valor) {
    setFormulario((actual) => ({ ...actual, [campo]: valor }));
  }

  function cerrarFormulario() {
    if (saving) return;
    setModalVisible(false);
    setFormulario(FORMULARIO_VACIO);
  }

  async function guardarDeseo() {
    if (isProcessing.current) return;
    if (!formulario.titulo.trim()) {
      Alert.alert('Falta el título', 'Escribe el título del libro que estás buscando.');
      return;
    }
    const precioTexto = formulario.precio.trim().replace(',', '.');
    const precio = precioTexto === '' ? null : Number(precioTexto);
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      Alert.alert('Precio inválido', 'Ingresa un precio mayor o igual a cero.');
      return;
    }

    isProcessing.current = true;
    setSaving(true);
    try {
      await addDeseo({
        titulo: formulario.titulo,
        autor: formulario.autor,
        prioridad: formulario.prioridad,
        precio_estimado: precio,
      });
      if (isMountedRef.current) {
        setModalVisible(false);
        setFormulario(FORMULARIO_VACIO);
        await cargarDeseos();
      }
    } catch (reason) {
      console.error(reason);
      if (isMountedRef.current) Alert.alert('No se pudo agregar', reason.message || 'El deseo no pudo guardarse.');
    } finally {
      isProcessing.current = false;
      if (isMountedRef.current) setSaving(false);
    }
  }

  function confirmarAdquirido(deseo) {
    Alert.alert(
      'Libro adquirido',
      '¿Añadir a la biblioteca física?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Añadir',
          onPress: async () => {
            if (isProcessing.current) return;
            isProcessing.current = true;
            setProcesandoId(deseo.id);
            try {
              const libroId = await marcarComoAdquirido(deseo.id, deseo.titulo, deseo.autor);
              await Haptics
                .notificationAsync(Haptics.NotificationFeedbackType.Success)
                .catch(() => {});
              if (!isMountedRef.current) return;
              await cargarDeseos();
              if (!isMountedRef.current) return;
              Alert.alert('Añadido a la biblioteca', 'El libro ya figura como “quiero leer”.', [
                { text: 'Seguir en deseos' },
                { text: 'Abrir ficha', onPress: () => router.push(`/libro/${libroId}`) },
              ]);
            } catch (reason) {
              console.error(reason);
              if (isMountedRef.current) Alert.alert('No se pudo trasladar', reason.message || 'No se realizaron cambios.');
            } finally {
              isProcessing.current = false;
              if (isMountedRef.current) setProcesandoId(null);
            }
          },
        },
      ]
    );
  }

  function confirmarEliminacion(deseo) {
    Alert.alert('Eliminar deseo', `¿Quitar “${deseo.titulo}” de la lista?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (isProcessing.current) return;
          isProcessing.current = true;
          setProcesandoId(deseo.id);
          try {
            await deleteDeseo(deseo.id);
            await cargarDeseos();
          } catch (reason) {
            console.error(reason);
            if (isMountedRef.current) Alert.alert('No se pudo eliminar', 'El libro permanece en la lista.');
          } finally {
            isProcessing.current = false;
            if (isMountedRef.current) setProcesandoId(null);
          }
        },
      },
    ]);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Theme.colors.accentBright} /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerSubtitle}>{deseos.length} {deseos.length === 1 ? 'libro en la mira' : 'libros en la mira'}</Text>
        <PremiumButton style={styles.addButton} contentStyle={styles.addButtonContent} onPress={() => setModalVisible(true)}>
          <Ionicons name="add" size={21} color={Theme.colors.textPrimary} />
          <Text style={styles.addButtonText}>AGREGAR</Text>
        </PremiumButton>
      </View>

      <FlatList
        data={deseos}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <DeseoRow
            deseo={item}
            ocupado={procesandoId === item.id}
            onAdquirir={() => confirmarAdquirido(item)}
            onEliminar={() => confirmarEliminacion(item)}
          />
        )}
        contentContainerStyle={[styles.list, !deseos.length && styles.emptyList]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => cargarDeseos(true)}
            tintColor={Theme.colors.accentBright}
            colors={[Theme.colors.accent]}
          />
        )}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name={error ? 'warning-outline' : 'eye-outline'} size={54} color={Theme.colors.accent} />
            <Text style={styles.emptyTitle}>{error || 'Nada bajo vigilancia'}</Text>
            <Text style={styles.emptyText}>{error ? 'Desliza hacia abajo para reintentar.' : 'Agrega el próximo libro que quieras conseguir.'}</Text>
          </View>
        )}
      />

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={cerrarFormulario}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={modalScrollRef}
            contentContainerStyle={[styles.modalScroll, Platform.OS === 'android' && { paddingBottom: Theme.spacing.xxxl + keyboardHeight }]}
            onScroll={onScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          >
            <PremiumCard style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Agregar a la mira</Text>
                <Pressable style={styles.closeButton} onPress={cerrarFormulario} hitSlop={Theme.spacing.sm}>
                  <Ionicons name="close" size={24} color={Theme.colors.textSecondary} />
                </Pressable>
              </View>

              <Text style={styles.label}>TÍTULO *</Text>
              <TextInput value={formulario.titulo} onFocus={onInputFocus} onChangeText={(value) => cambiarCampo('titulo', value)} style={styles.input} placeholder="Título del libro" placeholderTextColor={Theme.colors.textTertiary} autoFocus />
              <Text style={styles.label}>AUTOR</Text>
              <TextInput value={formulario.autor} onFocus={onInputFocus} onChangeText={(value) => cambiarCampo('autor', value)} style={styles.input} placeholder="Autor" placeholderTextColor={Theme.colors.textTertiary} />
              <Text style={styles.label}>PRECIO ESTIMADO</Text>
              <TextInput value={formulario.precio} onFocus={onInputFocus} onChangeText={(value) => cambiarCampo('precio', value.replace(/[^0-9.,]/g, ''))} style={styles.input} placeholder="$ 0" placeholderTextColor={Theme.colors.textTertiary} keyboardType="decimal-pad" />
              <Text style={styles.label}>PRIORIDAD</Text>
              <View style={styles.prioritySelector}>
                {PRIORIDADES.map((prioridad) => {
                  const active = formulario.prioridad === prioridad;
                  return (
                    <Pressable key={prioridad} onPress={() => cambiarCampo('prioridad', prioridad)} style={[styles.priorityButton, active && styles.priorityButtonActive]}>
                      <View style={[styles.priorityDot, { backgroundColor: PRIORIDAD_COLOR[prioridad] }]} />
                      <Text style={[styles.priorityButtonText, active && styles.priorityButtonTextActive]}>{prioridad.toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <PremiumButton style={styles.submitButton} onPress={guardarDeseo} disabled={saving}>
                {saving ? <ActivityIndicator color={Theme.colors.textPrimary} /> : <Text style={styles.submitText}>AGREGAR A LA MIRA</Text>}
              </PremiumButton>
            </PremiumCard>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md, padding: Theme.spacing.lg, backgroundColor: Theme.colors.background, borderBottomWidth: 1, borderBottomColor: Theme.colors.stroke },
  headerSubtitle: { flex: 1, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  addButton: { minHeight: 44 },
  addButtonContent: { minHeight: 44, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  addButtonText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label },
  list: { padding: Theme.spacing.md, paddingBottom: Theme.spacing.xxxl },
  emptyList: { flexGrow: 1 },
  separator: { height: Theme.spacing.sm },
  wishCard: { minHeight: 120, padding: Theme.spacing.lg, borderLeftWidth: 4 },
  wishCardContent: { flex: 1 },
  wishInfo: { flex: 1, minWidth: 0, justifyContent: 'center' },
  wishTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorial, ...Theme.typography.cardTitle },
  wishAuthor: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Theme.spacing.sm, marginTop: Theme.spacing.md },
  priority: { fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label, fontSize: 9 },
  price: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.secondary },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: Theme.spacing.sm, marginTop: Theme.spacing.lg },
  acquireButton: { flex: 1, minHeight: 44 },
  acquireButtonContent: { minHeight: 44, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  acquireText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 9, letterSpacing: 0.3 },
  deleteButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.surfaceElevated, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Theme.spacing.xxxl },
  emptyTitle: { marginTop: Theme.spacing.lg, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.title, textAlign: 'center' },
  emptyText: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: Theme.colors.overlay },
  modalScroll: { flexGrow: 1, justifyContent: 'center', padding: Theme.spacing.xl, paddingVertical: Theme.spacing.xxxl },
  modalCard: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: Theme.spacing.xl, backgroundColor: Theme.colors.surfaceElevated, borderRadius: Theme.radii.xl, ...Theme.shadows.modal },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Theme.spacing.xs },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.title },
  label: { marginTop: Theme.spacing.md, marginBottom: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label },
  input: { minHeight: 48, paddingHorizontal: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.md },
  prioritySelector: { flexDirection: 'row', gap: Theme.spacing.sm },
  priorityButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Theme.spacing.xs, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.sm },
  priorityButtonActive: { backgroundColor: Theme.colors.surfacePressed, borderColor: Theme.colors.accentStroke },
  priorityDot: { width: 7, height: 7, borderRadius: Theme.radii.pill },
  priorityButtonText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, fontSize: 9 },
  priorityButtonTextActive: { color: Theme.colors.textPrimary },
  submitButton: { marginTop: Theme.spacing.xl },
  submitText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  disabled: { opacity: 0.55 },
});

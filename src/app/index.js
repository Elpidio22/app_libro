import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { buscarLibros, obtenerEtiquetas } from '../database';
import { Theme } from '../constants/theme';
import { PremiumCard } from '../components/PremiumUI';

const ORDENES = [
  { id: 'recientes', label: 'Recientes', icon: 'time-outline' },
  { id: 'titulo', label: 'Título A–Z', icon: 'text-outline' },
  { id: 'autor', label: 'Autor A–Z', icon: 'person-outline' },
  { id: 'progreso', label: 'Progreso', icon: 'trending-up-outline' },
];

function progresoDe(libro) {
  const total = Number(libro.paginas_totales) || 0;
  const actual = Math.max(Number(libro.pagina_actual) || 0, 0);
  return total > 0 ? Math.min(actual / total, 1) : 0;
}

function BookRow({ book, onPress }) {
  const [imageFailed, setImageFailed] = useState(false);
  const porcentaje = Math.round(progresoDe(book) * 100);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${book.titulo}`}
    >
      {({ pressed }) => (
        <PremiumCard
          style={[styles.rowCard, pressed && styles.rowCardPressed]}
          contentStyle={styles.rowContent}
        >
          {book.portada_url && !imageFailed ? (
            <Image
              source={{ uri: book.portada_url }}
              style={styles.cover}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <Ionicons name="book-outline" size={21} color={Theme.colors.textTertiary} />
            </View>
          )}

          <View style={styles.bookInfo}>
            <View style={styles.textRow}>
              <View style={styles.textColumn}>
                <Text style={styles.bookTitle} numberOfLines={1}>{book.titulo}</Text>
                <Text style={styles.author} numberOfLines={1}>{book.autor || 'Autor desconocido'}</Text>
              </View>
              <Text style={styles.percentage}>{porcentaje}%</Text>
              <Ionicons name="chevron-forward" size={16} color={Theme.colors.textTertiary} />
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${porcentaje}%` }]} />
            </View>
          </View>
        </PremiumCard>
      )}
    </Pressable>
  );
}

export default function Biblioteca() {
  const router = useRouter();
  const isMountedRef = useRef(false);
  const searchRequestRef = useRef(0);
  const [books, setBooks] = useState([]);
  const [etiquetas, setEtiquetas] = useState([]);
  const [etiquetaActiva, setEtiquetaActiva] = useState(null);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('recientes');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadBooks = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const resultado = await buscarLibros({ texto: query, etiquetaUuid: etiquetaActiva });
      if (!isMountedRef.current) return;
      setBooks(resultado);
      setError('');
    } catch (reason) {
      console.error(reason);
      if (isMountedRef.current) setError('No fue posible leer los libros guardados.');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [etiquetaActiva, query]);

  useFocusEffect(useCallback(() => {
    let isMounted = true;
    isMountedRef.current = true;
    const cargar = async () => {
      setLoading(true);
      try {
        const [resultado, etiquetasDisponibles] = await Promise.all([
          buscarLibros(),
          obtenerEtiquetas(),
        ]);
        if (!isMounted) return;
        setBooks(resultado);
        setEtiquetas(etiquetasDisponibles);
        setError('');
      } catch (reason) {
        console.error(reason);
        if (isMounted) setError('No fue posible leer los libros guardados.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    cargar();
    return () => {
      isMounted = false;
      isMountedRef.current = false;
    };
  }, []));

  useEffect(() => {
    if (!isMountedRef.current) return undefined;
    const requestId = ++searchRequestRef.current;
    const timer = setTimeout(async () => {
      try {
        const resultado = await buscarLibros({ texto: query, etiquetaUuid: etiquetaActiva });
        if (!isMountedRef.current || requestId !== searchRequestRef.current) return;
        setBooks(resultado);
        setError('');
      } catch (reason) {
        console.error(reason);
        if (isMountedRef.current && requestId === searchRequestRef.current) {
          setError('No fue posible buscar en la biblioteca.');
        }
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [etiquetaActiva, query]);

  const visibleBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      if (order === 'titulo') {
        return String(a.titulo).localeCompare(String(b.titulo), 'es', { sensitivity: 'base' });
      }
      if (order === 'autor') {
        return String(a.autor || '').localeCompare(String(b.autor || ''), 'es', { sensitivity: 'base' })
          || String(a.titulo).localeCompare(String(b.titulo), 'es', { sensitivity: 'base' });
      }
      if (order === 'progreso') {
        return progresoDe(b) - progresoDe(a)
          || (Number(b.pagina_actual) || 0) - (Number(a.pagina_actual) || 0);
      }
      return String(b.fecha_agregado || '').localeCompare(String(a.fecha_agregado || ''))
        || Number(b.id) - Number(a.id);
    });
  }, [books, order]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Theme.colors.accentBright} size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={19} color={Theme.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            placeholder="Buscar por título o autor"
            placeholderTextColor={Theme.colors.textTertiary}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={Theme.spacing.md} accessibilityLabel="Limpiar búsqueda">
              <Ionicons name="close-circle" size={19} color={Theme.colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagBar}
        >
          <Pressable
            style={({ pressed }) => [
              styles.tagChip,
              etiquetaActiva === null && styles.tagChipActive,
              pressed && styles.orderButtonPressed,
            ]}
            onPress={() => setEtiquetaActiva(null)}
          >
            <Text style={[styles.tagText, etiquetaActiva === null && styles.tagTextActive]}>Todos</Text>
          </Pressable>
          {etiquetas.map((etiqueta) => {
            const active = etiquetaActiva === etiqueta.uuid;
            return (
              <Pressable
                key={etiqueta.uuid}
                style={({ pressed }) => [styles.tagChip, active && styles.tagChipActive, pressed && styles.orderButtonPressed]}
                onPress={() => setEtiquetaActiva(etiqueta.uuid)}
              >
                <Text style={[styles.tagText, active && styles.tagTextActive]}>{etiqueta.nombre}</Text>
                <Text style={[styles.tagCount, active && styles.tagTextActive]}>{etiqueta.cantidad}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.orderBar}
        >
          {ORDENES.map((item) => {
            const active = order === item.id;
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.orderButton,
                  active && styles.orderButtonActive,
                  pressed && styles.orderButtonPressed,
                ]}
                onPress={() => setOrder(item.id)}
              >
                <Ionicons name={item.icon} size={14} color={active ? Theme.colors.textPrimary : Theme.colors.textSecondary} />
                <Text style={[styles.orderText, active && styles.orderTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.count}>
          {visibleBooks.length} {visibleBooks.length === 1 ? 'libro' : 'libros'}
        </Text>
      </View>

      <FlatList
        data={visibleBooks}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <BookRow book={item} onPress={() => router.push(`/libro/${item.id}`)} />}
        contentContainerStyle={[styles.list, !visibleBooks.length && styles.emptyList]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={9}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadBooks(true)}
            tintColor={Theme.colors.accentBright}
            colors={[Theme.colors.accent]}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons
              name={error ? 'warning-outline' : query || etiquetaActiva ? 'search-outline' : 'library-outline'}
              size={52}
              color={Theme.colors.accent}
            />
            <Text style={styles.emptyTitle}>{error || (query || etiquetaActiva ? 'No hay coincidencias' : 'Tu biblioteca está vacía')}</Text>
            <Text style={styles.emptyText}>
              {error
                ? 'Desliza hacia abajo para intentarlo nuevamente.'
                : query || etiquetaActiva
                  ? 'Prueba con otra búsqueda o etiqueta.'
                  : 'Agrega o escanea tu primer libro.'}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.background },
  controls: { paddingTop: Theme.spacing.md, backgroundColor: Theme.colors.background, borderBottomWidth: 1, borderBottomColor: Theme.colors.stroke },
  searchBox: { height: 44, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm, marginHorizontal: Theme.spacing.lg, paddingHorizontal: Theme.spacing.md, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.md },
  searchInput: { flex: 1, height: '100%', paddingVertical: 0, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  tagBar: { gap: Theme.spacing.sm, paddingHorizontal: Theme.spacing.lg, paddingTop: Theme.spacing.md },
  tagChip: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs, paddingHorizontal: Theme.spacing.md, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.pill },
  tagChipActive: { backgroundColor: Theme.colors.surfacePressed, borderColor: Theme.colors.accentStroke },
  tagText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.secondary },
  tagTextActive: { color: Theme.colors.accentInteractive },
  tagCount: { color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label },
  orderBar: { gap: Theme.spacing.sm, paddingHorizontal: Theme.spacing.lg, paddingVertical: Theme.spacing.md },
  orderButton: { height: 32, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs, paddingHorizontal: Theme.spacing.md, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.pill },
  orderButtonActive: { backgroundColor: Theme.colors.accent, borderColor: Theme.colors.accentStroke },
  orderButtonPressed: { backgroundColor: Theme.colors.surfacePressed },
  orderText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, letterSpacing: 0 },
  orderTextActive: { color: Theme.colors.textPrimary },
  count: { paddingHorizontal: Theme.spacing.lg, paddingBottom: Theme.spacing.sm, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, textTransform: 'uppercase' },
  list: { paddingHorizontal: Theme.spacing.lg, paddingVertical: Theme.spacing.md, paddingBottom: Theme.spacing.xxxl },
  emptyList: { flexGrow: 1 },
  rowCard: { minHeight: 80, padding: Theme.spacing.md },
  rowCardPressed: { backgroundColor: Theme.colors.surfacePressed, transform: [{ scale: 0.99 }] },
  rowContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  cover: { width: 44, height: 66, borderRadius: Theme.radii.sm, backgroundColor: Theme.colors.surfaceElevated },
  coverFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Theme.colors.stroke },
  bookInfo: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', marginLeft: Theme.spacing.md },
  textRow: { flexDirection: 'row', alignItems: 'center' },
  textColumn: { flex: 1, minWidth: 0 },
  bookTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorial, ...Theme.typography.cardTitle },
  author: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  percentage: { minWidth: 34, marginLeft: Theme.spacing.sm, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, textAlign: 'right' },
  progressTrack: { height: 2, overflow: 'hidden', marginTop: Theme.spacing.sm, backgroundColor: Theme.colors.surfaceElevated, borderRadius: Theme.radii.pill },
  progressFill: { height: '100%', backgroundColor: Theme.colors.accentBright },
  separator: { height: Theme.spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Theme.spacing.xxxl },
  emptyTitle: { marginTop: Theme.spacing.lg, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.title, textAlign: 'center' },
  emptyText: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
});

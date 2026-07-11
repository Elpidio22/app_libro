import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { obtenerCronicas } from '../database';
import { Theme } from '../constants/theme';
import { PremiumCard } from '../components/PremiumUI';

const EMPTY = { terminados: 0, paginas_acumuladas: 0, abandonados: 0 };

function formatearFecha(fecha) {
  if (!fecha) return 'fecha desconocida';
  const [year, month, day] = fecha.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function SmallMetric({ icon, value, label }) {
  return (
    <PremiumCard style={styles.smallMetric} contentStyle={styles.smallMetricContent}>
      <Ionicons name={icon} size={22} color={Theme.colors.accentBright} />
      <Text style={styles.smallMetricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </PremiumCard>
  );
}

export default function CronicasScreen() {
  const router = useRouter();
  const isMountedRef = useRef(false);
  const [metricas, setMetricas] = useState(EMPTY);
  const [historial, setHistorial] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await obtenerCronicas();
      if (!isMountedRef.current) return;
      setMetricas({ ...EMPTY, ...data.metricas });
      setHistorial(data.historial);
      setError('');
    } catch (reason) {
      console.error(reason);
      if (isMountedRef.current) setError('No se pudieron leer las crónicas.');
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
        const data = await obtenerCronicas();
        if (!isMounted) return;
        setMetricas({ ...EMPTY, ...data.metricas });
        setHistorial(data.historial);
        setError('');
      } catch (reason) {
        console.error(reason);
        if (isMounted) setError('No se pudieron leer las crónicas.');
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

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Theme.colors.accentBright} /></View>;
  }

  return (
    <FlatList
      data={historial}
      keyExtractor={(item) => String(item.id)}
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => cargar(true)}
          tintColor={Theme.colors.accentBright}
          colors={[Theme.colors.accent]}
        />
      )}
      ListHeaderComponent={(
        <>
          <Text style={styles.kicker}>BITÁCORA DE LECTURA</Text>

          <PremiumCard style={styles.featuredMetric} contentStyle={styles.featuredMetricContent}>
            <View style={styles.featuredIcon}>
              <Ionicons name="document-text-outline" size={24} color={Theme.colors.accentBright} />
            </View>
            <Text style={styles.featuredValue}>{metricas.paginas_acumuladas}</Text>
            <Text style={styles.featuredLabel}>Páginas acumuladas</Text>
            <View style={styles.featuredRule} />
          </PremiumCard>

          <View style={styles.smallMetricsRow}>
            <SmallMetric icon="checkmark-done-outline" value={metricas.terminados} label="Terminados" />
            <SmallMetric icon="close-circle-outline" value={metricas.abandonados} label="Abandonados" />
          </View>

          <Text style={styles.historyTitle}>Historial</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/libro/${item.id}`)}>
          {({ pressed }) => (
            <PremiumCard
              style={[styles.historyCard, pressed && styles.historyCardPressed]}
              contentStyle={styles.historyContent}
            >
              <View style={styles.timelineDot} />
              <Text style={styles.historyText}>
                Terminaste <Text style={styles.bookTitle}>{item.titulo}</Text> el {formatearFecha(item.fecha_fin)}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={Theme.colors.textTertiary} />
            </PremiumCard>
          )}
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={!error ? (
        <View style={styles.empty}>
          <Ionicons name="hourglass-outline" size={48} color={Theme.colors.accent} />
          <Text style={styles.emptyTitle}>Aún no hay finales escritos</Text>
          <Text style={styles.emptyText}>Los libros marcados como terminados aparecerán aquí.</Text>
        </View>
      ) : null}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.background },
  content: { flexGrow: 1, padding: Theme.spacing.lg, paddingBottom: Theme.spacing.xxxl, backgroundColor: Theme.colors.background },
  kicker: { marginTop: Theme.spacing.sm, marginBottom: Theme.spacing.xxl, color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label, letterSpacing: 2, textAlign: 'center' },
  featuredMetric: { padding: Theme.spacing.xxl, backgroundColor: Theme.colors.surfaceElevated, borderColor: Theme.colors.accentStroke },
  featuredMetricContent: { alignItems: 'center' },
  featuredIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: Theme.spacing.md, backgroundColor: Theme.colors.accentGlow, borderRadius: Theme.radii.pill },
  featuredValue: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.display, fontSize: 42, lineHeight: 48 },
  featuredLabel: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.body },
  featuredRule: { width: 40, height: 2, marginTop: Theme.spacing.lg, backgroundColor: Theme.colors.accent, borderRadius: Theme.radii.pill },
  smallMetricsRow: { flexDirection: 'row', gap: Theme.spacing.md, marginTop: Theme.spacing.md },
  smallMetric: { flex: 1, minHeight: 124, padding: Theme.spacing.lg },
  smallMetricContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  smallMetricValue: { marginTop: Theme.spacing.sm, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.title },
  metricLabel: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary, textAlign: 'center' },
  historyTitle: { marginTop: Theme.spacing.xxxl, marginBottom: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.title },
  historyCard: { minHeight: 72, padding: Theme.spacing.lg },
  historyCardPressed: { backgroundColor: Theme.colors.surfacePressed, transform: [{ scale: 0.99 }] },
  historyContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  timelineDot: { width: 8, height: 8, borderRadius: Theme.radii.pill, backgroundColor: Theme.colors.accentBright },
  historyText: { flex: 1, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  bookTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorial, ...Theme.typography.cardTitle },
  separator: { height: Theme.spacing.sm },
  empty: { alignItems: 'center', padding: Theme.spacing.xxxl, marginTop: Theme.spacing.lg },
  emptyTitle: { marginTop: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.section, textAlign: 'center' },
  emptyText: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
  error: { marginBottom: Theme.spacing.md, color: Theme.colors.danger, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
});

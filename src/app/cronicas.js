import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { obtenerDashboardAnalitico } from '../database/analyticsRepository';
import { getDatabaseRevisions } from '../database/revisions';
import { Theme } from '../constants/theme';
import { PremiumCard } from '../components/PremiumUI';
import MetricCard from '../components/analytics/MetricCard';
import MonthlyActivityChart from '../components/analytics/MonthlyActivityChart';
import ActivityHeatmap from '../components/analytics/ActivityHeatmap';
import TagActivityChart from '../components/analytics/TagActivityChart';
import ReadingEstimateCard from '../components/analytics/ReadingEstimateCard';
import WishlistConversionCard from '../components/analytics/WishlistConversionCard';
import MonthlyNarrative from '../components/analytics/MonthlyNarrative';
import {
  formatComparison,
  formatDuration,
  number,
  revisionsKey,
} from '../components/analytics/formatters';

const SECTIONS = ['monthly', 'heatmap', 'tags', 'estimate', 'wishlist', 'narrative'];
let dashboardScreenCache = null;

export function __resetCronicasCacheForTests() {
  dashboardScreenCache = null;
}

function latestMonths(data = []) {
  const months = data.slice(-2);
  return {
    previous: months.length > 1 ? months[0] : {},
    current: months[months.length - 1] || {},
  };
}

function DashboardSkeleton() {
  return (
    <View testID="dashboard-skeleton" style={styles.skeletonScreen}>
      <View style={[styles.skeleton, styles.skeletonTitle]} />
      <View style={[styles.skeleton, styles.skeletonSubtitle]} />
      <View style={styles.metricsGrid}>
        {[0, 1, 2, 3].map((item) => <View key={item} style={[styles.skeleton, styles.skeletonCard]} />)}
      </View>
      <View style={[styles.skeleton, styles.skeletonChart]} />
    </View>
  );
}

function ErrorState({ onRetry }) {
  return (
    <View testID="dashboard-error" style={styles.center}>
      <Ionicons name="cloud-offline-outline" size={48} color={Theme.colors.danger} />
      <Text style={styles.errorTitle}>Las crónicas no pudieron abrirse</Text>
      <Text style={styles.errorText}>No se pudieron consultar tus datos. Tu biblioteca permanece intacta.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>REINTENTAR</Text>
      </Pressable>
    </View>
  );
}

function DashboardHeader({ data, updating, warning }) {
  const summary = data?.resumen || {};
  const velocity = data?.velocidad || {};
  const { current, previous } = latestMonths(data?.tendenciaMensual);
  return (
    <View>
      <Text style={styles.title}>Crónicas</Text>
      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>Tu actividad de lectura</Text>
        {updating ? <Text accessibilityLiveRegion="polite" style={styles.updating}>ACTUALIZANDO</Text> : null}
      </View>
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}
      {!number(summary.sesiones) ? (
        <PremiumCard style={styles.emptyBanner}>
          <Text style={styles.emptyBannerTitle}>Tu historia empieza con una sesión</Text>
          <Text style={styles.emptyBannerText}>Inicia una sesión desde la ficha de un libro para activar las métricas.</Text>
        </PremiumCard>
      ) : null}
      <View style={styles.metricsGrid}>
        <View style={styles.metricRow}>
          <MetricCard
            testID="metric-pages"
            icon="document-text-outline"
            label="Páginas este mes"
            value={number(summary.paginas)}
            detail={formatComparison(current.paginas, previous.paginas)}
          />
          <MetricCard
            testID="metric-time"
            icon="time-outline"
            label="Tiempo leído"
            value={formatDuration(summary.duracion_segundos)}
            detail={formatComparison(current.duracion_segundos, previous.duracion_segundos)}
          />
        </View>
        <View style={styles.metricRow}>
          <MetricCard
            testID="metric-days"
            icon="calendar-outline"
            label="Días activos"
            value={number(summary.dias_activos)}
            detail={formatComparison(current.dias_activos, previous.dias_activos)}
          />
          <MetricCard
            testID="metric-speed"
            icon="speedometer-outline"
            label="Velocidad estimada"
            value={velocity.muestraSuficiente ? `${Math.round(number(velocity.paginasPorHora))} pág/h` : '—'}
            detail={velocity.muestraSuficiente ? `${number(velocity.sesiones_consideradas)} sesiones válidas` : 'Muestra insuficiente'}
          />
        </View>
      </View>
    </View>
  );
}

export default function CronicasScreen() {
  const initialCache = dashboardScreenCache?.data || null;
  const [data, setData] = useState(initialCache);
  const dataRef = useRef(initialCache);
  const [initialLoading, setInitialLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(false);
  const requestGeneration = useRef(0);

  const loadDashboard = useCallback(async ({ force = false } = {}) => {
    const generation = ++requestGeneration.current;
    const hasData = Boolean(dataRef.current);
    if (force) setRefreshing(true);
    else if (hasData) setUpdating(true);
    else setInitialLoading(true);
    try {
      const nextData = await obtenerDashboardAnalitico({ force });
      if (!mountedRef.current || generation !== requestGeneration.current) return;
      const stableData = nextData || {};
      dataRef.current = stableData;
      setData(stableData);
      setError('');
      dashboardScreenCache = {
        data: stableData,
        revisions: revisionsKey(stableData?._meta?.revisions || getDatabaseRevisions()),
      };
    } catch (reason) {
      console.error('No se pudo cargar el dashboard analítico.', reason);
      if (!mountedRef.current || generation !== requestGeneration.current) return;
      setError('No se pudieron actualizar las crónicas.');
    } finally {
      if (mountedRef.current && generation === requestGeneration.current) {
        setInitialLoading(false);
        setRefreshing(false);
        setUpdating(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    mountedRef.current = true;
    const currentRevisions = revisionsKey(getDatabaseRevisions());
    const cacheIsStale = dashboardScreenCache?.revisions !== currentRevisions;
    loadDashboard({ force: cacheIsStale });
    return () => {
      mountedRef.current = false;
      requestGeneration.current += 1;
    };
  }, [loadDashboard]));

  const renderSection = useCallback(({ item }) => {
    if (item === 'monthly') return <MonthlyActivityChart data={data?.tendenciaMensual} />;
    if (item === 'heatmap') return <ActivityHeatmap data={data?.actividadDiaria} />;
    if (item === 'tags') return <TagActivityChart data={data?.etiquetas} attribution={data?._meta?.etiquetas_atribucion} />;
    if (item === 'estimate') return <ReadingEstimateCard velocity={data?.velocidad} />;
    if (item === 'wishlist') return <WishlistConversionCard data={data?.wishlist} />;
    return <MonthlyNarrative data={data} />;
  }, [data]);

  if (initialLoading && !data) return <DashboardSkeleton />;
  if (error && !data) return <ErrorState onRetry={() => loadDashboard({ force: true })} />;

  return (
    <FlatList
      testID="cronicas-dashboard"
      data={SECTIONS}
      keyExtractor={(item) => item}
      renderItem={renderSection}
      style={styles.screen}
      contentContainerStyle={styles.content}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={4}
      removeClippedSubviews
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={<DashboardHeader data={data} updating={updating} warning={error} />}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadDashboard({ force: true })}
          tintColor={Theme.colors.accentBright}
          colors={[Theme.colors.accentInteractive]}
          progressBackgroundColor={Theme.colors.surfaceElevated}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background },
  content: { padding: Theme.spacing.lg, paddingBottom: Theme.spacing.xxxl * 2 },
  title: { marginTop: Theme.spacing.sm, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 34, lineHeight: 40 },
  subtitleRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Theme.spacing.sm },
  subtitle: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  updating: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 9, letterSpacing: 1 },
  warning: { padding: Theme.spacing.md, marginTop: Theme.spacing.md, color: Theme.colors.warning, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary, backgroundColor: Theme.colors.surfacePressed, borderRadius: Theme.radii.md },
  emptyBanner: { marginTop: Theme.spacing.xl, backgroundColor: Theme.colors.surfaceElevated },
  emptyBannerTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  emptyBannerText: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  metricsGrid: { gap: Theme.spacing.md, marginTop: Theme.spacing.xl, marginBottom: Theme.spacing.xxl },
  metricRow: { flexDirection: 'row', gap: Theme.spacing.md },
  separator: { height: Theme.spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Theme.spacing.xxxl, backgroundColor: Theme.colors.background },
  errorTitle: { marginTop: Theme.spacing.lg, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.section, textAlign: 'center' },
  errorText: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
  retryButton: { minWidth: 160, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: Theme.spacing.xl, backgroundColor: Theme.colors.accent, borderRadius: Theme.radii.md },
  retryText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  skeletonScreen: { flex: 1, padding: Theme.spacing.lg, backgroundColor: Theme.colors.background },
  skeleton: { backgroundColor: Theme.colors.surfaceElevated, borderRadius: Theme.radii.md, borderWidth: 1, borderColor: Theme.colors.stroke },
  skeletonTitle: { width: 180, height: 40, marginTop: Theme.spacing.sm },
  skeletonSubtitle: { width: 220, height: 18, marginTop: Theme.spacing.sm },
  skeletonCard: { flex: 1, minWidth: 142, height: 154 },
  skeletonChart: { height: 260, marginTop: Theme.spacing.sm },
});

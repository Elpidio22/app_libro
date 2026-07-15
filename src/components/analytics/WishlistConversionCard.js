import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PremiumCard } from '../PremiumUI';
import { Theme } from '../../constants/theme';
import { formatDuration, formatPercent, number } from './formatters';

function WishlistConversionCard({ data = {} }) {
  const safeData = data && typeof data === 'object' ? data : {};
  return (
    <PremiumCard testID="wishlist-conversion" style={styles.card}>
      <Text style={styles.title}>La cacería</Text>
      <Text style={styles.subtitle}>Conversión de tu lista de deseos</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.value}>{number(safeData.activos)}</Text><Text style={styles.label}>Activos</Text></View>
        <View style={styles.divider} />
        <View style={styles.metric}><Text style={styles.value}>{number(safeData.adquiridos)}</Text><Text style={styles.label}>Adquiridos</Text></View>
        <View style={styles.divider} />
        <View style={styles.metric}><Text style={styles.value}>{number(safeData.descartados)}</Text><Text style={styles.label}>Descartados</Text></View>
        <View style={styles.divider} />
        <View style={styles.metric}><Text style={styles.value}>{formatPercent(safeData.tasa_adquisicion)}</Text><Text style={styles.label}>Tasa</Text></View>
      </View>
      {safeData.segundos_promedio_hasta_adquirir != null ? (
        <Text style={styles.detail}>Tiempo medio hasta adquirir: {formatDuration(safeData.segundos_promedio_hasta_adquirir)}</Text>
      ) : <Text style={styles.detail}>Todavía no hay tiempo medio disponible.</Text>}
    </PremiumCard>
  );
}

export default memo(WishlistConversionCard);

const styles = StyleSheet.create({
  card: { backgroundColor: Theme.colors.surfaceElevated },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.section },
  subtitle: { marginTop: Theme.spacing.xs, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  metrics: { flexDirection: 'row', alignItems: 'center', marginTop: Theme.spacing.xl },
  metric: { flex: 1, alignItems: 'center' },
  value: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.title },
  label: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  divider: { width: 1, height: 40, backgroundColor: Theme.colors.strokeStrong },
  detail: { marginTop: Theme.spacing.xl, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary, textAlign: 'center' },
});

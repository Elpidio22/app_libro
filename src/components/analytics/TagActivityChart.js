import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PremiumCard } from '../PremiumUI';
import { Theme } from '../../constants/theme';
import { number } from './formatters';

function TagActivityChart({ data = [], attribution }) {
  const rows = (Array.isArray(data) ? data : []).filter(Boolean).slice(0, 5);
  const max = Math.max(1, ...rows.map((item) => number(item.paginas)));
  return (
    <PremiumCard testID="tag-activity" style={styles.card}>
      <Text style={styles.title}>Actividad asociada a etiquetas</Text>
      <Text style={styles.subtitle}>Una sesión puede aportar a más de una etiqueta</Text>
      {rows.length ? rows.map((item) => (
        <View key={item.uuid || item.nombre} style={styles.row}>
          <View style={styles.rowHeading}>
            <Text numberOfLines={1} style={styles.name}>{item.nombre || 'Sin nombre'}</Text>
            <Text style={styles.value}>{number(item.paginas)} pág.</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${Math.max(3, (number(item.paginas) / max) * 100)}%` }]} />
          </View>
        </View>
      )) : <Text style={styles.empty}>Asigna etiquetas a tus libros para descubrir patrones.</Text>}
      {rows.length ? <Text style={styles.note}>{attribution || 'Los valores no representan partes de un total exclusivo.'}</Text> : null}
    </PremiumCard>
  );
}

export default memo(TagActivityChart);

const styles = StyleSheet.create({
  card: { backgroundColor: Theme.colors.surfaceElevated },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.section },
  subtitle: { marginTop: Theme.spacing.xs, marginBottom: Theme.spacing.lg, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  row: { marginTop: Theme.spacing.md },
  rowHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Theme.spacing.md },
  name: { flex: 1, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.body },
  value: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.secondary },
  track: { height: 8, marginTop: Theme.spacing.sm, overflow: 'hidden', backgroundColor: Theme.colors.surface, borderRadius: Theme.radii.pill },
  bar: { height: '100%', backgroundColor: Theme.colors.accentInteractive, borderRadius: Theme.radii.pill },
  note: { marginTop: Theme.spacing.xl, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, fontSize: 10, lineHeight: 15 },
  empty: { paddingVertical: Theme.spacing.xxl, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
});

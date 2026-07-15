import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumCard } from '../PremiumUI';
import { Theme } from '../../constants/theme';
import { formatDuration, number } from './formatters';

function ReadingEstimateCard({ velocity = {} }) {
  const safeVelocity = velocity && typeof velocity === 'object' ? velocity : {};
  const estimate = safeVelocity.muestraSuficiente ? safeVelocity.estimaciones_restantes?.[0] : null;
  return (
    <PremiumCard testID="reading-estimate" style={styles.card}>
      <View style={styles.icon}><Ionicons name="hourglass-outline" size={22} color={Theme.colors.accentBright} /></View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>PRÓXIMA META</Text>
        {estimate ? (
          <>
            <Text style={styles.title}>{estimate.titulo || 'Libro actual'}</Text>
            <Text style={styles.value}>Te quedan aproximadamente {formatDuration(estimate.segundos_estimados)}</Text>
            <Text style={styles.detail}>Estimación basada en {number(safeVelocity.sesiones_consideradas)} sesiones · {number(estimate.paginas_restantes)} páginas restantes</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Aún estamos aprendiendo tu ritmo</Text>
            <Text style={styles.detail}>Completa al menos dos sesiones con duración y avance para obtener una estimación fiable.</Text>
          </>
        )}
      </View>
    </PremiumCard>
  );
}

export default memo(ReadingEstimateCard);

const styles = StyleSheet.create({
  card: { backgroundColor: Theme.colors.surfaceElevated, borderColor: Theme.colors.accentStroke },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: Theme.spacing.md, backgroundColor: Theme.colors.accentGlow, borderRadius: Theme.radii.pill },
  copy: { gap: Theme.spacing.xs },
  eyebrow: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.section },
  value: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.body },
  detail: { marginTop: Theme.spacing.sm, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
});

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumCard } from '../PremiumUI';
import { Theme } from '../../constants/theme';

function MetricCard({ icon, label, value, detail, testID }) {
  return (
    <PremiumCard testID={testID} style={styles.card} contentStyle={styles.content}>
      <View style={styles.icon}>
        <Ionicons name={icon} size={19} color={Theme.colors.accentBright} />
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      <Text numberOfLines={2} style={styles.detail}>{detail}</Text>
    </PremiumCard>
  );
}

export default memo(MetricCard);

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 142, minHeight: 154, padding: Theme.spacing.lg, backgroundColor: Theme.colors.surfaceElevated },
  content: { flex: 1 },
  icon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.accentGlow, borderRadius: Theme.radii.pill },
  value: { marginTop: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 25, lineHeight: 30 },
  label: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.secondary },
  detail: { marginTop: 'auto', paddingTop: Theme.spacing.sm, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, fontSize: 10, lineHeight: 14 },
});

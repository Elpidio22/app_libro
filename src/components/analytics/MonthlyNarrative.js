import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PremiumCard } from '../PremiumUI';
import { Theme } from '../../constants/theme';
import { buildMonthlyNarrative } from './formatters';

function MonthlyNarrative({ data }) {
  return (
    <PremiumCard testID="monthly-narrative" style={styles.card}>
      <View style={styles.heading}>
        <Ionicons name="sparkles-outline" size={20} color={Theme.colors.accentBright} />
        <Text style={styles.title}>Tu mes, en palabras</Text>
      </View>
      <Text style={styles.body}>{buildMonthlyNarrative(data)}</Text>
    </PremiumCard>
  );
}

export default memo(MonthlyNarrative);

const styles = StyleSheet.create({
  card: { backgroundColor: Theme.colors.surfacePressed, borderColor: Theme.colors.accentStroke },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  body: { marginTop: Theme.spacing.md, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, fontSize: 15, lineHeight: 23 },
});

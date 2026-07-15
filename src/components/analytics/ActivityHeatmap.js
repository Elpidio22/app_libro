import { memo, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { PremiumCard } from '../PremiumUI';
import { Theme } from '../../constants/theme';
import { number } from './formatters';

const DAYS = 26 * 7;

function localDate(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function buildDays(data) {
  const byDate = new Map(data.map((item) => [item.fecha, number(item.paginas)]));
  const end = new Date(`${localDate()}T12:00:00`);
  return Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (DAYS - index - 1));
    const key = localDate(date);
    return { date: key, pages: byDate.get(key) || 0 };
  });
}

function ActivityHeatmap({ data = [] }) {
  const days = useMemo(() => buildDays(data), [data]);
  const max = Math.max(1, ...days.map((day) => day.pages));
  const weeks = useMemo(() => Array.from({ length: 26 }, (_, index) => days.slice(index * 7, (index + 1) * 7)), [days]);

  return (
    <PremiumCard testID="activity-heatmap" style={styles.card}>
      <Text style={styles.title}>Mapa de actividad</Text>
      <Text style={styles.subtitle}>Cada cuadro representa un día de los últimos seis meses</Text>
      <FlatList
        horizontal
        data={weeks}
        keyExtractor={(_, index) => String(index)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.grid}
        initialNumToRender={12}
        windowSize={5}
        renderItem={({ item: week }) => (
          <View style={styles.week}>
            {week.map((day) => {
              const level = day.pages <= 0 ? 0 : Math.min(4, Math.ceil((day.pages / max) * 4));
              return (
                <Pressable
                  key={day.date}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.date}: ${day.pages} ${day.pages === 1 ? 'página' : 'páginas'}`}
                  style={[styles.day, styles[`level${level}`]]}
                />
              );
            })}
          </View>
        )}
      />
      <View style={styles.legend}>
        <Text style={styles.legendText}>Menor</Text>
        {[0, 1, 2, 3, 4].map((level) => <View key={level} style={[styles.legendDay, styles[`level${level}`]]} />)}
        <Text style={styles.legendText}>Mayor</Text>
      </View>
    </PremiumCard>
  );
}

export default memo(ActivityHeatmap);

const styles = StyleSheet.create({
  card: { backgroundColor: Theme.colors.surfaceElevated },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.section },
  subtitle: { marginTop: Theme.spacing.xs, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  grid: { gap: 4, paddingVertical: Theme.spacing.xl },
  week: { gap: 4 },
  day: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: Theme.colors.stroke },
  level0: { backgroundColor: Theme.colors.surface },
  level1: { backgroundColor: 'rgba(184,144,91,0.22)' },
  level2: { backgroundColor: 'rgba(184,144,91,0.42)' },
  level3: { backgroundColor: 'rgba(194,163,120,0.68)' },
  level4: { backgroundColor: Theme.colors.accentInteractive },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  legendDay: { width: 12, height: 12, borderRadius: 3 },
  legendText: { color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, fontSize: 10 },
});

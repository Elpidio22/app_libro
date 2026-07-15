import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { PremiumCard } from '../PremiumUI';
import { Theme } from '../../constants/theme';
import { formatDuration, formatMonth, number } from './formatters';

function MonthlyActivityChart({ data = [] }) {
  const [metric, setMetric] = useState('pages');
  const chartData = useMemo(() => data.slice(-6).map((item, index) => ({
    index,
    month: item.mes,
    pages: number(item.paginas),
    time: number(item.duracion_segundos),
  })), [data]);
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, chartData.length - 1));
  const selected = chartData[Math.min(selectedIndex, Math.max(0, chartData.length - 1))];
  const hasData = chartData.some((item) => item[metric] > 0);
  const bars = useMemo(() => {
    const maxValue = Math.max(1, ...chartData.map((item) => item[metric]));
    const slotWidth = 600 / Math.max(1, chartData.length);
    return chartData.map((item, index) => {
      const height = Math.max(item[metric] > 0 ? 4 : 0, (item[metric] / maxValue) * 142);
      return {
        height,
        width: Math.min(58, slotWidth * 0.58),
        x: (index * slotWidth) + (slotWidth * 0.21),
        y: 158 - height,
      };
    });
  }, [chartData, metric]);

  return (
    <PremiumCard testID="monthly-activity" style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Actividad mensual</Text>
          <Text style={styles.subtitle}>Tus últimos seis meses</Text>
        </View>
        <View style={styles.selector}>
          {[
            ['pages', 'Páginas'],
            ['time', 'Tiempo'],
          ].map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: metric === key }}
              onPress={() => setMetric(key)}
              style={[styles.selectorButton, metric === key && styles.selectorButtonActive]}
            >
              <Text style={[styles.selectorText, metric === key && styles.selectorTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {hasData ? (
        <>
          <View accessible accessibilityLabel="Gráfico de actividad mensual" style={styles.chart}>
            <Svg testID="monthly-svg-chart" width="100%" height="100%" viewBox="0 0 600 170">
              {[16, 63, 110, 158].map((y) => (
                <Line
                  key={y}
                  x1="0"
                  x2="600"
                  y1={y}
                  y2={y}
                  stroke={Theme.colors.stroke}
                  strokeWidth="1"
                />
              ))}
              {bars.map((bar, index) => (
                <Rect
                  key={chartData[index]?.month || index}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx="6"
                  fill={index === selectedIndex ? Theme.colors.accentInteractive : Theme.colors.accent}
                  opacity={index === selectedIndex ? 1 : 0.68}
                />
              ))}
            </Svg>
          </View>
          <View style={styles.months}>
            {chartData.map((item, index) => (
              <Pressable
                key={item.month || index}
                accessibilityRole="button"
                accessibilityLabel={`${formatMonth(item.month)}, ${metric === 'pages' ? `${item.pages} páginas` : formatDuration(item.time)}`}
                onPress={() => setSelectedIndex(index)}
                style={styles.monthButton}
              >
                <Text style={[styles.month, index === selectedIndex && styles.monthActive]}>{formatMonth(item.month)}</Text>
              </Pressable>
            ))}
          </View>
          {selected ? (
            <View testID="monthly-tooltip" style={styles.tooltip}>
              <Text style={styles.tooltipMonth}>{formatMonth(selected.month)}</Text>
              <Text style={styles.tooltipValue}>{metric === 'pages' ? `${selected.pages} páginas` : formatDuration(selected.time)}</Text>
            </View>
          ) : null}
        </>
      ) : <Text style={styles.empty}>Todavía no hay actividad mensual para representar.</Text>}
    </PremiumCard>
  );
}

export default memo(MonthlyActivityChart);

const styles = StyleSheet.create({
  card: { backgroundColor: Theme.colors.surfaceElevated },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: Theme.spacing.md },
  headingCopy: { flex: 1 },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.section },
  subtitle: { marginTop: Theme.spacing.xs, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  selector: { flexDirection: 'row', padding: 3, backgroundColor: Theme.colors.surface, borderRadius: Theme.radii.md },
  selectorButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: Theme.spacing.sm, borderRadius: Theme.radii.sm },
  selectorButtonActive: { backgroundColor: Theme.colors.surfacePressed },
  selectorText: { color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interfaceMedium, fontSize: 10 },
  selectorTextActive: { color: Theme.colors.accentBright },
  chart: { height: 190, marginTop: Theme.spacing.xl },
  months: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Theme.spacing.sm },
  monthButton: { minWidth: 38, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  month: { color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, fontSize: 10, textTransform: 'uppercase' },
  monthActive: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold },
  tooltip: { flexDirection: 'row', justifyContent: 'space-between', padding: Theme.spacing.md, marginTop: Theme.spacing.sm, backgroundColor: Theme.colors.surface, borderRadius: Theme.radii.md },
  tooltipMonth: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.secondary, textTransform: 'capitalize' },
  tooltipValue: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.secondary },
  empty: { paddingVertical: Theme.spacing.xxxl, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
});

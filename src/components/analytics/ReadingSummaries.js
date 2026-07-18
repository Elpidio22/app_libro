import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../../constants/theme';
import { PremiumCard } from '../PremiumUI';
import { formatDuration } from './formatters';

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function valueOrDash(value, formatter = String) {
  return value === null || value === undefined ? '—' : formatter(value);
}

function Cover({ uri, large = false }) {
  const style = large ? styles.coverLarge : styles.cover;
  if (uri) return <Image source={{ uri }} style={style} resizeMode="cover" />;
  return (
    <View style={[style, styles.coverFallback]}>
      <Ionicons name="book-outline" size={large ? 42 : 26} color={Theme.colors.textTertiary} />
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SummaryCard({ item, onPress }) {
  const activity = item.actividad;
  return (
    <Pressable
      testID={`reading-summary-${item.uuid}`}
      accessibilityRole="button"
      accessibilityLabel={`Abrir resumen de ${item.titulo}`}
      onPress={onPress}
    >
      <PremiumCard style={styles.card}>
        <View style={styles.cardRow}>
          <Cover uri={item.portada_url} />
          <View style={styles.cardBody}>
            <Text numberOfLines={2} style={styles.cardTitle}>{item.titulo}</Text>
            <Text numberOfLines={1} style={styles.cardAuthor}>{item.autor || 'Autor no registrado'}</Text>
            <Text style={styles.finishDate}>
              {formatDate(item.fecha_fin) ? `Finalizado · ${formatDate(item.fecha_fin)}` : 'Fecha de finalización no registrada'}
            </Text>
            {activity ? (
              <View style={styles.compactMetrics}>
                <Text style={styles.compactMetric}>{activity.sesiones} ses.</Text>
                <Text style={styles.compactMetric}>{formatDuration(activity.duracion_segundos)}</Text>
                <Text style={styles.compactMetric}>{activity.paginas_registradas} pág.</Text>
              </View>
            ) : (
              <Text style={styles.noData}>Sin sesiones registradas</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color={Theme.colors.textTertiary} />
        </View>
      </PremiumCard>
    </Pressable>
  );
}

function Detail({ item, onClose }) {
  const router = useRouter();
  const activity = item.actividad;
  const firstDate = formatDate(activity?.primera_sesion);
  const lastDate = formatDate(activity?.ultima_sesion);
  const finishDate = formatDate(item.fecha_fin);
  const coverage = activity?.cobertura_sesiones;

  function openBook() {
    onClose();
    router.push(`/libro/${item.id}`);
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.eyebrow}>CRÓNICAS</Text>
            <Text style={styles.modalTitle}>Resumen de lectura</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar resumen" onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={Theme.colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.identity}>
          <Cover uri={item.portada_url} large />
          <View style={styles.identityText}>
            <Text style={styles.bookTitle}>{item.titulo}</Text>
            <Text style={styles.bookAuthor}>{item.autor || 'Autor no registrado'}</Text>
            {item.isbn ? <Text style={styles.meta}>ISBN {item.isbn}</Text> : null}
            <Text style={styles.meta}>{item.paginas_totales ? `${item.paginas_totales} páginas` : 'Extensión no registrada'}</Text>
            <Text style={styles.meta}>{item.calificacion ? `${item.calificacion} de 5 estrellas` : 'Calificación no registrada'}</Text>
          </View>
        </View>

        <PremiumCard style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Período registrado</Text>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Primera sesión registrada</Text><Text style={styles.detailValue}>{firstDate || 'No registrada'}</Text></View>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Última sesión registrada</Text><Text style={styles.detailValue}>{lastDate || 'No registrada'}</Text></View>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Fecha de finalización</Text><Text style={styles.detailValue}>{finishDate || 'No registrada'}</Text></View>
          <Text style={styles.explanation}>Los días calendario abarcan desde la primera hasta la última sesión registrada, incluyendo ambos días.</Text>
        </PremiumCard>

        {activity ? (
          <>
            <PremiumCard style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Actividad registrada</Text>
              <View style={styles.statsGrid}>
                <Stat label="Sesiones" value={activity.sesiones} />
                <Stat label="Tiempo" value={formatDuration(activity.duracion_segundos)} />
                <Stat label="Páginas" value={activity.paginas_registradas} />
                <Stat label="Días calendario" value={activity.dias_calendario} />
                <Stat label="Pág. por sesión" value={Math.round(activity.paginas_promedio_sesion)} />
                <Stat label="Min. por sesión" value={Math.round(activity.minutos_promedio_sesion)} />
                <Stat label="Páginas por hora" value={Math.round(activity.velocidad_paginas_hora)} />
                <Stat label="Días activos" value={activity.dias_activos} />
              </View>
              <Text style={styles.explanation}>
                Se registraron {activity.paginas_registradas} páginas mediante sesiones{item.paginas_totales ? ` de un libro de ${item.paginas_totales} páginas` : ''}.
              </Text>
              {coverage !== null ? (
                <Text style={styles.explanation}>Cobertura aproximada por sesiones: {Math.round(coverage * 100)}%{activity.cobertura_parcial ? ' · registro parcial' : ''}.</Text>
              ) : null}
              {activity.sesiones_excluidas ? <Text style={styles.excluded}>{activity.sesiones_excluidas} sesión(es) abierta(s) o anómala(s) no fueron incluidas.</Text> : null}
            </PremiumCard>

            <PremiumCard style={styles.detailCard}>
              <Text style={styles.sectionTitle}>Regularidad</Text>
              <View style={styles.statsGrid}>
                <Stat label="Racha máxima" value={`${activity.racha_maxima} días`} />
                <Stat label="Regularidad" value={valueOrDash(activity.regularidad, (value) => `${Math.round(value * 100)}%`)} />
              </View>
              <Text style={styles.explanation}>Leíste en {activity.dias_activos} de los {activity.dias_calendario} días registrados.</Text>
            </PremiumCard>
          </>
        ) : (
          <PremiumCard style={styles.detailCard}>
            <Text style={styles.sectionTitle}>Actividad registrada</Text>
            <Text style={styles.emptyText}>Este libro no tiene sesiones de lectura registradas.</Text>
            <Text style={styles.explanation}>Tiempo, velocidad y regularidad: Sin datos.</Text>
          </PremiumCard>
        )}

        <PremiumCard style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Reflexión</Text>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Estado final</Text><Text style={styles.detailValue}>Terminado</Text></View>
          <View style={styles.detailLine}><Text style={styles.detailLabel}>Calificación</Text><Text style={styles.detailValue}>{item.calificacion ? `${item.calificacion}/5` : 'No registrada'}</Text></View>
          <Text style={styles.notes}>{item.notas || 'Sin notas registradas.'}</Text>
          {item.etiquetas.length ? (
            <View style={styles.tags}>{item.etiquetas.map((tag) => <Text key={tag.uuid} style={styles.tag}>{tag.nombre}</Text>)}</View>
          ) : null}
        </PremiumCard>

        <Pressable accessibilityRole="button" onPress={openBook} style={styles.openBookButton}>
          <Ionicons name="book-outline" size={18} color={Theme.colors.textPrimary} />
          <Text style={styles.openBookText}>ABRIR FICHA DEL LIBRO</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

export default function ReadingSummaries({ data = [] }) {
  const [selected, setSelected] = useState(null);
  return (
    <View testID="reading-summaries">
      <View style={styles.headingRow}>
        <View style={styles.headingIcon}><Ionicons name="library-outline" size={20} color={Theme.colors.accentInteractive} /></View>
        <View style={styles.headingText}>
          <Text style={styles.heading}>Resúmenes de lectura</Text>
          <Text style={styles.subheading}>La historia registrada de tus libros terminados</Text>
        </View>
      </View>
      {data.length ? (
        <View style={styles.list}>{data.map((item) => <SummaryCard key={item.uuid} item={item} onPress={() => setSelected(item)} />)}</View>
      ) : (
        <PremiumCard style={styles.emptyCard}>
          <Text style={styles.emptyText}>Cuando termines un libro, acá aparecerá la historia de esa lectura.</Text>
        </PremiumCard>
      )}
      {selected ? <Detail item={selected} onClose={() => setSelected(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md, marginBottom: Theme.spacing.lg },
  headingIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: Theme.colors.accentGlow, borderWidth: 1, borderColor: Theme.colors.accentStroke },
  headingText: { flex: 1 },
  heading: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.section },
  subheading: { marginTop: 2, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  list: { gap: Theme.spacing.md },
  card: { padding: Theme.spacing.md },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  cardBody: { flex: 1 },
  cover: { width: 58, height: 86, borderRadius: Theme.radii.sm, backgroundColor: Theme.colors.surfaceElevated },
  coverLarge: { width: 112, height: 168, borderRadius: Theme.radii.md, backgroundColor: Theme.colors.surfaceElevated },
  coverFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Theme.colors.stroke },
  cardTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  cardAuthor: { marginTop: 2, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  finishDate: { marginTop: Theme.spacing.sm, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, fontSize: 11 },
  compactMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm, marginTop: Theme.spacing.sm },
  compactMetric: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 11 },
  noData: { marginTop: Theme.spacing.sm, color: Theme.colors.warning, fontFamily: Theme.typography.families.interface, fontSize: 11 },
  emptyCard: { backgroundColor: Theme.colors.surfaceElevated },
  emptyText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  modal: { flex: 1, backgroundColor: Theme.colors.background },
  modalContent: { padding: Theme.spacing.lg, paddingBottom: Theme.spacing.xxxl * 2 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 10, letterSpacing: 1.6 },
  modalTitle: { marginTop: 2, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 28, lineHeight: 34 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: Theme.colors.surfaceElevated },
  identity: { flexDirection: 'row', gap: Theme.spacing.lg, marginTop: Theme.spacing.xl, marginBottom: Theme.spacing.xl },
  identityText: { flex: 1, justifyContent: 'center' },
  bookTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, fontSize: 25, lineHeight: 30 },
  bookAuthor: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  meta: { marginTop: Theme.spacing.sm, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  detailCard: { marginBottom: Theme.spacing.lg },
  sectionTitle: { marginBottom: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Theme.spacing.md, paddingVertical: Theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: Theme.colors.stroke },
  detailLabel: { flex: 1, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  detailValue: { flex: 1, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.secondary, textAlign: 'right' },
  explanation: { marginTop: Theme.spacing.md, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary, lineHeight: 19 },
  excluded: { marginTop: Theme.spacing.md, color: Theme.colors.warning, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm },
  stat: { width: '47%', minHeight: 72, padding: Theme.spacing.md, borderRadius: Theme.radii.md, backgroundColor: Theme.colors.surfaceElevated },
  statValue: { color: Theme.colors.accentBright, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 18 },
  statLabel: { marginTop: 3, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, fontSize: 11 },
  notes: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, lineHeight: 23, marginTop: Theme.spacing.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm, marginTop: Theme.spacing.md },
  tag: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.xs, color: Theme.colors.accentBright, backgroundColor: Theme.colors.accentGlow, borderWidth: 1, borderColor: Theme.colors.accentStroke, borderRadius: Theme.radii.pill, fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 11 },
  openBookButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Theme.spacing.sm, borderRadius: Theme.radii.md, backgroundColor: Theme.colors.accent, borderWidth: 1, borderColor: Theme.colors.accentStroke },
  openBookText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
});

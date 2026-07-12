import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { exportarBackupJSON, importarBackupJSON } from '../database';
import { Theme } from '../constants/theme';
import { PremiumButton, PremiumCard } from '../components/PremiumUI';

export default function AjustesScreen() {
  const isMountedRef = useRef(true);
  const [accion, setAccion] = useState(null);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  async function exportarBackup() {
    if (accion) return;
    setAccion('exportar');
    try {
      await exportarBackupJSON();
      if (isMountedRef.current) {
        Alert.alert(
          'Respaldo preparado',
          'El archivo JSON fue generado. Selecciona dónde guardarlo o con qué aplicación compartirlo.'
        );
      }
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        Alert.alert(
          'No se pudo exportar el respaldo',
          error.message || 'No fue posible crear o compartir el archivo de respaldo.'
        );
      }
    } finally {
      if (isMountedRef.current) setAccion(null);
    }
  }

  async function importarBackup() {
    if (accion) return;
    setAccion('importar');
    try {
      const resultado = await importarBackupJSON();
      if (!isMountedRef.current) return;
      if (resultado.cancelado) {
        setAccion(null);
        return;
      }
      Alert.alert(
        'Respaldo importado',
        `${resultado.importados} ${resultado.importados === 1 ? 'libro fue procesado' : 'libros fueron procesados'}. Las coincidencias se actualizaron por UUID.`
      );
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) {
        Alert.alert(
          'No se pudo importar el respaldo',
          error.message || 'El archivo seleccionado no pudo restaurarse.'
        );
      }
    } finally {
      if (isMountedRef.current) setAccion(null);
    }
  }

  function confirmarImportacion() {
    if (accion) return;
    Alert.alert(
      'Importar respaldo',
      'Esta operación fusionará el archivo con la biblioteca local. Los libros con el mismo UUID serán sobrescritos con la información del respaldo. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Seleccionar archivo', style: 'destructive', onPress: importarBackup },
      ]
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.intro}>
        <View style={styles.heroIcon}>
          <Ionicons name="shield-checkmark-outline" size={30} color={Theme.colors.accentInteractive} />
        </View>
        <Text style={styles.title}>Protege tu biblioteca</Text>
        <Text style={styles.subtitle}>
          Conserva una copia portátil de tus libros y portadas para recuperar la colección en otro dispositivo.
        </Text>
      </View>

      <PremiumCard style={styles.card}>
        <View style={styles.cardHeading}>
          <Ionicons name="cloud-upload-outline" size={24} color={Theme.colors.accentBright} />
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>Exportar respaldo</Text>
            <Text style={styles.cardText}>Genera un archivo JSON y compártelo mediante el menú seguro del dispositivo.</Text>
          </View>
        </View>
        <PremiumButton
          style={styles.actionButton}
          onPress={exportarBackup}
          disabled={Boolean(accion)}
          accessibilityLabel="Exportar respaldo de la biblioteca"
        >
          {accion === 'exportar' ? (
            <ActivityIndicator color={Theme.colors.textPrimary} />
          ) : (
            <>
              <Ionicons name="share-outline" size={19} color={Theme.colors.textPrimary} />
              <Text style={styles.buttonText}>EXPORTAR Y COMPARTIR</Text>
            </>
          )}
        </PremiumButton>
      </PremiumCard>

      <PremiumCard style={[styles.card, styles.importCard]}>
        <View style={styles.cardHeading}>
          <Ionicons name="document-text-outline" size={24} color={Theme.colors.warning} />
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>Importar respaldo</Text>
            <Text style={styles.cardText}>Selecciona un JSON creado por Mi Biblioteca para fusionarlo con los datos locales.</Text>
          </View>
        </View>
        <PremiumButton
          style={styles.actionButton}
          onPress={confirmarImportacion}
          disabled={Boolean(accion)}
          accessibilityLabel="Importar respaldo de la biblioteca"
        >
          {accion === 'importar' ? (
            <ActivityIndicator color={Theme.colors.textPrimary} />
          ) : (
            <>
              <Ionicons name="folder-open-outline" size={19} color={Theme.colors.textPrimary} />
              <Text style={styles.buttonText}>SELECCIONAR RESPALDO</Text>
            </>
          )}
        </PremiumButton>
      </PremiumCard>

      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={20} color={Theme.colors.textTertiary} />
        <Text style={styles.noticeText}>
          Guarda el respaldo en una ubicación privada. Puede contener portadas y notas personales de lectura.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background },
  content: { padding: Theme.spacing.xl, paddingBottom: Theme.spacing.xxxl },
  intro: { alignItems: 'center', paddingHorizontal: Theme.spacing.md, marginBottom: Theme.spacing.xxl },
  heroIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: Theme.spacing.lg, backgroundColor: Theme.colors.accentGlow, borderWidth: 1, borderColor: Theme.colors.accentStroke, borderRadius: Theme.radii.pill },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.title, textAlign: 'center' },
  subtitle: { marginTop: Theme.spacing.sm, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
  card: { marginBottom: Theme.spacing.lg, padding: Theme.spacing.xl, backgroundColor: Theme.colors.surfaceElevated },
  importCard: { borderColor: Theme.colors.strokeStrong },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Theme.spacing.md },
  cardCopy: { flex: 1 },
  cardTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  cardText: { marginTop: Theme.spacing.xs, color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body },
  actionButton: { width: '100%', marginTop: Theme.spacing.xl },
  buttonText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Theme.spacing.sm, padding: Theme.spacing.lg, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.md },
  noticeText: { flex: 1, color: Theme.colors.textTertiary, fontFamily: Theme.typography.families.interface, ...Theme.typography.secondary },
});

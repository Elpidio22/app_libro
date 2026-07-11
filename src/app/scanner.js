import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { insertarLibro, obtenerLibroPorISBN } from '../database';
import { descartarPortadaTemporal, optimizarYGuardarPortada, pegarPortadaDesdePortapapeles } from '../portadas';
import { Theme } from '../constants/theme';
import { PremiumButton } from '../components/PremiumUI';

const GOOGLE_URL = 'https://www.googleapis.com/books/v1/volumes';
const MELI_URL = 'https://api.mercadolibre.com/sites/MLA/search';
const OPEN_LIBRARY_URL = 'https://openlibrary.org/api/books';
const FORMULARIO_VACIO = {
  isbn: '',
  titulo: '',
  autor: '',
  paginas_totales: '',
  portada_url: null,
};

function normalizarISBN(value) {
  const isbn = String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : null;
}

async function buscarGoogle(isbn, signal) {
  const response = await axios.get(GOOGLE_URL, {
    params: { q: `isbn:${isbn}`, maxResults: 1 },
    timeout: 10000,
    signal,
  });
  const info = response.data?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  return {
    isbn,
    titulo: info.title,
    autor: info.authors?.join(', ') || '',
    paginas_totales: info.pageCount ? String(info.pageCount) : '',
    portada_url: info.imageLinks?.thumbnail?.replace(/^http:/i, 'https:') || null,
    fuente: 'Google Books',
  };
}

async function buscarMercadoLibre(isbn, signal) {
  const response = await axios.get(MELI_URL, {
    params: { q: isbn, limit: 1 },
    timeout: 10000,
    signal,
  });
  const item = response.data?.results?.[0];
  if (!item?.title) return null;
  return {
    isbn,
    titulo: item.title,
    autor: '',
    paginas_totales: '',
    portada_url: (item.secure_thumbnail || item.thumbnail || '').replace(/^http:/i, 'https:') || null,
    fuente: 'Mercado Libre',
  };
}

async function buscarOpenLibrary(isbn, signal) {
  const key = `ISBN:${isbn}`;
  const response = await axios.get(OPEN_LIBRARY_URL, {
    params: { bibkeys: key, format: 'json', jscmd: 'data' },
    timeout: 10000,
    signal,
  });
  const info = response.data?.[key];
  if (!info?.title) return null;
  return {
    isbn,
    titulo: info.title,
    autor: info.authors?.map((author) => author.name).join(', ') || '',
    paginas_totales: info.number_of_pages ? String(info.number_of_pages) : '',
    portada_url: info.cover?.large || info.cover?.medium || info.cover?.small || null,
    fuente: 'Open Library',
  };
}

export async function buscarLibroEnCascada(isbn, { signal } = {}) {
  const proveedores = [buscarGoogle, buscarOpenLibrary, buscarMercadoLibre];
  for (const buscar of proveedores) {
    if (signal?.aborted) throw new Error('Búsqueda cancelada');
    try {
      const resultado = await buscar(isbn, signal);
      if (resultado?.titulo) return resultado;
    } catch (error) {
      if (signal?.aborted || error?.code === 'ERR_CANCELED') throw error;
      console.warn(`Falló el proveedor ${buscar.name}.`, error?.message || error);
    }
  }
  return null;
}

export default function AltaLibroScreen() {
  const scanLock = useRef(false);
  const formScrollRef = useRef(null);
  const isMountedRef = useRef(false);
  const searchControllerRef = useRef(null);
  const portadaTemporalRef = useRef(null);
  const [modo, setModo] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [isFocused, setIsFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchingManual, setSearchingManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [mensaje, setMensaje] = useState('Alinea el código ISBN dentro del marco');
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);

  useFocusEffect(useCallback(() => {
    isMountedRef.current = true;
    setIsFocused(true);
    return () => {
      isMountedRef.current = false;
      searchControllerRef.current?.abort();
      searchControllerRef.current = null;
      descartarPortadaTemporal(portadaTemporalRef.current);
      portadaTemporalRef.current = null;
      setIsFocused(false);
    };
  }, []));

  function limpiarEscaner() {
    descartarPortadaTemporal(portadaTemporalRef.current);
    portadaTemporalRef.current = null;
    scanLock.current = false;
    setPaused(false);
    setLoading(false);
    setConfirmando(false);
    setFormulario(FORMULARIO_VACIO);
    setMensaje('Alinea el código ISBN dentro del marco');
  }

  function seleccionarModo(nuevoModo) {
    if (nuevoModo !== modo) Haptics.selectionAsync().catch(() => {});
    setModo(nuevoModo);
    limpiarEscaner();
  }

  function abrirModoManual(isbn = '') {
    setModo('manual');
    scanLock.current = false;
    setPaused(false);
    setLoading(false);
    setConfirmando(false);
    setFormulario({ ...FORMULARIO_VACIO, isbn });
  }

  function actualizarCampo(campo, valor) {
    setFormulario((actual) => ({ ...actual, [campo]: valor }));
  }

  function mantenerInputVisible(event, extraOffset = 110) {
    const target = event.target || event.nativeEvent.target;
    setTimeout(() => {
      formScrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        target,
        extraOffset,
        true
      );
    }, Platform.OS === 'android' ? 280 : 80);
  }

  function enfocarCampo(campo, event) {
    setFocusedField(campo);
    mantenerInputVisible(event);
  }

  const detectarISBN = useCallback(async ({ data }) => {
    if (scanLock.current) return;
    const isbn = normalizarISBN(data);
    if (!isbn) {
      setMensaje('El código detectado no es un ISBN válido');
      return;
    }

    scanLock.current = true;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setPaused(true);
    setLoading(true);
    setMensaje(`Buscando ISBN ${isbn}…`);
    try {
      if (await obtenerLibroPorISBN(isbn)) {
        if (!isMountedRef.current || controller.signal.aborted) return;
        Alert.alert('Libro duplicado', 'Este ISBN ya existe en tu biblioteca.', [
          { text: 'Entendido', onPress: limpiarEscaner },
        ]);
        return;
      }

      const encontrado = await buscarLibroEnCascada(isbn, { signal: controller.signal });
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!encontrado) {
        Alert.alert(
          'Edición no encontrada',
          'No encontramos datos automáticos. Puedes completar el libro manualmente.',
          [
            { text: 'Volver a escanear', style: 'cancel', onPress: limpiarEscaner },
            { text: 'Completar manualmente', onPress: () => abrirModoManual(isbn) },
          ]
        );
        return;
      }

      setFormulario(encontrado);
      setConfirmando(true);
      setMensaje(`Datos encontrados en ${encontrado.fuente}`);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      console.error(error);
      Alert.alert('Error de búsqueda', 'No fue posible consultar los catálogos.', [
        { text: 'Reintentar', style: 'cancel', onPress: limpiarEscaner },
        { text: 'Carga manual', onPress: () => abrirModoManual(isbn) },
      ]);
    } finally {
      if (searchControllerRef.current === controller) searchControllerRef.current = null;
      if (isMountedRef.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  async function seleccionarPortada() {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus fotos para seleccionar una portada.');
      return;
    }

    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.85,
    });
    if (resultado.canceled) return;

    try {
      const asset = resultado.assets[0];
      const portadaOptimizada = await optimizarYGuardarPortada(asset.uri, { temporal: true });
      descartarPortadaTemporal(portadaTemporalRef.current);
      portadaTemporalRef.current = portadaOptimizada;
      actualizarCampo('portada_url', portadaOptimizada);
      if (!portadaOptimizada) {
        Alert.alert('Portada no disponible', 'El libro usará el marcador gris por defecto.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('No se pudo guardar la portada', 'Selecciona otra imagen e inténtalo nuevamente.');
    }
  }

  async function pegarPortada() {
    try {
      const portada = await pegarPortadaDesdePortapapeles({ temporal: true });
      if (!portada) {
        Alert.alert(
          'No hay una imagen para pegar',
          'Copia una imagen desde el navegador, la galería u otra aplicación y vuelve a intentarlo.'
        );
        return;
      }
      descartarPortadaTemporal(portadaTemporalRef.current);
      portadaTemporalRef.current = portada;
      actualizarCampo('portada_url', portada);
    } catch (error) {
      console.error(error);
      Alert.alert('No se pudo pegar la portada', error.message || 'La imagen copiada no pudo procesarse.');
    }
  }

  async function buscarISBNManual() {
    const isbn = normalizarISBN(formulario.isbn);
    if (!isbn) {
      Alert.alert('ISBN inválido', 'Ingresa un ISBN de 10 o 13 caracteres. Puedes escribirlo con guiones.');
      return;
    }

    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearchingManual(true);
    try {
      if (await obtenerLibroPorISBN(isbn)) {
        if (!isMountedRef.current || controller.signal.aborted) return;
        Alert.alert('Libro duplicado', 'Este ISBN ya existe en tu biblioteca.');
        return;
      }
      const encontrado = await buscarLibroEnCascada(isbn, { signal: controller.signal });
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!encontrado) {
        Alert.alert(
          'Sin resultados',
          'No encontramos esta edición. Puedes conservar el ISBN y completar el resto del formulario manualmente.'
        );
        actualizarCampo('isbn', isbn);
        return;
      }
      setFormulario((actual) => ({
        ...actual,
        ...encontrado,
        isbn,
      }));
      Alert.alert('Datos encontrados', `El formulario fue completado desde ${encontrado.fuente}. Puedes corregir los campos antes de guardar.`);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      console.error(error);
      Alert.alert('No se pudo buscar', 'Revisa tu conexión e inténtalo nuevamente. Los datos que escribiste se conservaron.');
    } finally {
      if (searchControllerRef.current === controller) searchControllerRef.current = null;
      if (isMountedRef.current && !controller.signal.aborted) setSearchingManual(false);
    }
  }

  async function guardarLibro() {
    if (!formulario.titulo.trim()) {
      Alert.alert('Falta el título', 'El título es obligatorio.');
      return;
    }
    const isbn = formulario.isbn.trim() ? normalizarISBN(formulario.isbn) : null;
    if (formulario.isbn.trim() && !isbn) {
      Alert.alert('ISBN inválido', 'El ISBN debe tener 10 o 13 caracteres.');
      return;
    }
    const paginas = formulario.paginas_totales === '' ? null : Number(formulario.paginas_totales);
    if (paginas !== null && (!Number.isInteger(paginas) || paginas < 0)) {
      Alert.alert('Páginas inválidas', 'Ingresa una cantidad válida de páginas.');
      return;
    }

    setSaving(true);
    try {
      await insertarLibro({
        isbn,
        titulo: formulario.titulo,
        autor: formulario.autor,
        paginas_totales: paginas,
        portada_url: formulario.portada_url || null,
        pagina_actual: 0,
        estado: 'quiero leer',
      });
      portadaTemporalRef.current = null;
      if (!isMountedRef.current) return;
      Alert.alert('Libro guardado', 'El libro fue añadido a tu biblioteca.', [
        { text: 'Continuar', onPress: () => seleccionarModo(modo) },
      ]);
    } catch (error) {
      console.error(error);
      const duplicado = String(error?.message).includes('UNIQUE');
      if (isMountedRef.current) Alert.alert('No se pudo guardar', duplicado ? 'Ese ISBN ya existe en tu biblioteca.' : error.message);
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  }

  function FormularioLibro({ permitePortadaLocal = false }) {
    return (
      <ScrollView
        ref={formScrollRef}
        style={styles.formScroll}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {formulario.portada_url ? (
          <Image source={{ uri: formulario.portada_url }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.placeholder]}><Ionicons name="book-outline" size={52} color={Theme.colors.textSecondary} /></View>
        )}
        {permitePortadaLocal ? (
          <View style={styles.coverActions}>
            <Pressable style={[styles.secondaryButton, styles.coverAction]} onPress={seleccionarPortada}>
              <Ionicons name="image-outline" size={18} color={Theme.colors.textSecondary} />
              <Text style={styles.secondaryText}>GALERÍA</Text>
            </Pressable>
            <Pressable style={[styles.secondaryButton, styles.coverAction]} onPress={pegarPortada}>
              <Ionicons name="clipboard-outline" size={18} color={Theme.colors.textSecondary} />
              <Text style={styles.secondaryText}>PEGAR IMAGEN</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.card}>
          <Text style={styles.label}>ISBN (OPCIONAL)</Text>
          <View style={styles.isbnRow}>
            <TextInput
              value={formulario.isbn}
              onFocus={(event) => enfocarCampo('isbn', event)}
              onBlur={() => setFocusedField(null)}
              onChangeText={(value) => actualizarCampo('isbn', value)}
              onSubmitEditing={buscarISBNManual}
              style={[styles.input, focusedField === 'isbn' && styles.inputFocused, styles.isbnInput]}
              placeholder="978…"
              placeholderTextColor={Theme.colors.textTertiary}
              autoCapitalize="characters"
              returnKeyType="search"
            />
            <Pressable
              style={[styles.isbnSearchButton, searchingManual && styles.disabled]}
              onPress={buscarISBNManual}
              disabled={searchingManual}
            >
              {searchingManual
                ? <ActivityIndicator size="small" color={Theme.colors.textSecondary} />
                : <Ionicons name="search" size={20} color={Theme.colors.textSecondary} />}
            </Pressable>
          </View>
          <Text style={styles.label}>TÍTULO *</Text>
          <TextInput value={formulario.titulo} onFocus={(event) => enfocarCampo('titulo', event)} onBlur={() => setFocusedField(null)} onChangeText={(value) => actualizarCampo('titulo', value)} style={[styles.input, focusedField === 'titulo' && styles.inputFocused]} placeholder="Título del libro" placeholderTextColor={Theme.colors.textTertiary} />
          <Text style={styles.label}>AUTOR</Text>
          <TextInput value={formulario.autor} onFocus={(event) => enfocarCampo('autor', event)} onBlur={() => setFocusedField(null)} onChangeText={(value) => actualizarCampo('autor', value)} style={[styles.input, focusedField === 'autor' && styles.inputFocused]} placeholder="Autor" placeholderTextColor={Theme.colors.textTertiary} />
          <Text style={styles.label}>PÁGINAS TOTALES</Text>
          <TextInput value={formulario.paginas_totales} onFocus={(event) => enfocarCampo('paginas', event)} onBlur={() => setFocusedField(null)} onChangeText={(value) => actualizarCampo('paginas_totales', value.replace(/\D/g, ''))} style={[styles.input, focusedField === 'paginas' && styles.inputFocused]} keyboardType="number-pad" placeholder="Cantidad de páginas" placeholderTextColor={Theme.colors.textTertiary} />
        </View>
        <PremiumButton
          style={styles.primaryButton}
          label="GUARDAR LIBRO"
          onPress={guardarLibro}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color={Theme.colors.textPrimary} /> : <Text style={styles.primaryText}>GUARDAR LIBRO</Text>}
        </PremiumButton>
        {confirmando ? <Pressable style={styles.secondaryButton} onPress={limpiarEscaner}><Text style={styles.secondaryText}>DESCARTAR Y ESCANEAR</Text></Pressable> : null}
      </ScrollView>
    );
  }

  function ContenidoEscaner() {
    if (!permission) return <View style={styles.center}><ActivityIndicator color={Theme.colors.accent} /></View>;
    if (!permission.granted) {
      return <View style={styles.center}><Ionicons name="camera-outline" size={56} color={Theme.colors.accent} /><Text style={styles.permissionTitle}>Permiso de cámara</Text><Text style={styles.help}>La cámara solo se utiliza para leer el ISBN.</Text><PremiumButton style={styles.primaryButton} label="CONCEDER PERMISO" onPress={requestPermission} /></View>;
    }
    if (confirmando) return FormularioLibro({ permitePortadaLocal: false });

    return (
      <View style={styles.cameraContainer}>
        {isFocused && !loading ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={paused ? undefined : detectarISBN}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
          />
        ) : null}
        <View style={styles.cameraOverlay}>
          {loading ? (
            <View style={styles.loadingBox}><ActivityIndicator size="large" color={Theme.colors.accent} /><Text style={styles.loadingText}>{mensaje}</Text></View>
          ) : (
            <><View style={styles.scanFrame}><View style={styles.scanLine} /></View><View style={styles.messageBox}><Ionicons name="barcode-outline" size={23} color={Theme.colors.textPrimary} /><Text style={styles.help}>{mensaje}</Text></View></>
          )}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {modo ? <View style={styles.segmented}>
        <Pressable style={({ pressed }) => [styles.segment, modo === 'escanear' && styles.segmentActive, pressed && styles.segmentPressed]} onPress={() => seleccionarModo('escanear')}><Ionicons name="barcode-outline" size={18} color={modo === 'escanear' ? Theme.colors.textPrimary : Theme.colors.textSecondary} /><Text style={[styles.segmentText, modo === 'escanear' && styles.segmentTextActive]}>ESCANEAR</Text></Pressable>
        <Pressable style={({ pressed }) => [styles.segment, modo === 'manual' && styles.segmentActive, pressed && styles.segmentPressed]} onPress={() => seleccionarModo('manual')}><Ionicons name="create-outline" size={18} color={modo === 'manual' ? Theme.colors.textPrimary : Theme.colors.textSecondary} /><Text style={[styles.segmentText, modo === 'manual' && styles.segmentTextActive]}>CARGA MANUAL</Text></Pressable>
      </View> : null}
      <View style={styles.body}>
        {modo === null ? (
          <View style={styles.modeChooser}>
            <Ionicons name="add-circle-outline" size={48} color={Theme.colors.accentInteractive} />
            <Text style={styles.chooserTitle}>¿Cómo quieres añadirlo?</Text>
            <Text style={styles.help}>La cámara solo se activará cuando elijas escanear.</Text>
            <Pressable style={styles.modeCard} onPress={() => seleccionarModo('escanear')}>
              <Ionicons name="barcode-outline" size={28} color={Theme.colors.accentInteractive} />
              <View style={styles.modeCopy}><Text style={styles.modeTitle}>Escanear</Text><Text style={styles.help}>Leer el ISBN con la cámara</Text></View>
              <Ionicons name="chevron-forward" size={20} color={Theme.colors.textTertiary} />
            </Pressable>
            <Pressable style={styles.modeCard} onPress={() => seleccionarModo('manual')}>
              <Ionicons name="create-outline" size={28} color={Theme.colors.accentInteractive} />
              <View style={styles.modeCopy}><Text style={styles.modeTitle}>Carga manual</Text><Text style={styles.help}>Completar los datos a mano</Text></View>
              <Ionicons name="chevron-forward" size={20} color={Theme.colors.textTertiary} />
            </Pressable>
          </View>
        ) : modo === 'escanear' ? ContenidoEscaner() : FormularioLibro({ permitePortadaLocal: true })}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.colors.background },
  body: { flex: 1 },
  modeChooser: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Theme.spacing.md, padding: Theme.spacing.xl },
  chooserTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.title, textAlign: 'center' },
  modeCard: { width: '100%', minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md, padding: Theme.spacing.lg, marginTop: Theme.spacing.sm, backgroundColor: Theme.colors.surfaceElevated, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.lg },
  modeCopy: { flex: 1, alignItems: 'flex-start' },
  modeTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.cardTitle },
  segmented: { flexDirection: 'row', padding: Theme.spacing.xs, margin: Theme.spacing.md, marginBottom: Theme.spacing.sm, backgroundColor: Theme.colors.surfaceElevated, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.md },
  segment: { flex: 1, minHeight: 44, flexDirection: 'row', gap: Theme.spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Theme.radii.sm },
  segmentActive: { backgroundColor: Theme.colors.accent },
  segmentPressed: { opacity: 0.78 },
  segmentText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.label },
  segmentTextActive: { color: Theme.colors.textPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Theme.spacing.lg, padding: Theme.spacing.xxxl },
  permissionTitle: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.title },
  cameraContainer: { flex: 1, backgroundColor: Theme.colors.background },
  cameraOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Theme.spacing.xxl, backgroundColor: Theme.colors.transparent },
  scanFrame: { width: '100%', maxWidth: 330, height: 190, justifyContent: 'center', borderWidth: 2, borderColor: Theme.colors.accent, borderRadius: Theme.radii.md },
  scanLine: { height: 2, marginHorizontal: Theme.spacing.lg, backgroundColor: Theme.colors.accentBright },
  messageBox: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm, padding: Theme.spacing.lg, marginTop: Theme.spacing.xl, backgroundColor: Theme.colors.overlay, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.sm },
  loadingBox: { alignItems: 'center', gap: Theme.spacing.lg, padding: Theme.spacing.xxl, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.md },
  loadingText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
  help: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
  formScroll: { flex: 1 },
  formContent: { flexGrow: 1, alignItems: 'center', padding: Theme.spacing.lg, paddingBottom: Theme.spacing.xxxl },
  cover: { width: 130, height: 190, marginBottom: Theme.spacing.md, borderRadius: Theme.radii.sm, backgroundColor: Theme.colors.surface },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Theme.colors.stroke },
  card: { width: '100%', padding: Theme.spacing.lg, marginTop: Theme.spacing.md, backgroundColor: Theme.colors.surfaceElevated, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.lg },
  label: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.sm },
  input: { minHeight: 48, paddingHorizontal: Theme.spacing.md, color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.stroke, borderRadius: Theme.radii.md },
  inputFocused: { backgroundColor: Theme.colors.surfacePressed, borderColor: Theme.colors.accentStroke },
  isbnRow: { flexDirection: 'row', alignItems: 'stretch', gap: Theme.spacing.sm },
  isbnInput: { flex: 1 },
  isbnSearchButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md },
  primaryButton: { width: '100%', marginTop: Theme.spacing.lg },
  primaryText: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.interfaceSemiBold, ...Theme.typography.button },
  secondaryButton: { minHeight: 44, flexDirection: 'row', gap: Theme.spacing.sm, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', paddingHorizontal: Theme.spacing.lg, marginTop: Theme.spacing.sm, backgroundColor: Theme.colors.surface, borderWidth: 1, borderColor: Theme.colors.strokeStrong, borderRadius: Theme.radii.md },
  coverActions: { width: '100%', flexDirection: 'row', gap: Theme.spacing.sm },
  coverAction: { flex: 1, marginTop: Theme.spacing.sm },
  secondaryText: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label },
  disabled: { opacity: 0.55 },
});

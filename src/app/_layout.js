import { Component, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inicializarBaseDeDatos } from '../database';
import { Theme } from '../constants/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const icons = {
  index: ['library', 'library-outline'],
  scanner: ['barcode', 'barcode-outline'],
  deseos: ['eye', 'eye-outline'],
  cronicas: ['stats-chart', 'stats-chart-outline'],
  ajustes: ['settings', 'settings-outline'],
};

function describirErrorDeArranque(reason) {
  const detalle = reason instanceof Error ? reason.message : String(reason || 'Error desconocido');
  return `SQLite no pudo inicializar la biblioteca: ${detalle}`;
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Error fatal capturado en la interfaz.', error, info);
    SplashScreen.hideAsync().catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <Ionicons name="warning-outline" size={46} color={Theme.colors.danger} />
        <Text style={styles.title}>La aplicación no pudo iniciar</Text>
        <Text style={styles.muted}>{String(this.state.error.message || this.state.error)}</Text>
      </View>
    );
  }
}

function RootLayoutContent() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [fontsLoaded, fontError] = useFonts({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
  });

  useEffect(() => {
    let isMounted = true;

    async function prepararBaseDeDatos() {
      try {
        await inicializarBaseDeDatos();
        if (isMounted) setReady(true);
      } catch (reason) {
        console.error('Falló la inicialización de SQLite.', reason);
        if (isMounted) setError(describirErrorDeArranque(reason));
      }
    }

    prepararBaseDeDatos();
    return () => {
      isMounted = false;
    };
  }, []);

  const fontsSettled = fontsLoaded || Boolean(fontError);
  const databaseSettled = ready || Boolean(error);

  useEffect(() => {
    if (fontsSettled && databaseSettled) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [databaseSettled, fontsSettled]);

  useEffect(() => {
    if (fontError) console.error('No se pudieron cargar las tipografías.', fontError);
  }, [fontError]);

  if (!fontsSettled || !databaseSettled) return null;

  if (fontError || error) {
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <Ionicons name="warning-outline" size={46} color={Theme.colors.accent} />
        <Text style={styles.title}>La biblioteca permanece sellada</Text>
        <Text style={styles.muted}>
          {error || 'No se pudieron cargar las tipografías de la aplicación.'}
        </Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: Theme.colors.surface },
          headerTintColor: Theme.colors.textPrimary,
          headerTitleStyle: { fontFamily: Theme.typography.families.interfaceSemiBold, fontSize: 22 },
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: Theme.colors.background },
          tabBarStyle: {
            height: 58 + insets.bottom,
            paddingTop: 7,
            paddingBottom: Math.max(insets.bottom, 8),
            backgroundColor: Theme.colors.surface,
            borderTopColor: Theme.colors.stroke,
          },
          tabBarActiveTintColor: Theme.colors.accentInteractive,
          tabBarInactiveTintColor: Theme.colors.textTertiary,
          tabBarLabelStyle: { fontFamily: Theme.typography.families.interfaceMedium, ...Theme.typography.label, letterSpacing: 0 },
          tabBarHideOnKeyboard: true,
          tabBarIcon: ({ color, size, focused }) => {
            const pair = icons[route.name] || ['ellipse', 'ellipse-outline'];
            return <Ionicons name={pair[focused ? 0 : 1]} size={size} color={color} />;
          },
        })}
      >
        <Tabs.Screen name="index" options={{ title: 'Biblioteca', headerTitle: 'Mi Biblioteca' }} />
        <Tabs.Screen name="scanner" options={{ title: 'Añadir', headerTitle: 'Añadir un libro' }} />
        <Tabs.Screen name="deseos" options={{ title: 'Deseos', headerTitle: 'La cacería' }} />
        <Tabs.Screen name="cronicas" options={{ title: 'Crónicas', headerTitle: 'Crónicas' }} />
        <Tabs.Screen name="ajustes" options={{ title: 'Ajustes', headerTitle: 'Ajustes' }} />
        <Tabs.Screen name="libro/[id]" options={{ href: null, title: 'Ficha del libro' }} />
      </Tabs>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <RootLayoutContent />
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.lg,
    padding: Theme.spacing.xxxl,
    backgroundColor: Theme.colors.background,
  },
  title: { color: Theme.colors.textPrimary, fontFamily: Theme.typography.families.editorialBold, ...Theme.typography.title, textAlign: 'center' },
  muted: { color: Theme.colors.textSecondary, fontFamily: Theme.typography.families.interface, ...Theme.typography.body, textAlign: 'center' },
});

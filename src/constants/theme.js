export const Theme = Object.freeze({
  colors: Object.freeze({
      background: '#070707',
      surface: '#111111',
      surfaceElevated: '#181616',
      surfacePressed: '#211A1A',
      
      // La nueva paleta Ámbar/Bronce
      accent: '#B8905B',
      accentBright: '#C2A378',
      accentInteractive: '#D6B075',
      accentPressed: '#8A6A40',
      accentStroke: 'rgba(184,144,91,0.3)',
      accentGlow: 'rgba(184,144,91,0.15)',
      
      textPrimary: '#E7E2DE',
      textSecondary: '#A39C98',
      textTertiary: '#817A76',
      placeholder: '#817A76',
      disabled: 'rgba(231,226,222,0.34)',
      
      stroke: 'rgba(255,255,255,0.055)',
      strokeStrong: 'rgba(255,255,255,0.11)',
      strokeFocus: 'rgba(184,144,91,0.65)', // Glow del borde en tono bronce
      
      success: '#8FA881',
      warning: '#C99A58',
      danger: '#D04B52',
      overlay: 'rgba(0,0,0,0.76)',
      transparent: 'transparent',
    }),

  spacing: Object.freeze({
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  }),

  radii: Object.freeze({
    sm: 6,
    md: 10,
    lg: 12,
    xl: 18,
    pill: 999,
  }),

  typography: Object.freeze({
    families: Object.freeze({
      nativeFallback: 'sans-serif',
      editorial: 'Inter-SemiBold',
      editorialBold: 'Inter-SemiBold',
      interface: 'Inter-Regular',
      interfaceMedium: 'Inter-Medium',
      interfaceSemiBold: 'Inter-SemiBold',
    }),
    display: Object.freeze({ fontSize: 32, lineHeight: 38, fontWeight: '600' }),
    title: Object.freeze({ fontSize: 24, lineHeight: 30, fontWeight: '600' }),
    section: Object.freeze({ fontSize: 20, lineHeight: 26, fontWeight: '600' }),
    cardTitle: Object.freeze({ fontSize: 16, lineHeight: 21, fontWeight: '600' }),
    body: Object.freeze({ fontSize: 14, lineHeight: 21, fontWeight: '400' }),
    secondary: Object.freeze({ fontSize: 12, lineHeight: 17, fontWeight: '400' }),
    label: Object.freeze({ fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.8 }),
    button: Object.freeze({ fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.35 }),
  }),

  shadows: Object.freeze({
    card: Object.freeze({
      shadowColor: '#000000',
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: Object.freeze({ width: 0, height: 6 }),
      elevation: 3,
    }),
    modal: Object.freeze({
      shadowColor: '#000000',
      shadowOpacity: 0.55,
      shadowRadius: 28,
      shadowOffset: Object.freeze({ width: 0, height: 14 }),
      elevation: 12,
    }),
  }),

  motion: Object.freeze({
    pressScale: 0.97,
    pressInDuration: 100,
    pressOutDuration: 160,
  }),
});

export default Theme;

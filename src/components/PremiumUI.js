import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Theme } from '../constants/theme';

export function PremiumCard({ children, style, contentStyle, ...viewProps }) {
  return (
    <Animated.View style={[styles.card, style]} {...viewProps}>
      <View style={contentStyle}>{children}</View>
    </Animated.View>
  );
}

export function PremiumButton({
  children,
  label,
  onPress,
  disabled = false,
  style,
  contentStyle,
  textStyle,
  accessibilityLabel,
  onPressIn,
  onPressOut,
  ...pressableProps
}) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePressIn(event) {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.timing(scale, {
      toValue: Theme.motion.pressScale,
      duration: Theme.motion.pressInDuration,
      useNativeDriver: true,
    }).start();
    onPressIn?.(event);
  }

  function handlePressOut(event) {
    Animated.spring(scale, {
      toValue: 1,
      damping: 18,
      stiffness: 240,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
    onPressOut?.(event);
  }

  return (
    <Animated.View
      style={[
        styles.buttonShell,
        { transform: [{ scale }] },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Pressable
        {...pressableProps}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.pressable}
      >
        <LinearGradient
          colors={[Theme.colors.accentBright, Theme.colors.accent, Theme.colors.accentPressed]}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.buttonContent, contentStyle]}
        >
          {children || <Text style={[styles.buttonText, textStyle]}>{label}</Text>}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Theme.spacing.lg,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.stroke,
    borderRadius: Theme.radii.lg,
    ...Theme.shadows.card,
  },
  buttonShell: {
    minHeight: 50,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Theme.colors.strokeStrong,
    borderRadius: Theme.radii.md,
    shadowColor: Theme.colors.accent,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  pressable: {
    flex: 1,
  },
  buttonContent: {
    flex: 1,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.xl,
    paddingVertical: Theme.spacing.md,
  },
  buttonText: {
    ...Theme.typography.button,
    color: Theme.colors.textPrimary,
    fontFamily: Theme.typography.families.interfaceSemiBold,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.48,
  },
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Keyboard, Platform, UIManager } from 'react-native';

const SAFE_GAP = 24;

export function useKeyboardAwareScroll() {
  const scrollRef = useRef(null);
  const scrollOffsetRef = useRef(0);
  const focusedTargetRef = useRef(null);
  const keyboardTopRef = useRef(Number.POSITIVE_INFINITY);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const revealFocusedInput = useCallback((extraGap = SAFE_GAP) => {
    if (Platform.OS !== 'android' || !focusedTargetRef.current) return;
    const target = focusedTargetRef.current;
    const onMeasure = (_x, y, _width, height) => {
      const visibleBottom = keyboardTopRef.current - extraGap;
      const inputBottom = y + height;
      if (inputBottom <= visibleBottom) return;
      scrollRef.current?.scrollTo({
        y: Math.max(0, scrollOffsetRef.current + inputBottom - visibleBottom),
        animated: false,
      });
    };
    if (typeof target.measureInWindow === 'function') {
      target.measureInWindow(onMeasure);
      return;
    }
    const nativeHandle = typeof target === 'number' ? target : findNodeHandle(target);
    if (typeof nativeHandle === 'number') UIManager.measureInWindow(nativeHandle, onMeasure);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTopRef.current = event.endCoordinates.screenY;
      setKeyboardHeight(event.endCoordinates.height);
      setTimeout(() => revealFocusedInput(), 180);
      setTimeout(() => revealFocusedInput(), 420);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopRef.current = Number.POSITIVE_INFINITY;
      setKeyboardHeight(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [revealFocusedInput]);

  const onInputFocus = useCallback((event, extraGap = SAFE_GAP) => {
    focusedTargetRef.current = event.target || event.nativeEvent.target;
    setTimeout(() => revealFocusedInput(extraGap), 500);
    setTimeout(() => revealFocusedInput(extraGap), 800);
  }, [revealFocusedInput]);

  const onScroll = useCallback((event) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  return { scrollRef, keyboardHeight, onInputFocus, onScroll };
}

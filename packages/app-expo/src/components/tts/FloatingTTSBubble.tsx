/**
 * FloatingTTSBubble — Global draggable mini-player shown when TTS is active.
 *
 * Rendered as a sibling to NavigationContainer in AppInner so it floats
 * above every screen. Tapping it expands a compact player modal.
 */
import { useTTSStore } from "@/stores";
import { HeadphonesIcon } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import { TTSMiniPlayer, type TTSBubbleAnchor } from "./TTSMiniPlayer";
import { getNavigationBottomInset, NAVIGATION_RAIL_WIDTH } from "@/hooks/responsive-layout";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Platform,
  type View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BUBBLE_SIZE = 56;

export function FloatingTTSBubble({ tabsVisible }: { tabsVisible: boolean }) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { width: screenWidth, height: screenHeight } = layout;
  const railWidth = tabsVisible && layout.useNavigationRail ? NAVIGATION_RAIL_WIDTH : 0;
  const bottomInset = tabsVisible
    ? getNavigationBottomInset(insets.bottom, Platform.OS === "android", layout.isTablet)
    : insets.bottom;
  const bottomBarHeight = tabsVisible && !layout.useNavigationRail ? 60 : 0;
  const bubbleRight = insets.right + railWidth + 20;
  const bubbleBottom = bottomInset + bottomBarHeight + 20;
  const minLeft = insets.left + 8;
  const maxRight = screenWidth - insets.right - railWidth - 8;
  const minTop = insets.top + 8;
  const maxBottom = screenHeight - bottomInset - bottomBarHeight - 8;

  const playState = useTTSStore((s) => s.playState);

  const [showPlayer, setShowPlayer] = useState(false);
  const [anchorLayout, setAnchorLayout] = useState<TTSBubbleAnchor | null>(null);

  const isActive = playState === "playing" || playState === "paused" || playState === "loading";

  useEffect(() => {
    if (!isActive) setShowPlayer(false);
  }, [isActive]);

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const bubbleRef = useRef<View>(null);
  const clampBubble = useCallback((onClamped?: () => void) => {
    pan.stopAnimation((v: { x: number; y: number }) => {
      const baseLeft = screenWidth - bubbleRight - BUBBLE_SIZE;
      const baseTop = screenHeight - bubbleBottom - BUBBLE_SIZE;
      const clampedX = Math.min(Math.max(v.x, minLeft - baseLeft), Math.max(minLeft, maxRight - BUBBLE_SIZE) - baseLeft);
      const clampedY = Math.min(Math.max(v.y, minTop - baseTop), Math.max(minTop, maxBottom - BUBBLE_SIZE) - baseTop);
      if (clampedX !== v.x || clampedY !== v.y) {
        pan.setOffset({ x: 0, y: 0 });
        pan.setValue({ x: clampedX, y: clampedY });
      }
      onClamped?.();
    });
  }, [pan, screenWidth, screenHeight, bubbleRight, bubbleBottom, minLeft, maxRight, minTop, maxBottom]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => pan.extractOffset(),
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => { pan.flattenOffset(); clampBubble(); },
    onPanResponderTerminate: () => { pan.flattenOffset(); clampBubble(); },
  }), [pan, clampBubble]);

  // Ripple pulse rings — only when playing
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (playState === "playing") {
      const makeRipple = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
        );
      const a1 = makeRipple(ring1, 0);
      const a2 = makeRipple(ring2, 700);
      a1.start();
      a2.start();
      return () => { a1.stop(); a2.stop(); };
    }
    ring1.setValue(0);
    ring2.setValue(0);
  }, [playState, ring1, ring2]);

  const makeRingStyle = (anim: Animated.Value) => ({
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.0] }) }],
    opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.35, 0] }),
  });

  const handleBubbleTap = useCallback(() => { setShowPlayer((v) => !v); }, []);

  const measurementFrame = useRef<number | null>(null);
  const committedGeometry = useRef<symbol | null>(null);
  const geometry = useMemo(
    () => Symbol("tts-bubble-geometry"),
    [isActive, showPlayer, screenWidth, screenHeight, bubbleRight, bubbleBottom, minLeft, maxRight, minTop, maxBottom],
  );
  const measureBubble = useCallback(() => {
    if (!isActive || !showPlayer || committedGeometry.current !== geometry || measurementFrame.current !== null) return;
    measurementFrame.current = requestAnimationFrame(() => {
      measurementFrame.current = null;
      if (committedGeometry.current !== geometry) return;
      bubbleRef.current?.measureInWindow((left: number, top: number, width: number, height: number) => {
        if (committedGeometry.current !== geometry || width <= 0 || height <= 0) return;
        const size = Math.max(width, height);
        setAnchorLayout((previous) =>
          previous?.left === left && previous.top === top && previous.size === size
            ? previous
            : { left, top, size },
        );
      });
    });
  }, [geometry, isActive, showPlayer]);

  useLayoutEffect(() => {
    committedGeometry.current = geometry;
    if (!isActive) setAnchorLayout(null);
    clampBubble(measureBubble);
    return () => {
      committedGeometry.current = null;
      if (measurementFrame.current !== null) cancelAnimationFrame(measurementFrame.current);
      measurementFrame.current = null;
    };
  }, [clampBubble, geometry, isActive, measureBubble]);

  return (
    <>
      {isActive && (
        <Animated.View
          ref={bubbleRef}
          collapsable={false}
          onLayout={measureBubble}
          style={[
            styles.bubbleWrapper,
            {
              right: bubbleRight,
              bottom: bubbleBottom,
              transform: pan.getTranslateTransform(),
            },
          ]}
          {...panResponder.panHandlers}
        >
          <Animated.View
            style={[styles.bubbleRing, { backgroundColor: colors.primary }, makeRingStyle(ring1)]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.bubbleRing, { backgroundColor: colors.primary }, makeRingStyle(ring2)]}
            pointerEvents="none"
          />
          <TouchableOpacity
            style={[styles.bubble, { backgroundColor: colors.primary }]}
            onPress={handleBubbleTap}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t("tts.player")}
          >
            {playState === "loading" ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <HeadphonesIcon size={22} color={colors.primaryForeground} />
            )}
          </TouchableOpacity>
        </Animated.View>
      )}

      <TTSMiniPlayer
        visible={showPlayer && isActive}
        onClose={() => setShowPlayer(false)}
        anchorLayout={anchorLayout}
        navigationInsets={{ right: railWidth, bottom: bottomInset - insets.bottom + bottomBarHeight }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bubbleWrapper: {
    position: "absolute",
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    zIndex: 9999,
  },
  bubbleRing: {
    position: "absolute",
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    top: 0,
    left: 0,
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 12,
  },
});

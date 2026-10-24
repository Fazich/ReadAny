import {
  BookOpenIcon,
  ClockIcon,
  HeadphonesIcon,
  PauseIcon,
  PlayIcon,
  ScrollTextIcon,
  SquareIcon,
  XIcon,
} from "@/components/ui/Icon";
import { pushRoute } from "@/lib/navigationRef";
import { useReaderStore } from "@/stores/reader-store";
import { useTTSStore } from "@/stores";
import { fontSize, radius, useColors, withOpacity } from "@/styles/theme";
import { eventBus } from "@readany/core/utils/event-bus";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { TTSSleepTimerSheet } from "./TTSSleepTimerSheet";

const BUBBLE_SIZE = 56;

export interface TTSBubbleAnchor {
  left: number;
  top: number;
  size: number;
}

interface TTSMiniPlayerProps {
  visible: boolean;
  onClose: () => void;
  navigationInsets: { right: number; bottom: number };
  anchorLayout: TTSBubbleAnchor | null;
}

export function TTSMiniPlayer({ visible, onClose, anchorLayout, navigationInsets }: TTSMiniPlayerProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const playState = useTTSStore((s) => s.playState);
  const currentBookTitle = useTTSStore((s) => s.currentBookTitle);
  const currentChapterTitle = useTTSStore((s) => s.currentChapterTitle);
  const currentBookId = useTTSStore((s) => s.currentBookId);
  const currentLocationCfi = useTTSStore((s) => s.currentLocationCfi);
  const goToCfiFn = useReaderStore((s) => s.goToCfiFn);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);

  const handleStop = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  const handleJumpToCurrentLocation = useCallback(() => {
    let handled = false;
    if (currentBookId && currentLocationCfi) {
      eventBus.emit("tts:jump-to-current", {
        bookId: currentBookId,
        cfi: currentLocationCfi,
        respond: () => { handled = true; },
      });
    }
    if (!handled && currentLocationCfi && goToCfiFn) {
      goToCfiFn(currentLocationCfi);
      onClose();
      return;
    }
    if (!handled && currentBookId) {
      pushRoute("Reader", { bookId: currentBookId, cfi: currentLocationCfi || undefined });
    }
    onClose();
  }, [currentBookId, currentLocationCfi, goToCfiFn, onClose]);

  const handleOpenLyricsPage = useCallback(() => {
    if (!currentBookId) return;
    let handled = false;
    eventBus.emit("tts:open-lyrics-page", {
      bookId: currentBookId,
      respond: () => { handled = true; },
    });
    if (!handled) {
      pushRoute("Reader", { bookId: currentBookId, openTTS: true });
    }
    onClose();
  }, [currentBookId, onClose]);

  const handlePlayPause = useCallback(() => {
    if (playState === "playing" || playState === "loading") pause();
    else if (playState === "paused") resume();
  }, [playState, pause, resume]);

  const adjustRate = useCallback(
    (delta: number) => {
      const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
      updateConfig({ rate: newRate });
    },
    [config.rate, updateConfig],
  );

  // Pulse animation for the headphones icon when playing
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (playState === "playing") {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    }
    pulseAnim.setValue(1);
  }, [playState, pulseAnim]);

  const statusText =
    playState === "loading" ? t("tts.loading")
    : playState === "playing" ? t("tts.playing")
    : playState === "paused" ? t("tts.paused")
    : t("tts.stopped");

  // Clamp the measured anchor against the current window, safe area, and navigation.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(152);
  const [panelMeasured, setPanelMeasured] = useState(false);
  const [timerSheetVisible, setTimerSheetVisible] = useState(false);
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const anchor = anchorLayout ?? {
    left: 16, top: 120, size: BUBBLE_SIZE,
  };
  // 面板宽度 = 当前安全宽度减两侧必要边距，不再用 320 下限把 panel 顶出小窗口。
  const safeWidth = Math.max(0, windowWidth - insets.left - insets.right - navigationInsets.right);
  const panelWidth = Math.max(0, Math.min(388, safeWidth - 16));
  const left = clamp(
    anchor.left + anchor.size / 2 - panelWidth / 2,
    insets.left,
    insets.left + Math.max(0, safeWidth - panelWidth),
  );
  const safeTop = (insets.top || 12) + 8;
  // 容器高度上限：top + 实际高度 ≤ 当前窗口高度 - insets.bottom - 8。
  const maxPanelHeight = Math.max(0, windowHeight - insets.bottom - navigationInsets.bottom - 8 - safeTop);
  const layoutPanelHeight = Math.min(panelHeight, maxPanelHeight);
  const safeBottom = windowHeight - insets.bottom - navigationInsets.bottom - layoutPanelHeight - 8;
  const aboveTop = anchor.top - layoutPanelHeight - 10;
  const belowTop = anchor.top + anchor.size + 10;
  const canPlaceAbove = aboveTop >= safeTop;
  const maxTop = Math.max(safeTop, safeBottom);
  // 统一 clamp 到有效区间：旧窗口的 anchor.top 不再把 panel 放到屏外。
  const top = clamp(canPlaceAbove ? aboveTop : belowTop, safeTop, maxTop);

  const handlePanelLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height || 0);
    if (nextHeight > 0) {
      if (nextHeight !== panelHeight) setPanelHeight(nextHeight);
      if (!panelMeasured) setPanelMeasured(true);
    }
  }, [panelHeight, panelMeasured]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessible={false} />
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            left,
            top,
            width: panelWidth,
            maxHeight: maxPanelHeight,
            opacity: panelMeasured || !visible ? 1 : 0,
          },
        ]}
        pointerEvents="box-none"
        onLayout={handlePanelLayout}
      >
        {/* 低窗口时内容纵向滚动，控件始终可达 */}
        <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {/* Header row */}
          <View style={styles.header}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <HeadphonesIcon size={18} color={colors.primary} />
            </Animated.View>
            <View style={styles.titleGroup}>
              <Text style={[styles.bookText, { color: colors.foreground }]} numberOfLines={1}>
                {currentBookTitle || t("tts.listeningToBook")}
              </Text>
              {!!currentChapterTitle && (
                <Text style={[styles.chapterText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {currentChapterTitle}
                </Text>
              )}
            </View>
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>{statusText}</Text>
            <TouchableOpacity style={styles.iconBtn} onPress={onClose}
              accessibilityRole="button" accessibilityLabel={t("common.close")}>
              <XIcon size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Controls row：窄窗下横向滚动，按钮始终可达 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.rateBtn, { backgroundColor: colors.muted }]}
              onPress={() => adjustRate(-0.1)}
              accessibilityRole="button"
              accessibilityLabel={t("tts.decreaseRate")}
            >
              <Text style={[styles.rateBtnText, { color: colors.foreground }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.rateValue, { color: colors.mutedForeground }]}>
              {config.rate.toFixed(1)}x
            </Text>
            <TouchableOpacity
              style={[styles.rateBtn, { backgroundColor: colors.muted }]}
              onPress={() => adjustRate(0.1)}
              accessibilityRole="button"
              accessibilityLabel={t("tts.increaseRate")}
            >
              <Text style={[styles.rateBtnText, { color: colors.foreground }]}>+</Text>
            </TouchableOpacity>

            <View style={[styles.dividerV, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={[styles.playBtn, { backgroundColor: colors.primary }]}
              onPress={handlePlayPause}
              disabled={playState === "stopped"}
              accessibilityRole="button"
              accessibilityLabel={
                playState === "playing" || playState === "loading" ? t("tts.pause") : t("tts.play")
              }
            >
              {playState === "playing" || playState === "loading" ? (
                <PauseIcon size={20} color={colors.primaryForeground} />
              ) : (
                <PlayIcon size={20} color={colors.primaryForeground} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: colors.muted }]}
              onPress={handleStop}
              accessibilityRole="button"
              accessibilityLabel={t("tts.stop", "停止")}
            >
              <SquareIcon size={16} color={colors.foreground} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.iconBtn,
                { backgroundColor: sleepTimerEndsAt ? withOpacity(colors.primary, 0.14) : colors.muted },
              ]}
              onPress={() => setTimerSheetVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t("tts.sleepTimer", "定时停止")}
            >
              <ClockIcon size={16} color={sleepTimerEndsAt ? colors.primary : colors.foreground} />
            </TouchableOpacity>

            {!!currentBookId && <View style={[styles.dividerV, { backgroundColor: colors.border }]} />}

            {!!currentBookId && (
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: colors.muted }]}
                onPress={handleJumpToCurrentLocation}
                accessibilityRole="button"
                accessibilityLabel={t("tts.jumpToCurrentLocation")}
              >
                <BookOpenIcon size={16} color={colors.foreground} />
              </TouchableOpacity>
            )}

            {!!currentBookId && (
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: colors.muted }]}
                onPress={handleOpenLyricsPage}
                accessibilityRole="button"
                accessibilityLabel={t("tts.openLyricsPage", "跳到歌词页")}
              >
                <ScrollTextIcon size={16} color={colors.foreground} />
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
        </ScrollView>
      </View>
      <TTSSleepTimerSheet visible={timerSheetVisible} onClose={() => setTimerSheetVisible(false)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    borderRadius: radius.xl,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 20,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  titleGroup: { flex: 1, gap: 2 },
  bookText: { fontSize: fontSize.sm, fontWeight: "600" },
  chapterText: { fontSize: fontSize.xs },
  statusText: { fontSize: fontSize.xs },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  rateBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rateBtnText: { fontSize: 18, fontWeight: "500", lineHeight: 20 },
  rateValue: { fontSize: fontSize.xs, width: 40, textAlign: "center" },
  dividerV: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 2 },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});

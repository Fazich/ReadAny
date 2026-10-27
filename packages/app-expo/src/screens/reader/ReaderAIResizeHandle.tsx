import { useColors } from "@/styles/theme";
import { useLayoutEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { READER_AI_DIVIDER_WIDTH, getReaderAIPanelWidthAfterDrag } from "./reader-ai-layout";

export interface ReaderAIResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  /** 包含窗口宽高及方向，不能包含实时拖拽宽度。 */
  layoutKey: string;
  visible?: boolean;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
  onCancel: () => void;
}

export function ReaderAIResizeHandle({
  width,
  minWidth,
  maxWidth,
  layoutKey,
  visible = true,
  onChange,
  onCommit,
  onCancel,
}: ReaderAIResizeHandleProps) {
  const colors = useColors();
  const propsRef = useRef({
    width,
    minWidth,
    maxWidth,
    layoutKey,
    visible,
    onChange,
    onCommit,
    onCancel,
  });
  propsRef.current = {
    width,
    minWidth,
    maxWidth,
    layoutKey,
    visible,
    onChange,
    onCommit,
    onCancel,
  };
  const gestureRef = useRef<{
    startX: number;
    startWidth: number;
    layoutKey: string;
    minWidth: number;
    maxWidth: number;
  } | null>(null);

  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => propsRef.current.visible,
      onMoveShouldSetPanResponder: () => propsRef.current.visible,
      onPanResponderGrant: (event) => {
        const current = propsRef.current;
        if (!current.visible) return;
        gestureRef.current = {
          startX: event.nativeEvent.pageX,
          startWidth: current.width,
          layoutKey: current.layoutKey,
          minWidth: current.minWidth,
          maxWidth: current.maxWidth,
        };
      },
      onPanResponderMove: (event) => {
        const gesture = gestureRef.current;
        const current = propsRef.current;
        if (!gesture || !current.visible || gesture.layoutKey !== current.layoutKey) return;
        current.onChange(
          getReaderAIPanelWidthAfterDrag(
            gesture.startWidth,
            gesture.startX,
            event.nativeEvent.pageX,
            current.minWidth,
            current.maxWidth,
          ),
        );
      },
      onPanResponderRelease: (event) => {
        const gesture = gestureRef.current;
        gestureRef.current = null;
        const current = propsRef.current;
        if (!gesture || !current.visible || gesture.layoutKey !== current.layoutKey) return;
        const nextWidth = getReaderAIPanelWidthAfterDrag(
          gesture.startWidth,
          gesture.startX,
          event.nativeEvent.pageX,
          current.minWidth,
          current.maxWidth,
        );
        current.onChange(nextWidth);
        current.onCommit(nextWidth);
      },
      onPanResponderTerminate: () => {
        if (!gestureRef.current) return;
        gestureRef.current = null;
        propsRef.current.onCancel();
      },
    }),
  );

  useLayoutEffect(() => {
    const gesture = gestureRef.current;
    if (
      gesture &&
      (!visible ||
        gesture.layoutKey !== layoutKey ||
        gesture.minWidth !== minWidth ||
        gesture.maxWidth !== maxWidth)
    ) {
      gestureRef.current = null;
      propsRef.current.onCancel();
    }
  }, [layoutKey, visible, minWidth, maxWidth]);

  useLayoutEffect(
    () => () => {
      if (!gestureRef.current) return;
      gestureRef.current = null;
      propsRef.current.onCancel();
    },
    [],
  );

  const adjust = (delta: number) => {
    const current = propsRef.current;
    if (!current.visible) return;
    const nextWidth = Math.max(current.minWidth, Math.min(current.width + delta, current.maxWidth));
    current.onChange(nextWidth);
    current.onCommit(nextWidth);
  };

  if (!visible) return null;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="AI 面板宽度"
      accessibilityValue={{ min: minWidth, max: maxWidth, now: width }}
      accessibilityActions={[
        { name: "increment", label: "增加 AI 面板宽度" },
        { name: "decrement", label: "减少 AI 面板宽度" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") adjust(16);
        if (event.nativeEvent.actionName === "decrement") adjust(-16);
      }}
      style={styles.handle}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={[styles.separator, { backgroundColor: colors.border }]} />
      <View
        pointerEvents="none"
        style={[styles.grip, { backgroundColor: colors.mutedForeground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: READER_AI_DIVIDER_WIDTH,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  separator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  grip: {
    width: 3,
    height: 36,
    borderRadius: 2,
  },
});

import { type ReactNode, useCallback, useState } from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** Remaining viewport height (dp) below which empty-state artwork shrinks. */
const COMPACT_MAX_HEIGHT = 440;

interface AdaptiveEmptyStateProps {
  children: (compact: boolean) => ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Scrollable, self-centering empty state that measures its own remaining
 * viewport (toolbar, input, tabs already excluded by the parent layout) and
 * reports a compact flag so callers can shrink decorative artwork.
 */
export function AdaptiveEmptyState({ children, contentContainerStyle }: AdaptiveEmptyStateProps) {
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    if (!Number.isFinite(height) || height <= 0) return;
    setMeasuredHeight((previous) => (previous === height ? previous : height));
  }, []);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
      onLayout={handleLayout}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={Keyboard.dismiss}
      showsVerticalScrollIndicator={false}
    >
      {measuredHeight === null ? null : children(measuredHeight < COMPACT_MAX_HEIGHT)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0, width: "100%" },
  contentContainer: { flexGrow: 1, justifyContent: "center", paddingVertical: 12 },
});

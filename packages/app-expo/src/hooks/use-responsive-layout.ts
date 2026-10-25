import { useCallback, useState } from "react";
import { type LayoutChangeEvent, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { calculateResponsiveLayout } from "./responsive-layout";

export function useResponsiveLayout(containerWidth?: number) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return calculateResponsiveLayout(width, height, containerWidth, insets, fontScale);
}

export function useContentLayout() {
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const layout = useResponsiveLayout(contentWidth ?? 0);
  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (!Number.isFinite(width) || width <= 0) return;
    setContentWidth((previous) => (previous === width ? previous : width));
  }, []);
  return { ...layout, onContentLayout, isContentMeasured: contentWidth !== null };
}

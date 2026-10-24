import { useState } from "react";
import { type LayoutChangeEvent, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { calculateResponsiveLayout } from "./responsive-layout";

export function useResponsiveLayout(containerWidth?: number) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return calculateResponsiveLayout(width, height, containerWidth, insets, fontScale);
}

export function useContentLayout() {
  const [contentWidth, setContentWidth] = useState<number>();
  const layout = useResponsiveLayout(contentWidth);
  const onContentLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setContentWidth((previous) => (previous === width ? previous : width));
  };
  return { ...layout, onContentLayout };
}

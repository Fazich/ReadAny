import { radius, useColors } from "@/styles/theme";
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface SheetShellProps {
  visible: boolean;
  onClose: () => void;
  placement: "bottom" | "center";
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  maxHeight?: number;
  keyboardAware?: boolean;
  backdropColor?: string;
  surfaceStyle?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SheetShell({
  visible,
  onClose,
  placement,
  children,
  header,
  footer,
  maxWidth = 600,
  maxHeight,
  keyboardAware = false,
  backdropColor = "rgba(0,0,0,0.35)",
  surfaceStyle,
  bodyStyle,
  testID,
}: SheetShellProps): React.JSX.Element {
  const colors = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [available, setAvailable] = useState<{ width: number; height: number } | null>(null);
  const onPositionLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) return;
    const width = Math.max(0, layout.width);
    const height = Math.max(0, layout.height);
    setAvailable((previous) =>
      previous?.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);
  const hidden = available !== null && (available.width === 0 || available.height === 0);
  const heightLimit = hidden
    ? 0
    : maxHeight !== undefined && available !== null
      ? Math.max(0, Math.min(maxHeight, available.height))
      : "100%";
  const bottom = placement === "bottom";

  return (
    <Modal
      visible={visible}
      transparent
      animationType={bottom ? "slide" : "fade"}
      onRequestClose={onClose}
      {...(Platform.OS === "android"
        ? { statusBarTranslucent: true, navigationBarTranslucent: true }
        : {})}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        enabled={keyboardAware}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
        <View
          pointerEvents="box-none"
          style={[
            styles.fill,
            {
              paddingTop: insets.top + (bottom ? 12 : 16),
              paddingBottom: bottom ? 0 : insets.bottom + 16,
              paddingLeft: insets.left + (bottom ? 0 : 16),
              paddingRight: insets.right + (bottom ? 0 : 16),
            },
          ]}
        >
          <View
            pointerEvents="box-none"
            onLayout={onPositionLayout}
            style={[styles.position, { justifyContent: bottom ? "flex-end" : "center" }]}
          >
            <View
              testID={testID}
              pointerEvents={hidden ? "none" : "auto"}
              accessibilityViewIsModal
              accessibilityElementsHidden={hidden}
              importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
              style={[
                {
                  backgroundColor: colors.background,
                  ...(bottom
                    ? {
                        borderTopLeftRadius: radius.xxl,
                        borderTopRightRadius: radius.xxl,
                        paddingTop: 8,
                        paddingHorizontal: 20,
                        paddingBottom: Math.max(16, insets.bottom),
                      }
                    : { borderRadius: radius.xxl, padding: 16 }),
                },
                surfaceStyle,
                styles.surface,
                { maxWidth, maxHeight: heightLimit, opacity: hidden ? 0 : 1 },
              ]}
            >
              {header != null && <View style={styles.fixed}>{header}</View>}
              <View style={[styles.body, bodyStyle]}>{children}</View>
              {footer != null && <View style={styles.fixed}>{footer}</View>}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  position: { flex: 1, minHeight: 0, alignItems: "center" },
  surface: { width: "100%", flexShrink: 1, minHeight: 0 },
  body: { flexShrink: 1, minHeight: 0 },
  fixed: { flexShrink: 0 },
});

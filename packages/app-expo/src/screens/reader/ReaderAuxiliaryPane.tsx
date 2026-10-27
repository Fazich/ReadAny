import { useColors } from "@/styles/theme";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

export type ReaderAuxiliaryPanel = "toc" | "notebook" | "search" | "ai";

interface ReaderAuxiliaryPaneProps {
  panel: ReaderAuxiliaryPanel | null;
  docked: boolean;
  width: number;
  windowHeight: number;
  searchPanelHeight: number;
  topInset: number;
  insets: { left: number; right: number; bottom: number };
  onClose: () => void;
  searchContent: ReactNode;
  tocContent: ReactNode;
  notebookContent: ReactNode;
  aiContent: ReactNode;
}

export function ReaderAuxiliaryPane({
  panel,
  docked,
  width,
  windowHeight,
  searchPanelHeight,
  topInset,
  insets,
  onClose,
  searchContent,
  tocContent,
  notebookContent,
  aiContent,
}: ReaderAuxiliaryPaneProps) {
  const colors = useColors();
  return (
    <>
      {!docked && (panel === "toc" || panel === "notebook") && (
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.4)" }]}
          onPress={onClose}
        />
      )}
      <View
        pointerEvents={panel ? "auto" : "none"}
        accessibilityElementsHidden={!panel}
        importantForAccessibility={panel ? "auto" : "no-hide-descendants"}
        style={[
          {
            backgroundColor: colors.card,
            borderLeftWidth: StyleSheet.hairlineWidth,
            borderLeftColor: colors.border,
            paddingTop: docked || panel === "search" ? topInset : 0,
            display: panel !== null ? "flex" : "none",
            overflow: "hidden",
          },
          docked
            ? { width }
            : {
                position: "absolute",
                left: insets.left,
                right: insets.right,
                zIndex: 110,
                ...(panel === "ai"
                  ? { top: 0, bottom: insets.bottom, paddingTop: topInset }
                  : panel === "search"
                    ? { top: 0, height: searchPanelHeight }
                    : { bottom: insets.bottom, height: windowHeight * 0.7 }),
              },
        ]}
      >
        <View style={{ flex: 1, minHeight: 0, display: panel === "search" ? "flex" : "none" }}>
          {searchContent}
        </View>
        <View style={{ flex: 1, minHeight: 0, display: panel === "toc" ? "flex" : "none" }}>
          {tocContent}
        </View>
        <View style={{ flex: 1, minHeight: 0, display: panel === "notebook" ? "flex" : "none" }}>
          {notebookContent}
        </View>
        <View
          style={{ flex: 1, minHeight: 0, display: panel === "ai" ? "flex" : "none" }}
          pointerEvents={panel === "ai" ? "auto" : "none"}
          accessibilityElementsHidden={panel !== "ai"}
          importantForAccessibility={panel === "ai" ? "auto" : "no-hide-descendants"}
        >
          {aiContent}
        </View>
      </View>
    </>
  );
}

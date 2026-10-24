/**
 * Styles for ReaderScreen — aggregated from sub-modules.
 * Keep this file as a single import point for backward compatibility.
 */
import type { ThemeColors } from "@/styles/theme";
import { Dimensions } from "react-native";
import { makeToolbarStyles } from "./styles/reader-base-styles";
import { makeSheetStyles } from "./styles/reader-sheet-styles";
import { makeNoteStyles } from "./styles/reader-note-styles";

export { TOOLTIP_FG, TOOLTIP_MUTED, noteTooltipMdStyles } from "./styles/reader-note-styles";

const SCREEN_HEIGHT = Dimensions.get("window").height;

export const makeStyles = (colors: ThemeColors, windowHeight = SCREEN_HEIGHT) => ({
  ...makeToolbarStyles(colors),
  ...makeSheetStyles(colors, windowHeight),
  ...makeNoteStyles(colors, windowHeight),
});

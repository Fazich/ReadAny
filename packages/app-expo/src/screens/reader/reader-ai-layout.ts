export const READER_AI_SPLIT_MIN_WIDTH = 680;
export const READER_AI_PANEL_MIN_WIDTH = 320;
export const READER_AI_DIVIDER_WIDTH = 24;
export const DEFAULT_READER_AI_PANEL_RATIO = 0.4;

export interface ReaderAISplitLayout {
  readerWidth: number;
  aiWidth: number;
  dividerWidth: number;
  minAiWidth: number;
  maxAiWidth: number;
}

export interface ReaderAISplitLayoutInput {
  /** 已扣除左右安全区后的窗口宽度。 */
  availableWidth: number;
  /** 键盘压缩前的窗口宽高，用于确认横屏。 */
  windowWidth: number;
  windowHeight: number;
  panelRatio: number;
}

export function getReaderAIWindowHeight(
  height: number,
  rawKeyboardHeight: number,
  isAndroid: boolean,
): number {
  const windowHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const keyboardHeight =
    Number.isFinite(rawKeyboardHeight) && rawKeyboardHeight > 0 ? rawKeyboardHeight : 0;
  return windowHeight + (isAndroid ? keyboardHeight : 0);
}

export function normalizeReaderAIPanelRatio(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 && ratio < 1 ? ratio : DEFAULT_READER_AI_PANEL_RATIO;
}

export function clampReaderAIPanelWidth(width: number, availableWidth: number): number {
  if (
    !Number.isFinite(availableWidth) ||
    availableWidth < READER_AI_PANEL_MIN_WIDTH * 2 + READER_AI_DIVIDER_WIDTH
  ) {
    return 0;
  }
  const usableWidth = availableWidth - READER_AI_DIVIDER_WIDTH;
  const maxAiWidth = usableWidth - READER_AI_PANEL_MIN_WIDTH;
  const requestedWidth = Number.isFinite(width)
    ? width
    : usableWidth * DEFAULT_READER_AI_PANEL_RATIO;
  return Math.max(READER_AI_PANEL_MIN_WIDTH, Math.min(requestedWidth, maxAiWidth));
}

export function getReaderAIPanelWidth(availableWidth: number, ratio: number): number {
  const usableWidth = availableWidth - READER_AI_DIVIDER_WIDTH;
  return clampReaderAIPanelWidth(usableWidth * normalizeReaderAIPanelRatio(ratio), availableWidth);
}

export function getReaderAIPanelWidthAfterDrag(
  startWidth: number,
  startX: number,
  currentX: number,
  minWidth: number,
  maxWidth: number,
): number {
  const width = Number.isFinite(startWidth) ? startWidth : minWidth;
  const delta = Number.isFinite(startX) && Number.isFinite(currentX) ? currentX - startX : 0;
  return Math.max(minWidth, Math.min(width - delta, maxWidth));
}

export function getReaderAIPanelRatio(width: number, availableWidth: number): number {
  const usableWidth = availableWidth - READER_AI_DIVIDER_WIDTH;
  if (!Number.isFinite(width) || !Number.isFinite(usableWidth) || usableWidth <= 0) {
    return DEFAULT_READER_AI_PANEL_RATIO;
  }
  return normalizeReaderAIPanelRatio(clampReaderAIPanelWidth(width, availableWidth) / usableWidth);
}

export function getReaderAISplitLayout({
  availableWidth,
  windowWidth,
  windowHeight,
  panelRatio,
}: ReaderAISplitLayoutInput): ReaderAISplitLayout | null {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(windowWidth) ||
    !Number.isFinite(windowHeight) ||
    windowWidth <= 0 ||
    windowHeight <= 0 ||
    windowWidth <= windowHeight ||
    availableWidth < READER_AI_SPLIT_MIN_WIDTH
  ) {
    return null;
  }

  const aiWidth = getReaderAIPanelWidth(availableWidth, panelRatio);
  return {
    readerWidth: availableWidth - READER_AI_DIVIDER_WIDTH - aiWidth,
    aiWidth,
    dividerWidth: READER_AI_DIVIDER_WIDTH,
    minAiWidth: READER_AI_PANEL_MIN_WIDTH,
    maxAiWidth: availableWidth - READER_AI_DIVIDER_WIDTH - READER_AI_PANEL_MIN_WIDTH,
  };
}

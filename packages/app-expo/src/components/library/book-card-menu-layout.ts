export const BOOK_MENU_MAX_WIDTH = 188;
export const BOOK_MENU_MARGIN = 12;
export const BOOK_MENU_ANCHOR_GAP = 8;
export const BOOK_MENU_BORDER_WIDTH = 1;
export const BOOK_MENU_CONTENT_PADDING = 6;

export interface BookMenuLayoutInput {
  anchor: { x: number; y: number; width: number; height: number } | null;
  naturalContentHeight: number | null;
  screenWidth: number;
  screenHeight: number;
  insets: { top: number; right: number; bottom: number; left: number };
}

export function resolveBookMenuLayout({
  anchor,
  naturalContentHeight,
  screenWidth,
  screenHeight,
  insets,
}: BookMenuLayoutInput): {
  left: number;
  top: number;
  width: number;
  height: number;
  ready: boolean;
} {
  if (
    !Number.isFinite(screenWidth) ||
    screenWidth <= 0 ||
    !Number.isFinite(screenHeight) ||
    screenHeight <= 0 ||
    !Object.values(insets).every((value) => Number.isFinite(value) && value >= 0)
  ) {
    return { left: 0, top: 0, width: 0, height: 0, ready: false };
  }
  if (anchor && !Object.values(anchor).every(Number.isFinite)) anchor = null;
  const availableLeft = insets.left + BOOK_MENU_MARGIN;
  const availableRight = screenWidth - insets.right - BOOK_MENU_MARGIN;
  const availableTop = insets.top + BOOK_MENU_MARGIN;
  const availableBottom = screenHeight - insets.bottom - BOOK_MENU_MARGIN;
  const width = Math.max(0, Math.min(BOOK_MENU_MAX_WIDTH, availableRight - availableLeft));
  const availableHeight = Math.max(0, availableBottom - availableTop);
  const measured =
    naturalContentHeight !== null &&
    Number.isFinite(naturalContentHeight) &&
    naturalContentHeight > 0;
  const height = measured
    ? Math.min(naturalContentHeight + 2 * BOOK_MENU_BORDER_WIDTH, availableHeight)
    : availableHeight;
  const maxLeft = Math.max(availableLeft, availableRight - width);
  const maxTop = Math.max(availableTop, availableBottom - height);
  const preferredLeft = anchor ? anchor.x + anchor.width - width : maxLeft;
  const belowAnchorTop = anchor ? anchor.y + anchor.height + BOOK_MENU_ANCHOR_GAP : 0;
  const preferredTop = anchor
    ? belowAnchorTop + height <= availableBottom
      ? belowAnchorTop
      : anchor.y - height - BOOK_MENU_ANCHOR_GAP
    : availableTop + (availableHeight - height) / 2;

  return {
    left: Math.min(Math.max(preferredLeft, availableLeft), maxLeft),
    top: Math.min(Math.max(preferredTop, availableTop), maxTop),
    width,
    height,
    ready: measured && width > 0 && availableHeight > 2 * BOOK_MENU_BORDER_WIDTH,
  };
}

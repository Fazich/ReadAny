export const NAVIGATION_RAIL_WIDTH = 84;

export function getNavigationBottomInset(inset: number, isAndroid: boolean, isTablet: boolean) {
  return isAndroid ? Math.max(inset, inset > 0 ? 28 : isTablet ? 32 : 40) : inset;
}

export function calculateResponsiveLayout(
  width: number,
  height: number,
  containerWidth?: number,
  insets = { left: 0, right: 0 },
  fontScale = 1,
) {
  const safeWidth = Math.max(0, width - insets.left - insets.right);
  const horizontalPadding = safeWidth >= 960 ? 28 : safeWidth >= 600 ? 20 : 16;
  // 传入的是已经扣除导航、安全区和页面留白的内容宽度。
  const contentWidth = Math.max(0, containerWidth ?? safeWidth - horizontalPadding * 2);
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const isTablet = shortestSide >= 768 || (shortestSide >= 600 && longestSide >= 960);
  const isLandscape = width > height;
  const contentMaxWidth = 1260;

  return {
    width,
    height,
    shortestSide,
    longestSide,
    isLandscape,
    isTablet,
    isTabletLandscape: isTablet && isLandscape,
    isLargeTablet: isTablet && longestSide >= 1280,
    safeWidth,
    useNavigationRail: isLandscape,
    horizontalPadding,
    contentWidth,
    contentMaxWidth,
    centeredContentWidth: Math.min(contentWidth, contentMaxWidth),
    supportsSplitView: contentWidth >= 680,
    supportsProfileSplit: contentWidth >= 568,
    statsColumns: contentWidth >= 560 * Math.min(fontScale, 1.5) ? 4 : 2,
    supportsStatsSplit: contentWidth >= 840,
    sidebarWidth: Math.min(280, Math.max(224, contentWidth * 0.28)),
  };
}

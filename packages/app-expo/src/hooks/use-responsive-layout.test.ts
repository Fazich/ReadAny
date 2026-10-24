import { describe, expect, it } from "vitest";
import { calculateResponsiveLayout, getNavigationBottomInset } from "./responsive-layout";

describe("按实际内容宽度适配", () => {
  it("导航和浮层使用相同的Android安全区兜底", () => {
    expect(getNavigationBottomInset(0, true, false)).toBe(40);
    expect(getNavigationBottomInset(0, true, true)).toBe(32);
    expect(getNavigationBottomInset(16, true, false)).toBe(28);
    expect(getNavigationBottomInset(48, true, false)).toBe(48);
    expect(getNavigationBottomInset(0, false, false)).toBe(0);
  });
  it("导航随窗口方向切换", () => {
    expect.soft(calculateResponsiveLayout(1024, 768).useNavigationRail).toBe(true);
    expect.soft(calculateResponsiveLayout(768, 1024).useNavigationRail).toBe(false);
    expect.soft(calculateResponsiveLayout(599, 390).useNavigationRail).toBe(true);
    expect.soft(calculateResponsiveLayout(840, 840).useNavigationRail).toBe(false);
    expect.soft(calculateResponsiveLayout(0, 0).useNavigationRail).toBe(false);
    expect
      .soft(calculateResponsiveLayout(920, 900, undefined, { left: 30, right: 30 }).useNavigationRail)
      .toBe(true);
    expect.soft(calculateResponsiveLayout(1024, 768, 400).useNavigationRail).toBe(true);
  });

  it("700dp窗口给我的页分栏，但AI仍使用抽屉", () => {
    const layout = calculateResponsiveLayout(700, 700, 700 - 84 - 40);
    expect(layout.supportsProfileSplit).toBe(true);
    expect(layout.statsColumns).toBe(4);
    expect(layout.supportsSplitView).toBe(false);
    expect(layout.contentWidth).toBe(576);
    expect(layout.width).toBe(700);
  });

  it("容器宽度不会重复扣除安全区和留白", () => {
    const layout = calculateResponsiveLayout(900, 600, 680, { left: 24, right: 24 });
    expect(layout.supportsSplitView).toBe(true);
    expect(calculateResponsiveLayout(900, 600, 679).supportsSplitView).toBe(false);
    expect(layout.centeredContentWidth).toBe(680);
    expect(calculateResponsiveLayout(1280, 800, 840).supportsStatsSplit).toBe(true);
  });

  it("大字号减少统计列数，空尺寸不产生负宽度", () => {
    expect(calculateResponsiveLayout(700, 700, 576, undefined, 1.5).statsColumns).toBe(2);
    expect(calculateResponsiveLayout(0, 0).centeredContentWidth).toBe(0);
  });
});

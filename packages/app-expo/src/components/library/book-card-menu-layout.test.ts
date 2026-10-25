import { describe, expect, it } from "vitest";
import { type BookMenuLayoutInput, resolveBookMenuLayout } from "./book-card-menu-layout";

const base = {
  screenWidth: 320,
  screenHeight: 220,
  insets: { top: 24, bottom: 16, left: 0, right: 0 },
  naturalContentHeight: 60,
  anchor: { x: 240, y: 40, width: 40, height: 20 },
} satisfies BookMenuLayoutInput;

function expectInside(input: BookMenuLayoutInput) {
  const layout = resolveBookMenuLayout(input);
  expect(layout.width).toBeGreaterThanOrEqual(0);
  expect(layout.height).toBeGreaterThanOrEqual(0);
  expect(layout.left).toBeGreaterThanOrEqual(input.insets.left + 12);
  expect(layout.left + layout.width).toBeLessThanOrEqual(
    input.screenWidth - input.insets.right - 12,
  );
  expect(layout.top).toBeGreaterThanOrEqual(input.insets.top + 12);
  expect(layout.top + layout.height).toBeLessThanOrEqual(
    input.screenHeight - input.insets.bottom - 12,
  );
  return layout;
}

describe("book card menu layout", () => {
  it("clips tall natural content to the short window's safe rectangle", () => {
    const layout = expectInside({
      ...base,
      naturalContentHeight: 300,
      anchor: { x: 240, y: 180, width: 40, height: 20 },
    });
    expect(layout).toEqual({ left: 92, top: 36, width: 188, height: 156, ready: true });
    expect(layout.top + layout.height).toBe(192);
  });

  it("prefers below the anchor and flips above when below does not fit", () => {
    const below = expectInside(base);
    expect(below).toEqual({ left: 92, top: 68, width: 188, height: 62, ready: true });
    expect(below.left + below.width).toBe(base.anchor.x + base.anchor.width);
    expect(expectInside({ ...base, anchor: { ...base.anchor, y: 150 } }).top).toBe(80);
  });

  it("centers vertically and aligns right without an anchor", () => {
    expect(expectInside({ ...base, anchor: null })).toEqual({
      left: 120,
      top: 83,
      width: 188,
      height: 62,
      ready: true,
    });
  });

  it("repositions and clamps with the same measured content after height changes", () => {
    const input = {
      ...base,
      naturalContentHeight: 300,
      anchor: { x: 240, y: 180, width: 40, height: 20 },
    };
    const tall = expectInside({ ...input, screenHeight: 600 });
    const short = expectInside(input);
    expect(tall.height).toBe(302);
    expect(tall.top).toBe(208);
    expect(short.height).toBe(156);
    expect(short.top).toBe(36);
  });

  it("uses updated natural content height when positioning", () => {
    const anchor = { x: 240, y: 150, width: 40, height: 20 };
    const before = expectInside({ ...base, anchor });
    const after = expectInside({ ...base, anchor, naturalContentHeight: 100 });
    expect(before.height).toBe(62);
    expect(before.top).toBe(80);
    expect(after.height).toBe(102);
    expect(after.top).toBe(40);
  });

  it.each([null, Number.NaN, 0, -1, Number.POSITIVE_INFINITY])(
    "keeps unknown or invalid natural height %s unready",
    (naturalContentHeight) => {
      const layout = expectInside({ ...base, naturalContentHeight });
      expect(layout.ready).toBe(false);
    },
  );

  it.each([
    { screenWidth: 0 },
    { screenWidth: Number.NaN },
    { screenWidth: Number.POSITIVE_INFINITY },
    { screenWidth: -1 },
    { screenHeight: Number.NaN },
    { screenHeight: Number.NEGATIVE_INFINITY },
    { screenHeight: 65 },
    { screenHeight: 66 },
    { screenHeight: 0 },
  ])("rejects unusable space without negative dimensions: %o", (dimensions) => {
    const layout = resolveBookMenuLayout({ ...base, ...dimensions });
    expect(layout.ready).toBe(false);
    expect(
      Object.values(layout)
        .filter((value) => typeof value === "number")
        .every(Number.isFinite),
    ).toBe(true);
    expect(layout.width).toBeGreaterThanOrEqual(0);
    expect(layout.height).toBeGreaterThanOrEqual(0);
  });

  it("keeps invalid safe-area coordinates unready with finite geometry", () => {
    const layout = resolveBookMenuLayout({
      ...base,
      insets: { ...base.insets, left: Number.NaN },
    });
    expect(layout).toEqual({ left: 0, top: 0, width: 0, height: 0, ready: false });
  });

  it("uses unanchored placement when anchor coordinates are invalid", () => {
    expect(
      resolveBookMenuLayout({
        ...base,
        anchor: { ...base.anchor, y: Number.NaN },
      }),
    ).toEqual(resolveBookMenuLayout({ ...base, anchor: null }));
  });

  it.each([
    { x: -100, y: -100, width: 20, height: 20 },
    { x: 500, y: 500, width: 20, height: 20 },
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 300, y: 200, width: 20, height: 20 },
  ])("clamps corner and out-of-bounds anchors: %o", (anchor) => {
    expectInside({ ...base, anchor });
  });

  it("respects asymmetric horizontal safe insets", () => {
    const input = { ...base, insets: { ...base.insets, left: 44, right: 8 } };
    const right = expectInside(input);
    expect(right.left).toBe(92);
    const left = expectInside({ ...input, anchor: { x: 0, y: 40, width: 10, height: 20 } });
    expect(left.left).toBe(56);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createLibraryGridAnchorRestorer } from "./library-grid-anchor";

const keys = Array.from({ length: 240 }, (_, index) => `book-${index}`);

function setup(index = 195) {
  const scroll = { toRow: vi.fn(), toOffset: vi.fn() };
  const restorer = createLibraryGridAnchorRestorer(scroll);
  const initial = Symbol("initial");
  restorer.updateLayout(initial, keys, 3);
  // Viewability order is not an anchor contract; use the smallest flat index.
  restorer.onViewable(initial, [
    { key: keys[index + 1], index: index + 1 },
    { key: keys[index], index },
  ]);
  const next = Symbol("next");
  return { scroll, restorer, initial, next };
}

describe("library grid anchor restoration", () => {
  it("uses the measured target row top instead of an unrelated row height", () => {
    const { scroll, restorer, next } = setup(12);
    restorer.updateLayout(next, keys, 4);
    restorer.onRowLayout(next, 0, 4, 230);
    restorer.restore(next);
    expect(scroll.toRow).toHaveBeenLastCalledWith(3);
    expect(scroll.toOffset).not.toHaveBeenCalled();
    restorer.onRowLayout(next, 3, 594, 230);
    restorer.restore(next);
    expect(scroll.toOffset.mock.calls).toEqual([[594]]);
    restorer.onViewable(next, [{ key: keys[12], index: 12 }]);
    restorer.onRowLayout(next, 8, 1700, 180);
    restorer.restore(next);
    expect(scroll.toOffset.mock.calls).toEqual([[594]]);
  });

  it.each([
    [5, 39, 8024],
    [6, 32, 6591],
    [8, 24, 4994],
  ])("requests row %i-column target and corrects an unmeasured-index estimate", (columns, row, y) => {
    const { scroll, restorer, next } = setup();
    restorer.updateLayout(next, keys, columns);
    restorer.restore(next);
    expect(scroll.toRow).toHaveBeenLastCalledWith(row);
    restorer.onIndexFailed(next, row, 200);
    expect(scroll.toOffset).toHaveBeenLastCalledWith(row * 200);
    restorer.onViewable(next, [{ key: keys[0], index: 0 }]);
    restorer.restore(next);
    expect(scroll.toRow).toHaveBeenLastCalledWith(row);
    restorer.onRowLayout(next, row, y, 220);
    restorer.restore(next);
    expect(scroll.toOffset).toHaveBeenLastCalledWith(y);
    restorer.onViewable(next, [{ key: keys[195], index: 195 }]);
    const completedCalls = scroll.toOffset.mock.calls.length;
    restorer.onContentSize(next, 20000);
    restorer.restore(next);
    expect(scroll.toOffset).toHaveBeenCalledTimes(completedCalls);
  });

  it("keeps the captured key through 3→5→3 and rejects stale callbacks", () => {
    const { scroll, restorer, initial, next } = setup();
    restorer.updateLayout(next, keys, 5);
    restorer.onViewable(next, [{ key: keys[0], index: 0 }]);
    const final = Symbol("final");
    restorer.updateLayout(final, keys, 3);
    restorer.onRowLayout(next, 39, 8024, 220);
    restorer.onIndexFailed(initial, 65, 210);
    restorer.restore(next);
    expect(scroll.toOffset).not.toHaveBeenCalled();
    restorer.restore(final);
    expect(scroll.toRow).toHaveBeenLastCalledWith(65);
    restorer.onRowLayout(final, 65, 13594, 240);
    restorer.restore(final);
    restorer.onViewable(final, [{ key: keys[195], index: 195 }]);
    expect(scroll.toOffset.mock.calls).toEqual([[13594]]);
    restorer.restore(final);
    expect(scroll.toOffset).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "empty", "drag"])("cancels a pending restore on %s", (reason) => {
    const { scroll, restorer, next } = setup();
    restorer.updateLayout(next, keys, 5);
    if (reason === "drag") restorer.cancel();
    else restorer.updateLayout(next, reason === "empty" ? [] : keys.filter((key) => key !== keys[195]), 5);
    restorer.onRowLayout(next, 39, 8024, 220);
    restorer.onIndexFailed(next, 39, 200);
    restorer.restore(next);
    expect(scroll.toOffset).not.toHaveBeenCalled();
    expect(scroll.toRow).not.toHaveBeenCalled();
  });

  it("does not scroll first layout or ordinary data updates", () => {
    const { scroll, restorer, initial, next } = setup();
    restorer.onRowLayout(initial, 65, 13594, 220);
    restorer.restore(initial);
    restorer.updateLayout(next, [...keys].reverse(), 3);
    restorer.restore(next);
    expect(scroll.toOffset).not.toHaveBeenCalled();
    expect(scroll.toRow).not.toHaveBeenCalled();
  });

  it("retains measurements and visibility for an unchanged key sequence", () => {
    const { scroll, restorer, next } = setup();
    restorer.updateLayout(next, keys, 5);
    restorer.onRowLayout(next, 39, 8024, 220);
    restorer.onViewable(next, [{ key: keys[195], index: 195 }]);
    const dataUpdate = Symbol("new-data-object");
    restorer.updateLayout(dataUpdate, [...keys], 5);
    restorer.restore(dataUpdate);
    expect(scroll.toOffset.mock.calls).toEqual([[8024]]);
    restorer.onContentSize(dataUpdate, 20000);
    restorer.restore(dataUpdate);
    expect(scroll.toOffset).toHaveBeenCalledTimes(1);
  });

  it("retries the same actual position after content growth and a changed row top", () => {
    const { scroll, restorer, next } = setup();
    restorer.updateLayout(next, keys, 5);
    restorer.onContentSize(next, 1000);
    restorer.onRowLayout(next, 39, 8024, 220);
    restorer.restore(next);
    restorer.onRowLayout(next, 39, 8024, 220);
    restorer.restore(next);
    expect(scroll.toOffset.mock.calls).toEqual([[8024]]);
    restorer.onContentSize(next, 12000);
    restorer.restore(next);
    restorer.onRowLayout(next, 39, 8120, 220);
    restorer.restore(next);
    expect(scroll.toOffset.mock.calls).toEqual([[8024], [8024], [8120]]);
    restorer.onViewable(next, [{ key: keys[195], index: 195 }]);
  });

  it("invalidates coordinates on viewport width changes without capturing a new anchor", () => {
    const { scroll, restorer, next } = setup();
    restorer.updateLayout(next, keys, 5);
    restorer.onViewportLayout(next, 800);
    restorer.onRowLayout(next, 39, 8024, 220);
    restorer.onViewportLayout(next, 780);
    restorer.restore(next);
    expect(scroll.toOffset).not.toHaveBeenCalled();
    expect(scroll.toRow).toHaveBeenLastCalledWith(39);
    restorer.onRowLayout(next, 39, 8200, 230);
    restorer.restore(next);
    restorer.onViewable(next, [{ key: keys[195], index: 195 }]);
    restorer.onViewportLayout(next, 760);
    restorer.onRowLayout(next, 39, 8400, 240);
    restorer.restore(next);
    expect(scroll.toOffset.mock.calls).toEqual([[8200]]);
  });

  it("deduplicates estimated offsets and accepts synchronous actual-position visibility", () => {
    const { scroll, restorer, next } = setup();
    restorer.updateLayout(next, keys, 5);
    restorer.onIndexFailed(next, 39, 200);
    restorer.onIndexFailed(next, 39, 200);
    expect(scroll.toOffset.mock.calls).toEqual([[7800]]);
    scroll.toOffset.mockImplementation(() => {
      restorer.onViewable(next, [{ key: keys[195], index: 195 }]);
    });
    restorer.onRowLayout(next, 39, 8024, 220);
    restorer.restore(next);
    restorer.onContentSize(next, 12000);
    restorer.restore(next);
    expect(scroll.toOffset.mock.calls).toEqual([[7800], [8024]]);
  });
});

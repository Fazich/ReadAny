import type { Book, BookGroup } from "@readany/core/types";

export type LibraryGridItem =
  | { type: "group"; group: BookGroup; books: Book[] }
  | { type: "book"; book: Book };

export function libraryGridItemKey(item: LibraryGridItem): string {
  return item.type === "group" ? `group-${item.group.id}` : item.book.id;
}

type VisibleItem = { key: string; index: number | null };

export interface LibraryGridAnchorRestorer {
  updateLayout(generation: symbol, keys: readonly string[], columns: number): void;
  onViewable(generation: symbol, items: readonly VisibleItem[]): void;
  onRowLayout(generation: symbol, rowIndex: number, y: number, height: number): void;
  onViewportLayout(generation: symbol, width: number): void;
  onContentSize(generation: symbol, height: number): void;
  restore(generation: symbol): void;
  onIndexFailed(generation: symbol, rowIndex: number, averageItemLength: number): void;
  cancel(): void;
}

export function createLibraryGridAnchorRestorer(scroll: {
  toRow(index: number): void;
  toOffset(offset: number): void;
}): LibraryGridAnchorRestorer {
  let generation: symbol | null = null;
  let keys: readonly string[] = [];
  let columns = 0;
  const rows = new Map<number, { y: number; height: number }>();
  let visible: readonly VisibleItem[] = [];
  let visibleAnchor: string | null = null;
  let pending: string | null = null;
  let requestedActualPosition = false;
  let lastOffset: { value: number; actual: boolean } | null = null;
  let viewportWidth: number | null = null;
  let contentHeight: number | null = null;

  function resetPosition() {
    requestedActualPosition = false;
    lastOffset = null;
  }

  function cancel() {
    pending = null;
    resetPosition();
  }

  function finishIfVisible() {
    if (pending && requestedActualPosition && visible.some((item) => item.key === pending)) {
      visibleAnchor = pending;
      cancel();
    }
  }

  return {
    updateLayout(nextGeneration: symbol, nextKeys: readonly string[], nextColumns: number) {
      const columnsChanged = columns !== nextColumns;
      const keysChanged =
        keys.length !== nextKeys.length || keys.some((key, index) => key !== nextKeys[index]);
      if (columns > 0 && columnsChanged) pending ??= visibleAnchor;
      generation = nextGeneration;
      keys = nextKeys;
      columns = nextColumns;
      if (columnsChanged || keysChanged) {
        rows.clear();
        visible = [];
        contentHeight = null;
        resetPosition();
      }
      if (pending && !keys.includes(pending)) cancel();
      if (visibleAnchor && !keys.includes(visibleAnchor)) visibleAnchor = null;
    },

    onViewable(token: symbol, items: readonly VisibleItem[]) {
      if (token !== generation) return;
      visible = items;
      if (pending) {
        finishIfVisible();
        return;
      }
      let first: VisibleItem | undefined;
      for (const item of items) {
        if (item.index !== null && (!first || item.index < (first.index ?? Infinity))) first = item;
      }
      if (first) visibleAnchor = first.key;
    },

    onRowLayout(token: symbol, rowIndex: number, y: number, height: number) {
      if (token !== generation) return;
      const previous = rows.get(rowIndex);
      rows.set(rowIndex, { y, height });
      if (pending && rowIndex === Math.floor(keys.indexOf(pending) / columns) && previous?.y !== y) {
        resetPosition();
      }
    },

    onViewportLayout(token: symbol, width: number) {
      if (token !== generation) return;
      if (viewportWidth !== null && viewportWidth !== width) {
        rows.clear();
        resetPosition();
      }
      viewportWidth = width;
    },

    onContentSize(token: symbol, height: number) {
      if (token !== generation || contentHeight === height) return;
      contentHeight = height;
      resetPosition();
    },

    restore(token: symbol) {
      if (token !== generation || !pending) return;
      const index = keys.indexOf(pending);
      if (index < 0) {
        cancel();
        return;
      }
      const rowIndex = Math.floor(index / columns);
      const row = rows.get(rowIndex);
      if (!row) {
        scroll.toRow(rowIndex);
        return;
      }
      if (!lastOffset?.actual || lastOffset.value !== row.y) {
        lastOffset = { value: row.y, actual: true };
        // Native scroll ports may synchronously publish viewability.
        requestedActualPosition = true;
        scroll.toOffset(row.y);
      }
      finishIfVisible();
    },

    onIndexFailed(token: symbol, rowIndex: number, averageItemLength: number) {
      if (
        token !== generation ||
        !pending ||
        rowIndex !== Math.floor(keys.indexOf(pending) / columns)
      ) return;
      const offset = Math.max(0, rowIndex * averageItemLength);
      requestedActualPosition = false;
      if (lastOffset?.actual === false && lastOffset.value === offset) return;
      lastOffset = { value: offset, actual: false };
      scroll.toOffset(offset);
    },

    cancel,
  };
}

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { type CellRendererProps, FlatList, type FlatListProps, View } from "react-native";
import {
  createLibraryGridAnchorRestorer,
  type LibraryGridAnchorRestorer,
  type LibraryGridItem,
  libraryGridItemKey,
} from "./library-grid-anchor";

const GridContext = createContext<{
  restorer: LibraryGridAnchorRestorer;
  generation: symbol;
  scheduleRestore(generation: symbol): void;
} | null>(null);

function LibraryGridCell({
  index,
  style,
  onFocusCapture,
  onLayout,
  children,
}: CellRendererProps<LibraryGridItem>) {
  const grid = useContext(GridContext);
  return (
    <View
      style={style}
      {...{ onFocusCapture }}
      onLayout={(event) => {
        onLayout?.(event);
        if (!grid) return;
        const { y, height } = event.nativeEvent.layout;
        grid.restorer.onRowLayout(grid.generation, index, y, height);
        grid.scheduleRestore(grid.generation);
      }}
    >
      {children}
    </View>
  );
}

type LibraryGridProps = Pick<
  FlatListProps<LibraryGridItem>,
  "renderItem" | "extraData" | "columnWrapperStyle" | "contentContainerStyle"
> & { data: readonly LibraryGridItem[]; numColumns: number };

export function LibraryGrid({ data, numColumns, ...props }: LibraryGridProps) {
  const list = useRef<FlatList<LibraryGridItem>>(null);
  const restorer = useMemo(
    () =>
      createLibraryGridAnchorRestorer({
        toRow: (index) => list.current?.scrollToIndex({ index, animated: false, viewPosition: 0 }),
        toOffset: (offset) => list.current?.scrollToOffset({ offset, animated: false }),
      }),
    [],
  );
  const generation = useMemo(() => Symbol("library-grid-layout"), [data, numColumns]);
  const committedGeneration = useRef<symbol | null>(null);
  const restoreFrame = useRef<number | null>(null);
  const scheduleRestore = useCallback(
    (token: symbol) => {
      if (token !== committedGeneration.current || restoreFrame.current !== null) return;
      restoreFrame.current = requestAnimationFrame(() => {
        restoreFrame.current = null;
        if (token === committedGeneration.current) restorer.restore(token);
      });
    },
    [restorer],
  );

  useLayoutEffect(() => {
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = null;
    committedGeneration.current = generation;
    restorer.updateLayout(generation, data.map(libraryGridItemKey), numColumns);
  }, [data, generation, numColumns, restorer]);

  useLayoutEffect(
    () => () => {
      committedGeneration.current = null;
      if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = null;
      restorer.cancel();
      restorer.updateLayout(Symbol("unmounted-library-grid"), [], 1);
    },
    [restorer],
  );

  const context = useMemo(
    () => ({ restorer, generation, scheduleRestore }),
    [restorer, generation, scheduleRestore],
  );

  return (
    <GridContext.Provider value={context}>
      <FlatList
        {...props}
        ref={list}
        key={`library-grid-${numColumns}`}
        data={data}
        numColumns={numColumns}
        keyExtractor={libraryGridItemKey}
        CellRendererComponent={LibraryGridCell}
        onLayout={(event) => {
          restorer.onViewportLayout(generation, event.nativeEvent.layout.width);
          scheduleRestore(generation);
        }}
        onViewableItemsChanged={({ viewableItems }) => {
          restorer.onViewable(generation, viewableItems);
        }}
        onContentSizeChange={(_, height) => {
          restorer.onContentSize(generation, height);
          scheduleRestore(generation);
        }}
        onScroll={() => scheduleRestore(generation)}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          restorer.onIndexFailed(generation, index, averageItemLength);
        }}
        onScrollBeginDrag={() => restorer.cancel()}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </GridContext.Provider>
  );
}

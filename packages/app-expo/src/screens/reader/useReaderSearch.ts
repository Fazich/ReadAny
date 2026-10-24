import type { ReaderSearchMatch } from "@/hooks/use-reader-bridge";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ReaderSearchBridge {
  search: (query: string, requestId: string) => void;
  clearSearch: (requestId: string) => void;
  navigateSearch: (index: number, requestId: string) => void;
}

export interface UseReaderSearchOptions {
  bookId: string;
  currentCfi: string;
  bridge: ReaderSearchBridge;
}

export function useReaderSearch({ bookId, currentCfi, bridge }: UseReaderSearchOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ReaderSearchMatch[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchStartCfi, setSearchStartCfi] = useState<string | null>(null);
  const latest = useRef({ bridge, currentCfi });
  latest.current = { bridge, currentCfi };
  const session = useRef(`search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const revision = useRef(0);
  const requestId = useRef("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidate = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    requestId.current = `${session.current}:${++revision.current}`;
    latest.current.bridge.clearSearch(requestId.current);
    return requestId.current;
  }, []);

  const closeSearch = useCallback(() => {
    invalidate();
    setSearchQuery("");
    setSearchResults([]);
    setSearchIndex(0);
    setIsSearching(false);
    setSearchError(null);
    setSearchStartCfi(null);
  }, [invalidate]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 换书时重置查询并作废上一书籍的回传。
  useEffect(() => {
    closeSearch();
    return () => {
      invalidate();
    };
  }, [bookId, closeSearch, invalidate]);

  const handleSearchInput = useCallback(
    (query: string) => {
      // 输入变化即作废旧任务，不能等到 debounce 结束才隔离旧回传。
      const id = invalidate();
      const trimmed = query.trim();
      setSearchQuery(query);
      setSearchResults([]);
      setSearchIndex(0);
      setSearchError(null);
      setIsSearching(Boolean(trimmed));
      if (!trimmed) return;
      setSearchStartCfi((previous) => previous || latest.current.currentCfi || null);
      debounce.current = setTimeout(() => {
        latest.current.bridge.search(trimmed, id);
      }, 300);
    },
    [invalidate],
  );

  const selectSearchResult = useCallback(
    (index: number) => {
      if (index < 0 || index >= searchResults.length) return;
      setSearchIndex(index);
      latest.current.bridge.navigateSearch(index, requestId.current);
    },
    [searchResults.length],
  );

  const navigateSearch = useCallback(
    (direction: "prev" | "next") => {
      if (!searchResults.length) return;
      selectSearchResult(
        (searchIndex + (direction === "next" ? 1 : -1) + searchResults.length) %
          searchResults.length,
      );
    },
    [searchIndex, searchResults.length, selectSearchResult],
  );

  const onSearchResult = useCallback((index: number, _count: number, id: string) => {
    if (id === requestId.current) setSearchIndex(index);
  }, []);

  const onSearchComplete = useCallback(
    (_: number, results: ReaderSearchMatch[], id: string, error?: string) => {
      if (id !== requestId.current) return;
      setSearchResults(results);
      setSearchError(error || null);
      setIsSearching(false);
    },
    [],
  );

  return {
    searchQuery,
    searchResults,
    searchResultCount: searchResults.length,
    searchIndex,
    isSearching,
    searchError,
    searchStartCfi,
    handleSearchInput,
    navigateSearch,
    selectSearchResult,
    closeSearch,
    onSearchResult,
    onSearchComplete,
  };
}

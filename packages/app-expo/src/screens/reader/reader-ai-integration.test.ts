import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { transformSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Element {
  type: unknown;
  key?: string | number;
  props: Record<string, unknown>;
}

interface HookSlot {
  value: unknown;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}

type Component = (props: Record<string, unknown>) => Element;
type BridgeCallbacks = Record<string, (...args: never[]) => unknown>;

// 仅调度 React Hook；状态、入口和引用逻辑均来自真实 ReaderScreen。
function createHooks() {
  const slots: HookSlot[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  let dirty = false;
  const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      slots[index] ??= {
        value: typeof initial === "function" ? (initial as () => T)() : initial,
      };
      const slot = slots[index];
      return [
        slot.value as T,
        (next: T | ((previous: T) => T)) => {
          const value =
            typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
          if (!Object.is(slot.value, value)) {
            slot.value = value;
            dirty = true;
          }
        },
      ] as const;
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      slots[index] ??= { value: { current: initial } };
      return slots[index].value as { current: T };
    },
    useMemo<T>(create: () => T, dependencies?: readonly unknown[]) {
      const index = cursor++;
      if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) {
        slots[index] = { value: create(), dependencies };
      }
      return slots[index].value as T;
    },
    useCallback<T>(callback: T, dependencies?: readonly unknown[]) {
      return hooks.useMemo(() => callback, dependencies);
    },
    useEffect(effect: () => undefined | (() => void), dependencies?: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && sameDependencies(previous.dependencies, dependencies)) return;
      const slot = { value: undefined, dependencies, cleanup: previous?.cleanup };
      slots[index] = slot;
      effects.push(() => {
        slot.cleanup?.();
        const cleanup = effect();
        slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    },
  };
  return {
    hooks,
    begin() {
      cursor = 0;
      dirty = false;
    },
    flush() {
      for (const effect of effects.splice(0)) effect();
      return dirty;
    },
    dispose() {
      for (const slot of [...slots].reverse()) slot.cleanup?.();
    },
  };
}

const jsx = (type: unknown, props: Element["props"], key?: Element["key"]): Element => ({
  type,
  props,
  key,
});

// esbuild 只转换语法；不重写源码、不摘取业务函数、不以字符串断言替代执行。
function loadModule(path: string, modules: Record<string, unknown>): Record<string, unknown> {
  const source = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
    loader: path.endsWith("tsx") ? "tsx" : "ts",
    format: "cjs",
    jsx: "automatic",
  }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected Reader test import: ${name}`);
      return modules[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}

function createStore<T>(state: T) {
  return Object.assign((selector?: (value: T) => unknown) => (selector ? selector(state) : state), {
    getState: () => state,
  });
}

function invoke(element: Element, prop: string, ...args: unknown[]) {
  const callback = element.props[prop];
  if (typeof callback !== "function") throw new Error(`Missing callback: ${prop}`);
  return callback(...args);
}

function setup() {
  const scheduler = createHooks();
  const dimensions = { width: 1000, height: 800, fontScale: 1 };
  const keyboard = { isVisible: false, rawHeight: 0, height: 0 };
  const focus = { current: true };
  const navigation = { navigate: vi.fn(), setParams: vi.fn(), reset: vi.fn(), goBack: vi.fn() };
  const openMobileBook = vi.fn().mockResolvedValue(undefined);
  const settings = {
    readSettings: {
      fontSize: 18,
      volumeButtonsPageTurn: true,
      showTopTitleProgress: true,
      showBottomTimeBattery: true,
    },
    updateReadSettings: vi.fn(),
    translationConfig: {},
    aiConfig: {},
    readerAiPanelRatio: 0.38,
    setReaderAiPanelRatio: vi.fn(),
  };
  const book = {
    id: "current-book",
    filePath: "books/current.epub",
    format: "epub",
    meta: { title: "当前书籍", author: "作者" },
  };
  const useFontStore = createStore({ fonts: [], selectedFontId: null });
  const useLibraryStore = createStore({ books: [book], updateBook: vi.fn() });
  const t = (key: string) => key;
  const bridge = {
    webViewRef: { current: { injectJavaScript: vi.fn() } },
    goToCFI: vi.fn(),
    flashHighlight: vi.fn(),
    goPrev: vi.fn(),
    goNext: vi.fn(),
    openBook: vi.fn(),
    setThemeColors: vi.fn(),
    applySettings: vi.fn(),
    handleMessage: vi.fn(),
    clearSelection: vi.fn(),
    goToHref: vi.fn(),
  };
  let bridgeCallbacks: BridgeCallbacks = {};
  const volumePaging = vi.fn();
  const native = {
    View: "View",
    Text: "Text",
    Pressable: "Pressable",
    TouchableOpacity: "TouchableOpacity",
    ActivityIndicator: "ActivityIndicator",
    Platform: { OS: "android", isPad: false },
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: unknown) => styles },
    Alert: { alert: vi.fn() },
    AppState: { addEventListener: () => ({ remove: vi.fn() }) },
    BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
    Easing: { out: (value: unknown) => value, cubic: () => 0 },
    Animated: {
      View: "Animated.View",
      Value: class {
        setValue = vi.fn();
        interpolate() {
          return 0;
        }
      },
      timing: () => ({ start: vi.fn() }),
    },
    useWindowDimensions: () => dimensions,
  };
  const shared: Record<string, unknown> = {
    react: scheduler.hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": native,
    "@/styles/theme": {
      useColors: () => ({ background: "#fff", foreground: "#222", primary: "#00f" }),
      withOpacity: (color: string) => color,
    },
  };
  const { ReaderAuxiliaryPane } = loadModule("./ReaderAuxiliaryPane.tsx", shared) as {
    ReaderAuxiliaryPane: Component;
  };
  const layout = loadModule("./reader-ai-layout.ts", {});
  const modules: Record<string, unknown> = {
    ...shared,
    "@/components/chat/BookChatContent": { BookChatContent: "BookChatContent" },
    "@/components/ui/Icon": Object.fromEntries(
      [
        "BookmarkFilledIcon",
        "BookmarkIcon",
        "BotIcon",
        "ChevronLeftIcon",
        "HeadphonesIcon",
        "LanguagesIcon",
        "NotebookPenIcon",
        "SearchIcon",
        "XIcon",
      ].map((name) => [name, name]),
    ),
    "@/hooks/use-keyboard-insets": { useKeyboardInsets: () => keyboard },
    "@/lib/library/open-mobile-book": { openMobileBook },
    "@/hooks/use-reader-bridge": {
      useReaderBridge: (callbacks: BridgeCallbacks) => {
        bridgeCallbacks = callbacks;
        return bridge;
      },
    },
    "@/lib/reader/local-file-server": {
      startFileServer: vi.fn().mockResolvedValue("http://localhost:1234"),
      stopFileServer: vi.fn(),
    },
    "@/stores": {
      useSettingsStore: createStore(settings),
      useLibraryStore,
      useReaderStore: createStore({ setGoToCfiFn: vi.fn() }),
      useReadingSessionStore: createStore({
        incrementPagesRead: vi.fn(),
        incrementCharactersRead: vi.fn(),
      }),
      useAnnotationStore: createStore({
        highlights: [],
        addHighlight: vi.fn(),
        updateHighlight: vi.fn(),
        removeHighlight: vi.fn(),
        loadAnnotations: vi.fn(),
        removeBookmark: vi.fn(),
      }),
      useTTSStore: createStore({ playState: "stopped", config: {} }),
    },
    "@/stores/missing-book-prompt-store": { useMissingBookPromptStore: createStore({}) },
    "@/styles/ThemeContext": { useTheme: () => ({ mode: "light" }) },
    "@react-navigation/native": { useIsFocused: () => focus.current },
    "@readany/core/ai/reading-context-service": {
      readingContextService: {
        updateContext: vi.fn(),
        updateSelection: vi.fn(),
        clearSelection: vi.fn(),
        clearContext: vi.fn(),
      },
    },
    "@readany/core/db/write-retry": { runWithDbRetry: vi.fn() },
    "@readany/core/hooks": { useChapterTranslation: () => ({ state: { status: "idle" } }) },
    "@readany/core/hooks/use-reading-session": {
      useReadingSession: () => ({ sendEvent: vi.fn() }),
    },
    "@readany/core/reader": { createSelectionNoteMutation: vi.fn() },
    "@readany/core/services": {
      getPlatformService: () => ({
        getAppDataDir: async () => "/app",
        joinPath: async () => "/app/books/current.epub",
      }),
    },
    "@readany/core/stores": { useFontStore, getCSSFontFace: vi.fn() },
    "@readany/core/stores/ruby-store": { useRubyStore: createStore({ getBookRuby: () => null }) },
    "@readany/core/stores/sync-store": { useSyncStore: createStore({}) },
    "@readany/core/utils/event-bus": { eventBus: { on: () => vi.fn() } },
    "@readany/core/utils/throttle": { throttle: (callback: unknown) => callback },
    "expo-asset": {
      Asset: {
        fromModule: () => ({
          localUri: "file:///reader.html",
          downloadAsync: async () => undefined,
        }),
      },
    },
    "expo-document-picker": {},
    "../../assets/reader/reader.html": "reader-asset",
    "react-i18next": { useTranslation: () => ({ t, i18n: { language: "zh" } }) },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "react-native-webview": { WebView: "WebView" },
    "./reader/ReaderAuxiliaryPane": { ReaderAuxiliaryPane },
    "./reader/reader-ai-layout": layout,
    "./reader/reader-constants": { CONTROLS_TIMEOUT: 3000 },
    "./reader/reader-icons": {
      BatteryIcon: "BatteryIcon",
      ListIcon: "ListIcon",
      SettingsIcon: "SettingsIcon",
    },
    "./reader/reader-styles": { makeStyles: () => ({}), noteTooltipMdStyles: {} },
    "./reader/useReaderBookmark": { useReaderBookmark: () => ({ bookBookmarks: [] }) },
    "./reader/useReaderSearch": { useReaderSearch: () => ({ closeSearch: vi.fn(), results: [] }) },
    "./reader/useReaderSystemInfo": {
      useReaderSystemInfo: () => ({
        readerClock: "12:00",
        batteryLevel: 1,
        stableTopInset: 24,
        insets: { left: 0, right: 0, bottom: 0 },
      }),
    },
    "./reader/useReaderTTS": {
      useReaderTTS: () => ({
        pendingTTSContinueCallbackRef: { current: null },
        pendingTTSContinueSafetyTimerRef: { current: null },
        ttsDisplaySegments: [],
      }),
    },
    "./reader/useVolumeButtonPaging": { useVolumeButtonPaging: volumePaging },
  };
  for (const [path, name] of [
    ["@/components/chat/MarkdownRenderer", "MarkdownRenderer"],
    ["@/components/reader/BookmarkRibbon", "BookmarkRibbon"],
    ["@/components/reader/ChapterTranslationSheet", "ChapterTranslationSheet"],
    ["@/components/reader/ReadingProgressSlider", "ReadingProgressSlider"],
    ["@/components/reader/SelectionPopover", "SelectionPopover"],
    ["@/components/reader/TTSPage", "TTSPage"],
    ["@/components/reader/TranslationPanel", "TranslationPanel"],
    ["@/components/ui/SyncButton", "SyncButton"],
    ["./NotesView", "NotesView"],
    ["./reader/ReaderAIResizeHandle", "ReaderAIResizeHandle"],
    ["./reader/ReaderNoteViewModal", "ReaderNoteViewModal"],
    ["./reader/ReaderSearchPanel", "ReaderSearchPanel"],
    ["./reader/ReaderSettingsPanel", "ReaderSettingsPanel"],
    ["./reader/ReaderTOCPanel", "ReaderTOCPanel"],
  ])
    modules[path] = { [name]: name };
  const { ReaderScreen } = loadModule("../ReaderScreen.tsx", modules) as {
    ReaderScreen: Component;
  };
  function render(): Element {
    for (let count = 0; count < 30; count++) {
      scheduler.begin();
      const tree = ReaderScreen({ route: { params: { bookId: book.id } }, navigation });
      if (!scheduler.flush()) return tree;
    }
    throw new Error("Reader hook scheduler did not settle");
  }
  function emit(name: string, ...args: unknown[]) {
    return invoke({ type: "bridge", props: bridgeCallbacks }, name, ...args);
  }
  function nodes(tree: unknown, type: unknown): Element[] {
    if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, type));
    if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
    const element = tree as Element;
    const children =
      element.type === ReaderAuxiliaryPane
        ? ReaderAuxiliaryPane(element.props)
        : element.props.children;
    return [...(element.type === type ? [element] : []), ...nodes(children, type)];
  }
  function one(tree: Element, type: unknown) {
    const matches = nodes(tree, type);
    expect(matches).toHaveLength(1);
    return matches[0];
  }
  function path(tree: Element, type: unknown) {
    const matches: { element: Element; position: number }[][] = [];
    function visit(
      value: unknown,
      ancestors: { element: Element; position: number }[],
      position: number,
    ) {
      if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, ancestors, index));
        return;
      }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const element = value as Element;
      const current = [...ancestors, { element, position }];
      if (element.type === type) matches.push(current);
      const children =
        element.type === ReaderAuxiliaryPane
          ? ReaderAuxiliaryPane(element.props)
          : element.props.children;
      visit(children, current, 0);
    }
    visit(tree, [], 0);
    expect(matches).toHaveLength(1);
    return matches[0];
  }
  // 模拟 React 的结构身份：type/key 及无 key 节点的兄弟位置，不比较元素对象引用。
  function identity(tree: Element, type: unknown) {
    return path(tree, type).map(({ element, position }) => ({
      type: element.type,
      key: element.key,
      position: element.key == null ? position : undefined,
    }));
  }
  function openFloating() {
    emit("onTap");
    const tree = render();
    const button = nodes(tree, "TouchableOpacity").find(
      (node) => nodes(node.props.children, "BotIcon").length === 1,
    );
    if (!button) throw new Error("Floating AI entry not found");
    invoke(button, "onPress");
    return render();
  }
  async function mount() {
    render();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(one(render(), "WebView").props.source).toEqual({ uri: "file:///reader.html" });
    emit("onReady");
    render();
    for (let index = 0; index < 12; index++) await Promise.resolve();
    expect(bridge.openBook).toHaveBeenCalledOnce();
    emit("onLoaded");
    return render();
  }
  const host = {
    render,
    mount,
    emit,
    one,
    nodes,
    path,
    identity,
    openFloating,
    bridge,
    navigation,
    openMobileBook,
    dimensions,
    settings,
    keyboard,
    focus,
    volumePaging,
    ReaderAuxiliaryPane,
    dispose: scheduler.dispose,
  };
  hosts.push(host);
  return host;
}

const hosts: { dispose(): void }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Reader AI 真实组件集成", () => {
  it("浮动 AI 与 SelectionPopover 都打开当前书籍的同一个辅助区", async () => {
    const host = setup();
    await host.mount();
    const floating = host.openFloating();
    expect(host.one(floating, host.ReaderAuxiliaryPane).props.panel).toBe("ai");
    const chat = host.one(floating, "BookChatContent");
    expect(chat.props).toMatchObject({ bookId: "current-book", embedded: true, visible: true });
    expect(chat.key).toBe("current-book");
    expect(host.navigation.navigate).not.toHaveBeenCalled();

    invoke(chat, "onClose");
    host.render();
    host.emit("onSelection", {
      text: "选中的原文",
      cfi: "epubcfi(/6/2!/4/2)",
      position: { x: 40, y: 80, selectionTop: 60, selectionBottom: 100 },
    });
    const selectionTree = host.render();
    invoke(host.one(selectionTree, "SelectionPopover"), "onAIChat");
    const selected = host.render();
    expect(host.one(selected, host.ReaderAuxiliaryPane).props.panel).toBe("ai");
    const selectionChat = host.one(selected, "BookChatContent");
    expect(selectionChat.type).toBe(chat.type);
    expect(selectionChat.key).toBe(chat.key);
    expect(selectionChat.props).toMatchObject({
      bookId: "current-book",
      embedded: true,
      visible: true,
      selectionRequest: { text: "选中的原文" },
    });
    expect(host.nodes(selected, "SelectionPopover")).toHaveLength(0);
    expect(host.navigation.navigate).not.toHaveBeenCalled();
  });

  it.each([1000, 400])(
    "窗口宽度 %s 下，同书引用使用当前 bridge，跨书引用交给 openMobileBook",
    async (width) => {
      const host = setup();
      host.dimensions.width = width;
      await host.mount();
      const chat = host.one(host.openFloating(), "BookChatContent");
      invoke(chat, "onCitationClick", { bookId: "current-book", cfi: "epubcfi(/6/4!/4/2)" });
      expect(host.bridge.goToCFI).toHaveBeenCalledExactlyOnceWith("epubcfi(/6/4!/4/2)");
      expect(host.bridge.flashHighlight).toHaveBeenCalledExactlyOnceWith(
        "epubcfi(/6/4!/4/2)",
        "orange",
        1800,
      );
      expect(host.openMobileBook).not.toHaveBeenCalled();
      expect(host.navigation.navigate).not.toHaveBeenCalled();
      invoke(chat, "onCitationClick", { bookId: "current-book" });
      expect(host.bridge.goToCFI).toHaveBeenCalledTimes(1);
      expect(host.bridge.flashHighlight).toHaveBeenCalledTimes(1);
      invoke(chat, "onCitationClick", { bookId: "other-book", cfi: "epubcfi(/6/8!/4/2)" });
      expect(host.openMobileBook).toHaveBeenCalledExactlyOnceWith({
        bookId: "other-book",
        cfi: "epubcfi(/6/8!/4/2)",
        highlight: true,
        navigation: host.navigation,
        t: expect.any(Function),
      });
      expect(host.bridge.goToCFI).toHaveBeenCalledTimes(1);
      expect(host.bridge.flashHighlight).toHaveBeenCalledTimes(1);
      expect(host.navigation.navigate).not.toHaveBeenCalled();
      expect(host.navigation.reset).not.toHaveBeenCalled();
      expect(host.navigation.goBack).not.toHaveBeenCalled();
    },
  );

  it("宽窄切换和隐藏保留聊天 key、祖先身份及 Reader WebView 位置", async () => {
    const host = setup();
    const before = await host.mount();
    const readerIdentity = host.identity(before, "WebView");
    const readerRef = host.one(before, "WebView").props.ref;
    const wide = host.openFloating();
    const chatIdentity = host.identity(wide, "BookChatContent");
    expect(host.one(wide, host.ReaderAuxiliaryPane).props.docked).toBe(true);
    expect(host.identity(wide, "WebView")).toEqual(readerIdentity);
    expect(host.one(wide, "BookChatContent").key).toBe("current-book");

    host.focus.current = false;
    const unfocused = host.render();
    expect(host.one(unfocused, "BookChatContent").props.visible).toBe(false);
    expect(host.identity(unfocused, "BookChatContent")).toEqual(chatIdentity);
    host.focus.current = true;
    host.dimensions.width = 400;
    const narrow = host.render();
    expect(host.one(narrow, host.ReaderAuxiliaryPane).props.docked).toBe(false);
    expect(host.one(narrow, "BookChatContent").props.visible).toBe(true);
    expect(host.identity(narrow, "BookChatContent")).toEqual(chatIdentity);
    expect(host.identity(narrow, "WebView")).toEqual(readerIdentity);
    expect(host.one(narrow, "WebView").props.ref).toBe(readerRef);
    const blockedReader = host.path(narrow, "WebView")[1].element;
    expect(blockedReader.props).toMatchObject({
      pointerEvents: "none",
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    });

    invoke(host.one(narrow, "BookChatContent"), "onClose");
    const hidden = host.render();
    expect(host.one(hidden, host.ReaderAuxiliaryPane).props.panel).toBeNull();
    expect(host.one(hidden, "BookChatContent").props.visible).toBe(false);
    expect(host.identity(hidden, "BookChatContent")).toEqual(chatIdentity);
    expect(host.identity(hidden, "WebView")).toEqual(readerIdentity);
    expect(host.one(hidden, "WebView").props.ref).toBe(readerRef);
    const hiddenPath = host.path(hidden, "BookChatContent");
    const aiWrapper = hiddenPath.at(-2)?.element;
    expect(aiWrapper?.props).toMatchObject({
      style: expect.objectContaining({ display: "none" }),
      pointerEvents: "none",
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    });
    const paneWrapper = hiddenPath.at(-3)?.element;
    expect(paneWrapper?.props).toMatchObject({
      pointerEvents: "none",
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    });
    expect(host.path(hidden, "WebView")[1].element.props).toMatchObject({
      pointerEvents: "auto",
      accessibilityElementsHidden: false,
      importantForAccessibility: "auto",
    });

    host.dimensions.width = 1000;
    const restored = host.openFloating();
    expect(host.one(restored, "BookChatContent").props.visible).toBe(true);
    expect(host.identity(restored, "BookChatContent")).toEqual(chatIdentity);
    expect(host.identity(restored, "WebView")).toEqual(readerIdentity);
    const activeWrapper = host.path(restored, "BookChatContent").at(-2)?.element;
    expect(activeWrapper?.props).toMatchObject({
      style: expect.objectContaining({ display: "flex" }),
      pointerEvents: "auto",
      accessibilityElementsHidden: false,
      importantForAccessibility: "auto",
    });
    expect(host.bridge.openBook).toHaveBeenCalledOnce();
  });

  it("真实音量 Hook 配置随启用设置、AI 输入和全屏状态变化", async () => {
    const host = setup();
    await host.mount();
    const active = () => host.volumePaging.mock.lastCall?.[0].active;
    expect(active()).toBe(true);
    const wide = host.openFloating();
    expect(active()).toBe(true);
    const chat = host.one(wide, "BookChatContent");

    invoke(chat, "onInputFocusChange", true);
    host.render();
    expect(active()).toBe(false);
    invoke(chat, "onInputFocusChange", false);
    host.render();
    expect(active()).toBe(true);

    host.settings.readSettings.volumeButtonsPageTurn = false;
    host.render();
    expect(active()).toBe(false);
    host.settings.readSettings.volumeButtonsPageTurn = true;
    host.render();
    expect(active()).toBe(true);

    host.keyboard.isVisible = true;
    host.render();
    expect(active()).toBe(false);
    host.keyboard.isVisible = false;
    host.render();
    expect(active()).toBe(true);

    host.dimensions.width = 400;
    host.render();
    expect(active()).toBe(false);
    invoke(host.one(host.render(), "BookChatContent"), "onClose");
    host.render();
    expect(active()).toBe(true);
    const volumeConfig = host.volumePaging.mock.lastCall?.[0];
    volumeConfig.onPrev();
    volumeConfig.onNext();
    expect(host.bridge.goPrev).toHaveBeenCalledOnce();
    expect(host.bridge.goNext).toHaveBeenCalledOnce();
  });
});

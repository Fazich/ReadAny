import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import type { BookChatContentProps } from "./BookChatContent";

interface NativeProps extends Record<string, unknown> {
  ref: { current: unknown };
  quotes: { id: string; text: string; source?: string }[];
  onPress: () => void;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onInputFocusChange: (focused: boolean) => void;
  onRemoveQuote: (id: string) => void;
  onCitationClick: (citation: unknown) => void;
}
interface Element {
  type: unknown;
  props: NativeProps;
  key?: string;
}
type Cleanup = () => void;
interface HookSlot {
  value?: unknown;
  deps?: unknown[];
  cleanup?: Cleanup;
}

// 复用项目现有的原生替身方案：执行真实组件源码，不复制业务条件或状态转换。
function createHost(file: string, exportName: string, modules: Record<string, unknown>) {
  const slots: HookSlot[] = [];
  let cursor = 0;
  let dirty = false;
  let effects: Cleanup[] = [];
  const sameDeps = (a?: unknown[], b?: unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    forwardRef: (component: unknown) => component,
    useState(initial: unknown) {
      const index = cursor++;
      if (!slots[index])
        slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [
        slots[index].value,
        (next: unknown) => {
          const value = typeof next === "function" ? next(slots[index].value) : next;
          if (!Object.is(value, slots[index].value)) dirty = true;
          slots[index].value = value;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      slots[index] ??= { value: { current: initial } };
      return slots[index].value;
    },
    useMemo(create: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps))
        slots[index] = { value: create(), deps };
      return slots[index].value;
    },
    useCallback(callback: unknown, deps: unknown[]) {
      return hooks.useMemo(() => callback, deps);
    },
    useEffect(effect: () => undefined | Cleanup, deps?: unknown[]) {
      const index = cursor++;
      if (slots[index] && sameDeps(slots[index].deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        slots[index].cleanup = effect() || undefined;
      });
    },
    useImperativeHandle(ref: { current: unknown }, create: () => unknown, deps: unknown[]) {
      hooks.useEffect(() => {
        ref.current = create();
        return () => {
          ref.current = null;
        };
      }, deps);
    },
  };
  // JSX 是动态模块边界；原生替身只保留测试实际触发的回调类型。
  const jsx = (type: unknown, props: NativeProps, key?: string): Element => ({ type, props, key });
  const source = transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), {
    loader: "tsx",
    format: "cjs",
    jsx: "automatic",
  }).code;
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", source)(
    (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (!(name in modules)) throw new Error(`Unexpected test import: ${name}`);
      return modules[name];
    },
    module,
    module.exports,
  );
  const component = module.exports[exportName] as (
    props: object,
    ref?: { current: unknown },
  ) => Element;
  return {
    render(props: object, ref?: { current: unknown }, commit?: (tree: Element) => void): Element {
      let tree: Element;
      let remaining = 20;
      do {
        if (!remaining--) throw new Error("组件持续触发重渲染");
        cursor = 0;
        dirty = false;
        effects = [];
        tree = component(props, ref);
        commit?.(tree);
        for (const effect of effects) effect();
      } while (dirty);
      return tree;
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.();
    },
  };
}

function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const node = tree as Element;
  return [node, ...elements(node.props.children)];
}
function find(tree: Element, type: string): Element {
  const node = elements(tree).find((element) => element.type === type);
  if (!node) throw new Error(`Missing ${type}`);
  return node;
}
function button(tree: Element, label: string): Element {
  const node = elements(tree).find((element) => element.props.accessibilityLabel === label);
  if (!node) throw new Error(`Missing button ${label}`);
  return node;
}
function styles(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(styles));
  return style && typeof style === "object" ? (style as Record<string, unknown>) : {};
}

function setup() {
  let focused = true;
  let width = 320;
  let keyboardVisible = false;
  let back: (() => boolean) | undefined;
  const close = vi.fn();
  const focusChange = vi.fn();
  const blur = vi.fn();
  const sendMessage = vi.fn();
  const stopStream = vi.fn();
  const loadThreads = vi.fn();
  const setBookActiveThread = vi.fn();
  const createThread = vi.fn();
  const removeThread = vi.fn();
  const navigateToSettings = vi.fn();
  const citationClick = vi.fn();
  const endpoint = { id: "endpoint", models: ["a-model-with-a-long-name", "another-model"] };
  const state = {
    aiConfig: {
      endpoints: [endpoint],
      activeEndpointId: endpoint.id,
      activeModel: endpoint.models[0],
    },
    setActiveEndpoint: vi.fn(),
    setActiveModel: vi.fn(),
  };
  const useSettingsStore = Object.assign(
    (select: (value: typeof state) => unknown) => select(state),
    {
      getState: () => state,
    },
  );
  const thread = {
    id: "thread-1",
    messages: [{ content: "message" }],
    updatedAt: 1,
    title: "history",
  };
  const chat = {
    threads: [thread],
    loadThreads,
    setBookActiveThread,
    createThread,
    removeThread,
    getActiveThreadId: () => thread.id,
    getThreadsForContext: () => [thread],
  };
  const animation = (value: { setValue(n: number): void }, options: { toValue: number }) => ({
    start(callback?: (result: { finished: boolean }) => void) {
      value.setValue(options.toValue);
      callback?.({ finished: true });
    },
  });
  const native = {
    Alert: { alert: vi.fn() },
    Animated: {
      Value: class {
        constructor(public value: number) {}
        setValue(value: number) {
          this.value = value;
        }
        stopAnimation() {}
      },
      View: "AnimatedView",
      spring: animation,
      timing: animation,
      parallel: (animations: { start(): void }[]) => ({
        start(callback?: (result: { finished: boolean }) => void) {
          for (const item of animations) item.start();
          callback?.({ finished: true });
        },
      }),
    },
    BackHandler: {
      addEventListener: vi.fn((_name: string, callback: () => boolean) => {
        back = callback;
        return {
          remove: () => {
            if (back === callback) back = undefined;
          },
        };
      }),
    },
    Keyboard: { isVisible: () => keyboardVisible, dismiss: vi.fn() },
    Platform: { OS: "android" },
    StyleSheet: {
      create: (value: unknown) => value,
      absoluteFill: {},
      absoluteFillObject: {},
      hairlineWidth: 1,
    },
    ...Object.fromEntries(
      [
        "Image",
        "Modal",
        "Pressable",
        "ScrollView",
        "Text",
        "TextInput",
        "TouchableOpacity",
        "View",
      ].map((name) => [name, name]),
    ),
  };
  const colors = new Proxy({}, { get: (_object, key) => String(key) });
  const modules = {
    "@react-navigation/native": { useIsFocused: () => focused },
    "react-i18next": {
      useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
    },
    "react-native": native,
    "react-native-keyboard-controller": { KeyboardAvoidingView: "KeyboardAvoidingView" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 20 }) },
    "@/hooks": {
      useStreamingChat: () => ({
        isStreaming: true,
        currentMessage: { threadId: thread.id },
        currentStep: null,
        error: null,
        sendMessage,
        stopStream,
      }),
    },
    "@/hooks/use-keyboard-insets": {
      useKeyboardInsets: () => ({ isVisible: keyboardVisible, rawHeight: 200, safeAreaBottom: 20 }),
    },
    "@/hooks/use-responsive-layout": {
      useContentLayout: () => ({
        contentWidth: width,
        sidebarWidth: 224,
        supportsSplitView: width >= 680,
        onContentLayout: (event: { nativeEvent: { layout: { width: number } } }) => {
          width = event.nativeEvent.layout.width;
        },
      }),
    },
    "@/lib/ai/resolve-active-ai-config": { resolveActiveAIConfig: async () => state.aiConfig },
    "@/stores": { useLibraryStore: () => ({ books: [{ id: "book-1", meta: { title: "Book" } }] }) },
    "@/stores/chat-store": {
      useChatStore: (select: (state: typeof chat) => unknown) => select(chat),
    },
    "@/stores/settings-store": { useSettingsStore },
    "@readany/core/services": { getPlatformService: () => ({ shareOrDownloadFile: vi.fn() }) },
    "@readany/core/utils": {
      convertToMessageV2: (messages: unknown) => messages,
      mergeMessagesWithStreaming: (messages: unknown) => messages,
      groupThreadsByTime: (threads: unknown) => ({
        today: threads,
        yesterday: [],
        last7Days: [],
        last30Days: [],
        older: [],
      }),
      formatRelativeTimeShort: () => "today",
      getMonthLabel: () => "month",
    },
    "expo-clipboard": { setStringAsync: vi.fn() },
    "@/components/ui/AdaptiveEmptyState": { AdaptiveEmptyState: "AdaptiveEmptyState" },
    "@/components/chat/ChatInput": { ChatInput: "ChatInput" },
    "@/components/chat/MessageList": { MessageList: "MessageList" },
    "@/components/chat/ModelSelector": { ModelSelector: "ModelSelector" },
    "@/components/ui/Icon": Object.fromEntries(
      [
        "BrainIcon",
        "ChevronDownIcon",
        "EyeOffIcon",
        "SendIcon",
        "StopCircleIcon",
        "XIcon",
        "CheckIcon",
        "ChevronLeftIcon",
        "CopyIcon",
        "Download",
        "HistoryIcon",
        "MessageCirclePlusIcon",
        "ScrollTextIcon",
        "ShareIcon",
        "Trash2Icon",
      ].map((name) => [name, name]),
    ),
    "@/styles/theme": {
      fontSize: {},
      fontWeight: {},
      radius: {},
      useColors: () => colors,
      useTheme: () => ({ isDark: false }),
      withOpacity: (color: string) => color,
    },
    "../../../assets/think.png": "think",
    "../../../assets/think-dark.png": "think-dark",
  };
  const host = createHost("./BookChatContent.tsx", "BookChatContent", modules);
  const props: BookChatContentProps = {
    bookId: "book-1",
    onClose: close,
    onNavigateToSettings: navigateToSettings,
    onCitationClick: citationClick,
    embedded: true,
    onInputFocusChange: focusChange,
  };
  const render = () =>
    host.render(props, undefined, (tree) => {
      find(tree, "ChatInput").props.ref.current = { blur };
    });
  return {
    modules,
    host,
    props,
    render,
    close,
    blur,
    sendMessage,
    stopStream,
    loadThreads,
    focusChange,
    citationClick,
    setWidth(value: number) {
      width = value;
    },
    setFocused(value: boolean) {
      focused = value;
    },
    setKeyboard(value: boolean) {
      keyboardVisible = value;
    },
    get back() {
      return back;
    },
  };
}

describe("共享书籍对话", () => {
  it("每个选区 ID 只追加一次，同文不同 ID 继续追加且删除后不重新注入", () => {
    const host = setup();
    host.props.selectionRequest = { id: "one", text: "同一段文字", chapterTitle: "第一章" };
    let tree = host.render();
    expect(find(tree, "ChatInput").props.quotes).toEqual([
      { id: "selection-one", text: "同一段文字", source: "第一章" },
    ]);
    host.props.selectionRequest = { ...host.props.selectionRequest };
    expect(find(host.render(), "ChatInput").props.quotes).toHaveLength(1);
    host.props.selectionRequest = { id: "two", text: "同一段文字" };
    tree = host.render();
    expect(find(tree, "ChatInput").props.quotes).toHaveLength(2);
    find(tree, "ChatInput").props.onRemoveQuote("selection-one");
    host.props.selectionRequest = { id: "one", text: "同一段文字" };
    expect(find(host.render(), "ChatInput").props.quotes.map((q) => q.id)).toEqual([
      "selection-two",
    ]);
    host.host.unmount();
  });

  it("隐藏关闭导出和历史并禁用输入，不停止流，恢复后保持引用和会话", () => {
    const host = setup();
    host.props.selectionRequest = { id: "one", text: "quote" };
    let tree = host.render();
    button(tree, "导出对话").props.onPress();
    button(tree, "历史记录").props.onPress();
    tree = host.render();
    expect(find(tree, "Modal").props.visible).toBe(true);
    const drawerOverlay = (view: Element) =>
      elements(view).find(
        (node) =>
          node.props.pointerEvents === "box-none" ||
          node.props.accessibilityElementsHidden === true,
      );
    expect(drawerOverlay(tree)?.props.importantForAccessibility).toBe("auto");
    host.props.visible = false;
    tree = host.render();
    expect(find(tree, "Modal").props.visible).toBe(false);
    expect(
      elements(tree).filter(
        (node) => node.props.importantForAccessibility === "no-hide-descendants",
      ),
    ).toHaveLength(2);
    expect(find(tree, "ChatInput").props.active).toBe(false);
    expect(find(tree, "ModelSelector").props.active).toBe(false);
    expect(tree.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(host.back).toBeUndefined();
    host.props.visible = true;
    tree = host.render();
    expect(find(tree, "Modal").props.visible).toBe(false);
    expect(find(tree, "ChatInput").props.quotes).toHaveLength(1);
    expect(host.loadThreads).toHaveBeenCalledOnce();
    expect(host.stopStream).not.toHaveBeenCalled();
    expect(host.sendMessage).not.toHaveBeenCalled();
    host.back?.();
    expect(host.close).toHaveBeenCalledOnce();
    host.host.unmount();
  });

  it("Android 返回先关历史、再收自身键盘、最后关闭；路由失焦不监听", () => {
    const host = setup();
    let tree = host.render();
    find(tree, "ChatInput").props.onInputFocusChange(true);
    host.setKeyboard(true);
    button(tree, "历史记录").props.onPress();
    tree = host.render();
    expect(host.back?.()).toBe(true);
    expect(host.blur).not.toHaveBeenCalled();
    expect(host.close).not.toHaveBeenCalled();
    host.render();
    expect(host.back?.()).toBe(true);
    expect(host.blur).toHaveBeenCalledOnce();
    find(tree, "ChatInput").props.onInputFocusChange(false);
    host.setKeyboard(false);
    host.render();
    host.back?.();
    expect(host.close).toHaveBeenCalledOnce();
    host.setFocused(false);
    host.render();
    expect(host.back).toBeUndefined();
    host.host.unmount();
  });

  it("嵌入宽屏仍为自身范围抽屉，320dp 操作 44dp 且模型第二行，Android 不重复避让", () => {
    const host = setup();
    let tree = host.render();
    const historyButton = button(tree, "历史记录");
    const closeButton = button(tree, "关闭");
    expect(styles(historyButton.props.style)).toMatchObject({ width: 44, height: 44 });
    expect(styles(closeButton.props.style)).toMatchObject({ width: 44, height: 44 });
    expect(find(tree, "KeyboardAvoidingView").props.enabled).toBe(false);
    expect(find(tree, "KeyboardAvoidingView").props.keyboardVerticalOffset).toBe(0);
    const modelRow = elements(tree).find(
      (node) =>
        elements(node.props.children).some((child) => child.type === "ModelSelector") &&
        !elements(node.props.children).some((child) => child === historyButton),
    );
    expect(modelRow).toBeDefined();
    host.setWidth(1000);
    tree = host.render();
    button(tree, "历史记录").props.onPress();
    tree = host.render();
    const drawer = elements(tree).find(
      (node) => node.type === "AnimatedView" && styles(node.props.style).width !== undefined,
    );
    expect(styles(drawer?.props.style).width).toBe(300);
    host.props.embedded = false;
    tree = host.render();
    expect(find(tree, "KeyboardAvoidingView").props.enabled).toBe(true);
    expect(
      elements(tree).filter((node) => node.props.accessibilityLabel === "历史记录"),
    ).toHaveLength(0);
    const citation = { bookId: "book-1", cfi: "epubcfi(...)" };
    find(tree, "MessageList").props.onCitationClick(citation);
    expect(host.citationClick).toHaveBeenCalledWith(citation);
    host.host.unmount();
  });
});

describe("输入和模型的激活生命周期", () => {
  it("取消激活只 blur 自身，草稿和思考设置保留到再次激活发送", () => {
    const setupHost = setup();
    const host = createHost("./ChatInput.tsx", "ChatInput", setupHost.modules);
    const blur = vi.fn();
    const onInputFocusChange = vi.fn();
    const onSend = vi.fn();
    const ref = { current: null as unknown };
    const props = { onSend, active: true, onInputFocusChange };
    const render = () =>
      host.render(props, ref, (tree) => {
        find(tree, "TextInput").props.ref.current = { blur };
      });
    let tree = render();
    find(tree, "TextInput").props.onChangeText("未发送草稿");
    find(tree, "TextInput").props.onFocus();
    expect(onInputFocusChange).toHaveBeenLastCalledWith(true);
    props.active = false;
    tree = render();
    expect(find(tree, "TextInput").props.value).toBe("未发送草稿");
    expect(find(tree, "TextInput").props.editable).toBe(false);
    expect(blur).toHaveBeenCalledOnce();
    expect(onInputFocusChange).toHaveBeenLastCalledWith(false);
    expect(setupHost.modules["react-native"].Keyboard.dismiss).not.toHaveBeenCalled();
    props.active = true;
    tree = render();
    expect(find(tree, "TextInput").props.value).toBe("未发送草稿");
    const send = elements(tree).find(
      (node) =>
        node.type === "TouchableOpacity" &&
        elements(node.props.children).some((child) => child.type === "SendIcon"),
    );
    send?.props.onPress();
    expect(onSend).toHaveBeenCalledWith("未发送草稿", false, false, undefined);
    expect(find(render(), "TextInput").props.value).toBe("");
    host.unmount();
  });

  it("隐藏关闭模型 Modal 并禁用触发，重新显示不恢复旧弹层", () => {
    const setupHost = setup();
    const host = createHost("./ModelSelector.tsx", "ModelSelector", setupHost.modules);
    const props = { active: true };
    let tree = host.render(props);
    find(tree, "TouchableOpacity").props.onPress();
    expect(find(host.render(props), "Modal").props.visible).toBe(true);
    props.active = false;
    tree = host.render(props);
    expect(find(tree, "Modal").props.visible).toBe(false);
    expect(find(tree, "TouchableOpacity").props.disabled).toBe(true);
    props.active = true;
    expect(find(host.render(props), "Modal").props.visible).toBe(false);
    host.unmount();
  });
});

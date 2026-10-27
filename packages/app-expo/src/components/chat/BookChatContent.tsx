import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Animated,
  BackHandler,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStreamingChat } from "@/hooks";
import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";
import { useContentLayout } from "@/hooks/use-responsive-layout";
import { resolveActiveAIConfig } from "@/lib/ai/resolve-active-ai-config";
import { useLibraryStore } from "@/stores";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getPlatformService } from "@readany/core/services";
import type { AttachedQuote } from "@readany/core/types";
import type { CitationPart, MessageV2 } from "@readany/core/types/message";
import {
  convertToMessageV2,
  exportChatAsJSON,
  exportChatAsMarkdown,
  formatChatForClipboard,
  formatRelativeTimeShort,
  getExportFilename,
  getMonthLabel,
  groupThreadsByTime,
  mergeMessagesWithStreaming,
} from "@readany/core/utils";
import * as Clipboard from "expo-clipboard";

import { ChatInput, type ChatInputHandle } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { AdaptiveEmptyState } from "@/components/ui/AdaptiveEmptyState";
import {
  ChevronLeftIcon,
  CopyIcon,
  Download,
  HistoryIcon,
  MessageCirclePlusIcon,
  ScrollTextIcon,
  ShareIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import {
  fontSize as fs,
  fontWeight as fw,
  radius,
  useColors,
  useTheme,
  withOpacity,
} from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

const THINK_PNG = require("../../../assets/think.png");
const THINK_DARK_PNG = require("../../../assets/think-dark.png");

export interface BookChatSelectionRequest {
  id: string;
  text: string;
  chapterTitle?: string;
}

export interface BookChatContentProps {
  bookId: string;
  onClose: () => void;
  onNavigateToSettings: () => void;
  onCitationClick: (citation: CitationPart) => void;
  selectionRequest?: BookChatSelectionRequest;
  embedded?: boolean;
  visible?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
}

/** 独立路由与阅读器共用同一对话实例，显示方式变化不清除草稿或流。 */
export function BookChatContent({
  bookId,
  onClose,
  onNavigateToSettings,
  onCitationClick,
  selectionRequest,
  embedded = false,
  visible = true,
  onInputFocusChange,
}: BookChatContentProps) {
  const isFocused = useIsFocused();
  const active = visible && isFocused;
  const chatInputRef = useRef<ChatInputHandle>(null);
  const inputFocusedRef = useRef(false);
  const keyboard = useKeyboardInsets();
  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      inputFocusedRef.current = focused;
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );
  const { t } = useTranslation();
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useContentLayout();
  // 嵌入历史始终在 AI 自身区域内覆盖；不采用全窗口宽度决定停靠。
  const isTabletLandscape = !embedded && layout.supportsSplitView;
  const sidebarWidth = isTabletLandscape
    ? layout.sidebarWidth
    : Math.min(layout.contentWidth * 0.85, 300);
  const s = useMemo(
    () => makeStyles(colors, { isTabletLandscape, sidebarWidth }),
    [colors, isTabletLandscape, sidebarWidth],
  );

  const { books } = useLibraryStore();
  const book = useMemo(() => books.find((b) => b.id === bookId), [books, bookId]);

  const [quotes, setQuotes] = useState<AttachedQuote[]>([]);
  const consumedSelectionIds = useRef(new Set<string>());
  const selectedText = selectionRequest?.text;

  useEffect(() => {
    if (!selectionRequest?.text.trim() || consumedSelectionIds.current.has(selectionRequest.id)) {
      return;
    }
    // 用操作 ID 去重；再次选择同文也追加引用，不覆盖已有草稿或引用。
    consumedSelectionIds.current.add(selectionRequest.id);
    const quote: AttachedQuote = {
      id: `selection-${selectionRequest.id}`,
      text: selectionRequest.text,
      source: selectionRequest.chapterTitle || undefined,
    };
    setQuotes((previous) => [...previous, quote]);
  }, [selectionRequest]);

  const handleRemoveQuote = useCallback((id: string) => {
    setQuotes((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const threads = useChatStore((s) => s.threads);
  const loadThreads = useChatStore((s) => s.loadThreads);
  const getActiveThreadId = useChatStore((s) => s.getActiveThreadId);
  const setBookActiveThread = useChatStore((s) => s.setBookActiveThread);
  const createThread = useChatStore((s) => s.createThread);
  const removeThread = useChatStore((s) => s.removeThread);
  const getThreadsForContext = useChatStore((s) => s.getThreadsForContext);

  useEffect(() => {
    loadThreads(bookId);
  }, [bookId, loadThreads]);

  const activeThreadId = getActiveThreadId(bookId);
  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((t) => t.id === activeThreadId) : null),
    [threads, activeThreadId],
  );
  const bookThreads = getThreadsForContext(bookId);
  const firstBookThreadId = bookThreads[0]?.id;
  useEffect(() => {
    if (!activeThreadId && firstBookThreadId) {
      setBookActiveThread(bookId, firstBookThreadId);
    }
  }, [activeThreadId, bookId, firstBookThreadId, setBookActiveThread]);

  const groupedThreads = useMemo(() => {
    const grouped = groupThreadsByTime(bookThreads);
    const sections: { key: string; label: string; threads: typeof bookThreads }[] = [
      { key: "today", label: t("chat.today", "今天"), threads: grouped.today },
      { key: "yesterday", label: t("chat.yesterday", "昨天"), threads: grouped.yesterday },
      { key: "last7Days", label: t("chat.last7Days", "7 天内"), threads: grouped.last7Days },
      { key: "last30Days", label: t("chat.last30Days", "30 天内"), threads: grouped.last30Days },
    ];

    const olderByMonth = new Map<string, typeof bookThreads>();
    for (const thread of grouped.older) {
      const monthLabel = getMonthLabel(thread.updatedAt);
      let monthThreads = olderByMonth.get(monthLabel);
      if (!monthThreads) {
        monthThreads = [];
        olderByMonth.set(monthLabel, monthThreads);
      }
      monthThreads.push(thread);
    }

    const sortedMonths = [...olderByMonth.keys()].sort((a, b) => b.localeCompare(a));
    for (const month of sortedMonths) {
      const monthThreads = olderByMonth.get(month);
      if (monthThreads) {
        sections.push({ key: month, label: month, threads: monthThreads });
      }
    }
    return sections;
  }, [bookThreads, t]);
  const formatTime = useCallback((ts: number) => formatRelativeTimeShort(ts, t), [t]);

  // 历史抽屉动画
  const [showSidebar, setShowSidebar] = useState(false);
  const sidebarAnim = useRef(new Animated.Value(-sidebarWidth)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const showSidebarRef = useRef(showSidebar);
  useEffect(() => {
    showSidebarRef.current = showSidebar;
  }, [showSidebar]);

  useEffect(() => {
    if (isTabletLandscape) {
      setShowSidebar(false);
      sidebarAnim.setValue(0);
      backdropAnim.setValue(0);
      return;
    }
    if (!showSidebarRef.current) {
      sidebarAnim.setValue(-sidebarWidth);
    }
  }, [backdropAnim, isTabletLandscape, sidebarAnim, sidebarWidth]);

  const openSidebar = useCallback(() => {
    if (!active || isTabletLandscape) return;
    setShowSidebar(true);
    Animated.parallel([
      Animated.spring(sidebarAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [active, backdropAnim, isTabletLandscape, sidebarAnim]);

  const closeSidebar = useCallback(() => {
    if (isTabletLandscape) return;
    Animated.parallel([
      Animated.spring(sidebarAnim, {
        toValue: -sidebarWidth,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setShowSidebar(false);
    });
  }, [backdropAnim, isTabletLandscape, sidebarAnim, sidebarWidth]);

  useEffect(() => {
    if (active) return;
    // 隐藏或路由失焦只关闭瞬时 UI，不中止流、不清空会话和输入草稿。
    setShowSidebar(false);
    showSidebarRef.current = false;
    sidebarAnim.stopAnimation();
    backdropAnim.stopAnimation();
    sidebarAnim.setValue(-sidebarWidth);
    backdropAnim.setValue(0);
    inputFocusedRef.current = false;
  }, [active, backdropAnim, sidebarAnim, sidebarWidth]);

  useEffect(() => {
    if (Platform.OS !== "android" || !active) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Modal 自身处理系统返回；普通返回依次关闭历史、自己的键盘、AI。
      if (showSidebarRef.current) {
        closeSidebar();
        return true;
      }
      if (inputFocusedRef.current && (Keyboard.isVisible() || keyboard.isVisible)) {
        chatInputRef.current?.blur();
        return true;
      }
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [active, closeSidebar, keyboard.isVisible, onClose]);

  // 沿用按书籍管理的流式会话。
  const { isStreaming, currentMessage, currentStep, error, sendMessage, stopStream } =
    useStreamingChat({ book, bookId });

  const messagesV2: MessageV2[] = useMemo(() => {
    if (!activeThread) return [];
    return convertToMessageV2(activeThread.messages);
  }, [activeThread]);

  const activeCurrentMessage =
    activeThread?.id === currentMessage?.threadId ? currentMessage : null;
  const allMessages = useMemo(
    () => mergeMessagesWithStreaming(messagesV2, activeCurrentMessage, isStreaming),
    [activeCurrentMessage, isStreaming, messagesV2],
  );

  const handleSend = useCallback(
    async (text: string, deepThinking: boolean, spoilerFree: boolean, quotes?: AttachedQuote[]) => {
      const state = useSettingsStore.getState();
      const resolvedAIConfig = await resolveActiveAIConfig(state);

      if (!resolvedAIConfig) {
        Alert.alert(
          t("chat.configRequired", "需要配置 AI"),
          t("chat.configRequiredMessage", "请先在设置中配置 AI 端点和模型"),
          [
            { text: t("common.cancel", "取消"), style: "cancel" },
            {
              text: t("common.settings", "去设置"),
              onPress: onNavigateToSettings,
            },
          ],
        );
        return;
      }
      await sendMessage(text, bookId, deepThinking, spoilerFree, quotes, resolvedAIConfig);
    },
    [bookId, onNavigateToSettings, sendMessage, t],
  );

  const handleNewThread = useCallback(async () => {
    if (activeThread && activeThread.messages.length === 0) return;
    await createThread(bookId);
  }, [activeThread, bookId, createThread]);

  const [showExportMenu, setShowExportMenu] = useState(false);
  useEffect(() => {
    if (!active) setShowExportMenu(false);
  }, [active]);
  const exportTitle = activeThread?.title || book?.meta?.title || t("chat.aiAssistant");
  const exportOpts = useMemo(
    () => ({
      title: exportTitle,
      userLabel: t("chat.roleUser"),
      aiLabel: t("chat.roleAI"),
    }),
    [exportTitle, t],
  );

  const handleExportMarkdown = useCallback(async () => {
    setShowExportMenu(false);
    const md = exportChatAsMarkdown(allMessages, exportOpts);
    const filename = getExportFilename("md");
    const platform = getPlatformService();
    const saved = await platform.shareOrDownloadFile(md, filename, "text/markdown");
    if (saved) Alert.alert(t("chat.exportSuccess", "导出成功"));
  }, [allMessages, exportOpts, t]);

  const handleExportJSON = useCallback(async () => {
    setShowExportMenu(false);
    const json = exportChatAsJSON(allMessages, exportOpts);
    const filename = getExportFilename("json");
    const platform = getPlatformService();
    const saved = await platform.shareOrDownloadFile(json, filename, "application/json");
    if (saved) Alert.alert(t("chat.exportSuccess", "导出成功"));
  }, [allMessages, exportOpts, t]);

  const handleCopyAll = useCallback(async () => {
    setShowExportMenu(false);
    const text = formatChatForClipboard(allMessages, exportOpts);
    await Clipboard.setStringAsync(text);
    Alert.alert(t("chat.copiedSuccess", "已复制到剪贴板"));
  }, [allMessages, exportOpts, t]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setBookActiveThread(bookId, threadId);
      closeSidebar();
    },
    [bookId, closeSidebar, setBookActiveThread],
  );

  const suggestions = useMemo(
    () => [
      t("chat.suggestions.summarizeChapter"),
      t("chat.suggestions.explainConcepts"),
      t("chat.suggestions.analyzeAuthor"),
    ],
    [t],
  );

  const renderSidebarContent = useCallback(
    (closable: boolean) => (
      <>
        <View style={s.sidebarHeader}>
          <Text style={s.sidebarTitle}>{t("chat.history", "历史记录")}</Text>
          {closable ? (
            <TouchableOpacity style={s.iconBtn} onPress={closeSidebar}>
              <XIcon size={16} color={colors.foreground} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.newChatBtn} onPress={handleNewThread} activeOpacity={0.75}>
              <MessageCirclePlusIcon size={15} color={colors.foreground} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {bookThreads.length === 0 ? (
            <View style={s.sidebarEmpty}>
              <Text style={s.sidebarEmptyText}>{t("chat.noConversations", "暂无对话")}</Text>
            </View>
          ) : (
            groupedThreads.map(({ key, label, threads: sectionThreads }) => {
              if (sectionThreads.length === 0) return null;
              return (
                <View key={key}>
                  <Text style={s.sectionLabel}>{label}</Text>
                  {sectionThreads.map((thread) => {
                    const isActive = thread.id === activeThreadId;
                    const lastMsg =
                      thread.messages.length > 0
                        ? thread.messages[thread.messages.length - 1]
                        : null;
                    const preview = lastMsg?.content?.slice(0, 60) || "";
                    return (
                      <TouchableOpacity
                        key={thread.id}
                        style={[s.threadItem, isActive && s.threadItemActive]}
                        onPress={() => handleSelectThread(thread.id)}
                        activeOpacity={0.7}
                      >
                        <View style={s.threadContent}>
                          <View style={s.threadTitleRow}>
                            <Text
                              style={[s.threadTitle, isActive && s.threadTitleActive]}
                              numberOfLines={1}
                            >
                              {thread.title || t("chat.newChat", "新对话")}
                            </Text>
                            <Text style={s.threadTime}>{formatTime(thread.updatedAt)}</Text>
                          </View>
                          {preview ? (
                            <Text style={s.threadPreview} numberOfLines={1}>
                              {preview}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={s.threadDeleteBtn}
                          onPress={() => removeThread(thread.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Trash2Icon size={12} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      </>
    ),
    [
      activeThreadId,
      bookThreads.length,
      closeSidebar,
      colors.foreground,
      colors.mutedForeground,
      formatTime,
      groupedThreads,
      handleNewThread,
      handleSelectThread,
      removeThread,
      s,
      t,
    ],
  );

  return (
    <View
      style={s.container}
      pointerEvents={active ? "auto" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
    >
      <View style={s.shell} onLayout={layout.onContentLayout}>
        {isTabletLandscape && <View style={s.sidebarDocked}>{renderSidebarContent(false)}</View>}

        <View key="conversation" style={s.mainColumn}>
          <View style={s.header}>
            <View style={s.headerLeft}>
              <TouchableOpacity
                style={s.iconBtn}
                onPress={onClose}
                accessibilityLabel={t(
                  embedded ? "common.close" : "common.back",
                  embedded ? "关闭" : "返回",
                )}
                activeOpacity={0.7}
              >
                {embedded ? (
                  <XIcon size={20} color={colors.foreground} />
                ) : (
                  <ChevronLeftIcon size={20} color={colors.foreground} />
                )}
              </TouchableOpacity>
              {!isTabletLandscape && (
                <TouchableOpacity
                  style={s.iconBtn}
                  onPress={openSidebar}
                  activeOpacity={0.7}
                  accessibilityLabel={t("chat.history", "历史记录")}
                >
                  <HistoryIcon size={16} color={colors.foreground} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={s.headerTitle} numberOfLines={1}>
              {t("chat.aiAssistant", "AI 助手")}
            </Text>

            <View style={s.headerRight}>
              {allMessages.length > 0 && (
                <>
                  <TouchableOpacity
                    style={s.iconBtn}
                    onPress={() => setShowExportMenu(true)}
                    accessibilityLabel={t("chat.export", "导出对话")}
                    activeOpacity={0.7}
                  >
                    <ShareIcon size={16} color={colors.foreground} />
                  </TouchableOpacity>
                  <Modal
                    visible={active && showExportMenu}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setShowExportMenu(false)}
                  >
                    <Pressable style={s.exportOverlay} onPress={() => setShowExportMenu(false)}>
                      <View style={s.exportMenu}>
                        <TouchableOpacity
                          style={s.exportMenuItem}
                          activeOpacity={0.85}
                          onPress={handleExportMarkdown}
                        >
                          <ScrollTextIcon size={18} color={colors.foreground} />
                          <Text style={s.exportMenuText}>
                            {t("chat.exportMarkdown", "导出 Markdown")}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.exportMenuItem, s.exportMenuItemDivider]}
                          activeOpacity={0.85}
                          onPress={handleExportJSON}
                        >
                          <Download size={18} color={colors.foreground} />
                          <Text style={s.exportMenuText}>{t("chat.exportJSON", "导出 JSON")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.exportMenuItem}
                          activeOpacity={0.85}
                          onPress={handleCopyAll}
                        >
                          <CopyIcon size={18} color={colors.foreground} />
                          <Text style={s.exportMenuText}>{t("chat.copyAll", "复制全部")}</Text>
                        </TouchableOpacity>
                      </View>
                    </Pressable>
                  </Modal>
                </>
              )}
              <TouchableOpacity
                style={s.iconBtn}
                onPress={handleNewThread}
                activeOpacity={0.7}
                accessibilityLabel={t("chat.newChat", "新对话")}
              >
                <MessageCirclePlusIcon size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.modelRow}>
            <ModelSelector active={active} onNavigateToSettings={onNavigateToSettings} />
          </View>

          <KeyboardAvoidingView
            style={[s.content, { width: "100%", maxWidth: 760, alignSelf: "center" }]}
            behavior="height"
            enabled={!embedded && Platform.OS === "android"}
            keyboardVerticalOffset={embedded ? 0 : insets.top}
          >
            {selectedText?.trim() ? (
              <View style={s.selectionContext} accessibilityLabel="Selected text context">
                <Text style={s.selectionContextLabel}>{t("chat.selectedText", "选中文本")}</Text>
                <Text style={s.selectionContextText} numberOfLines={4}>
                  “{selectedText.trim()}”
                </Text>
              </View>
            ) : null}
            <View style={s.content}>
              {allMessages.length > 0 ? (
                <MessageList
                  messages={allMessages}
                  isStreaming={isStreaming}
                  currentStep={currentStep}
                  onCitationClick={onCitationClick}
                />
              ) : (
                <AdaptiveEmptyState
                  contentContainerStyle={{
                    paddingHorizontal: isTabletLandscape ? 52 : 24,
                  }}
                >
                  {(compact) => (
                    <View style={[s.emptyContainer, compact && s.emptyContainerCompact]}>
                      <View style={s.emptyInner}>
                        <Image
                          source={isDark ? THINK_DARK_PNG : THINK_PNG}
                          style={{ width: compact ? 96 : 120, height: compact ? 96 : 120 }}
                          resizeMode="contain"
                        />
                        <Text style={s.emptyTitle}>{t("chat.aiAssistant", "AI 阅读助手")}</Text>
                        <Text style={s.emptySubtitle}>
                          {t("chat.aiAssistantDesc", "分析内容、回答问题...")}
                        </Text>
                      </View>
                      <View style={s.suggestionsContainer}>
                        {suggestions.map((text) => (
                          <TouchableOpacity
                            key={text}
                            style={s.suggestionCard}
                            onPress={() => handleSend(text, false, false)}
                            activeOpacity={0.7}
                          >
                            <Text style={s.suggestionText}>{text}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </AdaptiveEmptyState>
              )}
            </View>
            {error && (
              <View style={s.errorBanner}>
                <Text style={s.errorText} numberOfLines={2}>
                  {error.message}
                </Text>
              </View>
            )}
            <ChatInput
              ref={chatInputRef}
              active={active}
              onInputFocusChange={handleInputFocusChange}
              onSend={handleSend}
              onStop={stopStream}
              isStreaming={isStreaming}
              placeholder={t("chat.askAboutBook", "询问关于这本书的问题...")}
              quotes={quotes}
              onRemoveQuote={handleRemoveQuote}
              keyboardBottomOffset={embedded ? 0 : insets.bottom}
            />
          </KeyboardAvoidingView>
        </View>
      </View>

      {!isTabletLandscape && (
        <View
          style={[StyleSheet.absoluteFill, { zIndex: 20 }]}
          pointerEvents={active && showSidebar ? "box-none" : "none"}
          accessibilityElementsHidden={!active || !showSidebar}
          importantForAccessibility={active && showSidebar ? "auto" : "no-hide-descendants"}
        >
          <Animated.View
            style={[s.sidebarBackdrop, { opacity: backdropAnim }]}
            pointerEvents={active && showSidebar ? "auto" : "none"}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
          </Animated.View>
          <Animated.View style={[s.sidebar, { transform: [{ translateX: sidebarAnim }] }]}>
            {renderSidebarContent(true)}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (
  colors: ThemeColors,
  layout: { isTabletLandscape: boolean; sidebarWidth: number },
) =>
  StyleSheet.create({
    container: {
      flex: 1,
      minWidth: 0,
      position: "relative",
      overflow: "hidden",
      backgroundColor: colors.background,
    },
    shell: { flex: 1, flexDirection: layout.isTabletLandscape ? "row" : "column" },
    sidebarDocked: {
      width: layout.sidebarWidth,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    mainColumn: { flex: 1, minWidth: 0 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 48,
      paddingHorizontal: layout.isTabletLandscape ? 20 : 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
      zIndex: 10,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    headerTitle: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
      textAlign: "center",
      flex: 1,
      minWidth: 0,
    },
    modelRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    content: { flex: 1 },
    selectionContext: {
      marginHorizontal: layout.isTabletLandscape ? 20 : 12,
      marginTop: 8,
      marginBottom: 4,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: radius.md,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      backgroundColor: withOpacity(colors.muted, 0.72),
    },
    selectionContextLabel: {
      fontSize: fs.xs,
      fontWeight: fw.semibold,
      color: colors.primary,
      marginBottom: 3,
    },
    selectionContextText: {
      fontSize: fs.sm,
      lineHeight: 19,
      color: colors.foreground,
    },
    emptyContainer: {
      gap: 24,
    },
    emptyContainerCompact: {
      gap: 16,
    },
    emptyInner: {
      alignItems: "center",
      gap: 8,
    },
    emptyTitle: {
      fontSize: fs.lg,
      fontWeight: fw.semibold,
      color: colors.foreground,
      marginTop: 4,
      textAlign: "center",
    },
    emptySubtitle: {
      fontSize: fs.sm,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    suggestionsContainer: {
      flexDirection: layout.isTabletLandscape ? "row" : "column",
      flexWrap: layout.isTabletLandscape ? "wrap" : "nowrap",
      gap: 6,
    },
    suggestionCard: {
      width: layout.isTabletLandscape ? "48%" : undefined,
      minHeight: 44,
      justifyContent: "center",
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    suggestionText: {
      fontSize: fs.sm,
      color: colors.foreground,
    },
    errorBanner: {
      marginHorizontal: 12,
      marginBottom: 4,
      backgroundColor: withOpacity(colors.destructive, 0.9),
      borderRadius: radius.lg,
      padding: 12,
    },
    errorText: {
      fontSize: fs.sm,
      color: colors.primaryForeground,
    },
    sidebarBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.2)",
    },
    sidebar: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: layout.sidebarWidth,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: 12,
      paddingBottom: 12,
      shadowColor: "#000",
      shadowOffset: { width: 2, height: 0 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 8,
    },
    newChatBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withOpacity(colors.muted, 0.72),
    },
    sidebarHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
    },
    sidebarTitle: {
      fontSize: fs.sm,
      fontWeight: fw.semibold,
      color: colors.foreground,
    },
    sidebarEmpty: {
      paddingVertical: 40,
      alignItems: "center",
    },
    sidebarEmptyText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    threadItem: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    threadItemActive: {
      backgroundColor: withOpacity(colors.primary, 0.08),
    },
    threadContent: {
      flex: 1,
      gap: 2,
    },
    threadTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    threadTitle: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
      flex: 1,
    },
    threadTitleActive: {
      color: colors.primary,
    },
    threadTime: {
      fontSize: 11,
      color: colors.mutedForeground,
      opacity: 0.5,
    },
    threadPreview: {
      fontSize: 13,
      color: colors.mutedForeground,
    },
    threadDeleteBtn: {
      marginTop: 2,
      padding: 4,
    },
    exportOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.12)",
      justifyContent: "flex-start",
      alignItems: "stretch",
      paddingTop: 56,
      paddingHorizontal: 12,
    },
    exportMenu: {
      alignSelf: "flex-end",
      minWidth: 200,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 18,
      elevation: 14,
      overflow: "hidden",
      paddingVertical: 6,
    },
    exportMenuItem: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
    },
    exportMenuItemDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    exportMenuText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
    },
  });

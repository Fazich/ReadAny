import { GroupPickerSheet } from "@/components/library/GroupPickerSheet";
import { SheetShell } from "@/components/ui/SheetShell";
import {
  BOOK_MENU_BORDER_WIDTH,
  BOOK_MENU_CONTENT_PADDING,
  resolveBookMenuLayout,
} from "./book-card-menu-layout";
import {
  CheckIcon,
  DatabaseIcon,
  FolderInputIcon,
  HashIcon,
  InfoIcon,
  Trash2Icon,
} from "@/components/ui/Icon";
import { useLibraryStore } from "@/stores/library-store";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import type { Book } from "@readany/core/types";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  type LayoutRectangle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface BookCardActionSheetProps {
  visible: boolean;
  anchor: LayoutRectangle | null;
  book: Book;
  onClose: () => void;
  onShowDetails?: (book: Book) => void;
  onManageTags?: (book: Book) => void;
  onVectorize?: (book: Book) => void;
  onDelete: (bookId: string, options?: { preserveData?: boolean }) => void;
}

type BookMenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

function MeasuredBookMenu({
  anchor,
  items,
}: { anchor: LayoutRectangle | null; items: readonly BookMenuItem[] }): React.JSX.Element | null {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [naturalContentHeight, setNaturalContentHeight] = useState<number | null>(null);
  const layout = resolveBookMenuLayout({
    anchor, naturalContentHeight, screenWidth, screenHeight, insets,
  });
  if (layout.width === 0 || layout.height <= 2 * BOOK_MENU_BORDER_WIDTH) return null;

  return (
    <View
      style={[
        styles.menu,
        { left: layout.left, top: layout.top, width: layout.width, height: layout.height,
          opacity: layout.ready ? 1 : 0 },
      ]}
      pointerEvents={layout.ready ? "auto" : "none"}
      accessibilityElementsHidden={!layout.ready}
      importantForAccessibility={layout.ready ? "auto" : "no-hide-descendants"}
    >
      <ScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={(_, height) => {
          if (!Number.isFinite(height) || height <= 0) return;
          setNaturalContentHeight((previous) =>
            previous === null || Math.abs(previous - height) > 0.5 ? height : previous,
          );
        }}
      >
        {items.map((item, index) => (
          <TouchableOpacity
            key={item.key}
            style={[styles.item, index < items.length - 1 && styles.itemDivider]}
            activeOpacity={0.85}
            onPress={item.onPress}
          >
            <View style={styles.itemIcon}>{item.icon}</View>
            <Text style={item.destructive ? styles.itemTextDestructive : styles.itemText}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

export function BookCardActionSheet({
  visible,
  anchor,
  book,
  onClose,
  onShowDetails,
  onManageTags,
  onVectorize,
  onDelete,
}: BookCardActionSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: screenWidth, height: screenHeight, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [preserveDataOnDelete, setPreserveDataOnDelete] = useState(true);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const groups = useLibraryStore((state) => state.groups);
  const moveBookToGroup = useLibraryStore((state) => state.moveBookToGroup);
  const removeBookFromGroup = useLibraryStore((state) => state.removeBookFromGroup);
  const addGroup = useLibraryStore((state) => state.addGroup);

  const handleMoveGroup = () => {
    onClose();
    setShowGroupPicker(true);
  };

  const items = [
    onShowDetails
      ? {
          key: "details",
          icon: <InfoIcon size={18} color={colors.foreground} />,
          label: t("library.detailsAction", "书籍详情"),
          onPress: () => {
            onClose();
            onShowDetails(book);
          },
        }
      : null,
    {
      key: "group",
      icon: <FolderInputIcon size={18} color={colors.foreground} />,
      label: book.groupId
        ? t("library.changeGroup", "更换分组")
        : t("library.moveToGroup", "移入分组"),
      onPress: handleMoveGroup,
    },
    onManageTags
      ? {
          key: "tags",
          icon: <HashIcon size={18} color={colors.foreground} />,
          label: t("home.manageTags", "管理标签"),
          onPress: () => {
            onClose();
            onManageTags(book);
          },
        }
      : null,
    onVectorize
      ? {
          key: "vectorize",
          icon: <DatabaseIcon size={18} color={colors.foreground} />,
          label: book.isVectorized
            ? t("home.vec_reindex", "重新索引")
            : t("home.vec_vectorize", "向量化"),
          onPress: () => {
            onClose();
            if (book.isVectorized) {
              Alert.alert(
                t("home.vec_reindex", "重新索引"),
                t(
                  "home.vec_reindexConfirm",
                  "该书已完成索引，重新索引将重置现有数据，确定继续吗？",
                ),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("common.confirm"), onPress: () => onVectorize(book) },
                ],
              );
            } else {
              onVectorize(book);
            }
          },
        }
      : null,
    {
      key: "delete",
      icon: <Trash2Icon size={18} color={colors.destructive} />,
      label: t("common.remove", "删除"),
      destructive: true,
      onPress: () => {
        onClose();
        setPreserveDataOnDelete(true);
        setShowDeleteConfirm(true);
      },
    },
  ].filter(Boolean) as BookMenuItem[];

  const menuLayout = resolveBookMenuLayout({
    anchor, naturalContentHeight: null, screenWidth, screenHeight, insets,
  });
  const menuMeasurementKey = JSON.stringify([
    menuLayout.width, fontScale, items.map(({ key, label }) => [key, label]),
  ]);

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          {visible && menuLayout.width > 0 && menuLayout.height > 2 * BOOK_MENU_BORDER_WIDTH && (
            <MeasuredBookMenu key={menuMeasurementKey} anchor={anchor} items={items} />
          )}
        </View>
      </Modal>

      <SheetShell
        visible={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        placement="center"
        maxWidth={360}
        backdropColor="rgba(0,0,0,0.32)"
        surfaceStyle={styles.confirmCard}
        footer={
          <View style={styles.confirmActions}>
            <TouchableOpacity
              style={styles.confirmSecondary}
              onPress={() => setShowDeleteConfirm(false)}
            >
              <Text style={styles.confirmSecondaryText}>{t("common.cancel", "取消")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmDanger}
              onPress={() => {
                setShowDeleteConfirm(false);
                onDelete(book.id, { preserveData: preserveDataOnDelete });
              }}
            >
              <Text style={styles.confirmDangerText}>{t("common.remove", "删除")}</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <ScrollView style={styles.confirmScroll} contentContainerStyle={styles.confirmContent}>
            <Text style={styles.confirmTitle}>{t("library.deleteBookTitle", "删除这本书？")}</Text>
            <Text style={styles.confirmDescription}>
              {t(
                "library.deleteBookDescription",
                "你可以选择保留笔记和阅读统计，之后重新导入同一本书时会继续接上。",
              )}
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.checkboxRow}
              onPress={() => setPreserveDataOnDelete((value) => !value)}
            >
              <View style={[styles.checkbox, preserveDataOnDelete && styles.checkboxActive]}>
                {preserveDataOnDelete ? (
                  <CheckIcon size={12} color={colors.primaryForeground} />
                ) : null}
              </View>
              <View style={styles.checkboxContent}>
                <Text style={styles.checkboxLabel}>
                  {t("library.preserveDeleteDataLabel", "保留笔记和阅读统计")}
                </Text>
                <Text style={styles.checkboxHint}>
                  {t(
                    "library.preserveDeleteDataHint",
                    "勾选后会从书架移除书籍文件，但保留笔记、高亮和阅读历史，重新导入时可恢复。",
                  )}
                </Text>
              </View>
            </TouchableOpacity>
        </ScrollView>
      </SheetShell>
      <GroupPickerSheet
        visible={showGroupPicker}
        groups={groups}
        currentGroupId={book.groupId}
        onSelect={(groupId) => {
          if (groupId) {
            moveBookToGroup(book.id, groupId);
          } else {
            removeBookFromGroup(book.id);
          }
        }}
        onCreateGroup={async (name) => {
          const group = await addGroup(name);
          if (group) moveBookToGroup(book.id, group.id);
        }}
        onClose={() => setShowGroupPicker(false)}
      />
    </>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.12)",
    },
    menu: {
      position: "absolute",
      borderRadius: radius.xl,
      borderWidth: BOOK_MENU_BORDER_WIDTH,
      borderColor: colors.border,
      backgroundColor: colors.card,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 18,
      elevation: 14,
      overflow: "hidden",
    },
    menuScroll: { flex: 1, minHeight: 0 },
    menuContent: { paddingVertical: BOOK_MENU_CONTENT_PADDING },
    item: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
    },
    itemDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    itemIcon: {
      width: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    itemText: {
      flex: 1,
      minWidth: 0,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    itemTextDestructive: {
      flex: 1,
      minWidth: 0,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.destructive,
    },
    confirmScroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
    confirmContent: { gap: spacing.md },
    confirmCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xl,
      gap: spacing.md,
    },
    confirmTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    confirmDescription: {
      fontSize: fontSize.sm,
      lineHeight: 20,
      color: colors.mutedForeground,
    },
    checkboxRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: colors.mutedForeground,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checkboxActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    checkboxContent: {
      flex: 1,
      gap: 4,
    },
    checkboxLabel: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    checkboxHint: {
      fontSize: fontSize.xs,
      lineHeight: 18,
      color: colors.mutedForeground,
    },
    confirmActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 10,
      marginTop: spacing.md,
    },
    confirmSecondary: {
      minWidth: 92,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: colors.background,
    },
    confirmSecondaryText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    confirmDanger: {
      minWidth: 92,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: colors.destructive,
    },
    confirmDangerText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.destructiveForeground,
    },
  });

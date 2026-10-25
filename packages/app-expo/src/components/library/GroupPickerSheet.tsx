import { FolderPlusIcon } from "@/components/ui/Icon";
import { SheetShell } from "@/components/ui/SheetShell";
import { type ThemeColors, fontSize, fontWeight, radius, spacing, useColors } from "@/styles/theme";
import type { BookGroup } from "@readany/core/types";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

interface GroupPickerSheetProps {
  visible: boolean;
  groups: BookGroup[];
  currentGroupId?: string;
  onSelect: (groupId: string | undefined) => void;
  onCreateGroup: (name: string) => void;
  onClose: () => void;
}

export function GroupPickerSheet({
  visible,
  groups,
  currentGroupId,
  onSelect,
  onCreateGroup,
  onClose,
}: GroupPickerSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const bodyRef = useRef<ScrollView>(null);
  const createRowY = useRef<number | null>(null);
  const scrollToCreateRow = () => {
    if (isCreating && createRowY.current !== null) {
      bodyRef.current?.scrollTo({ y: createRowY.current, animated: false });
    }
  };

  const handleCreate = () => {
    const name = newGroupName.trim();
    if (!name) return;
    onCreateGroup(name);
    setNewGroupName("");
    setIsCreating(false);
    onClose();
  };

  const handleSelect = (groupId: string | undefined) => {
    onSelect(groupId);
    onClose();
  };

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      placement="bottom"
      keyboardAware
      surfaceStyle={styles.sheet}
      header={
        <>
          <View style={styles.handle} />
          <Text style={styles.title}>{t("library.moveToGroup", "移入分组")}</Text>
        </>
      }
    >
      <ScrollView
        ref={bodyRef}
        style={styles.body}
        keyboardShouldPersistTaps="handled"
        onLayout={scrollToCreateRow}
      >
            {groups.length > 0 && (
              <View style={styles.groupList}>
                {groups.map((group) => (
                  <TouchableOpacity
                    key={group.id}
                    style={styles.groupItem}
                    activeOpacity={0.7}
                    onPress={() => handleSelect(group.id)}
                  >
                    <Text style={styles.groupName}>{group.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {isCreating ? (
              <View
                style={styles.createRow}
                onLayout={(event) => {
                  createRowY.current = event.nativeEvent.layout.y;
                  scrollToCreateRow();
                }}
              >
                <TextInput
                  style={styles.createInput}
                  placeholder={t("library.groupNamePlaceholder", "分组名称")}
                  placeholderTextColor={colors.mutedForeground}
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  autoFocus
                  onFocus={scrollToCreateRow}
                  onSubmitEditing={handleCreate}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.createBtn, !newGroupName.trim() && styles.createBtnDisabled]}
                  disabled={!newGroupName.trim()}
                  onPress={handleCreate}
                >
                  <Text style={styles.createBtnText}>{t("common.confirm", "确定")}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.newGroupBtn}
                activeOpacity={0.7}
                onPress={() => setIsCreating(true)}
              >
                <FolderPlusIcon size={20} color={colors.primary} />
                <Text style={styles.newGroupText}>{t("library.createGroup", "新建分组")}</Text>
              </TouchableOpacity>
            )}

            {currentGroupId && (
              <TouchableOpacity
                style={styles.ungroupedBtn}
                activeOpacity={0.7}
                onPress={() => handleSelect(undefined)}
              >
                <Text style={styles.ungroupedText}>{t("library.removeFromGroup", "移出分组")}</Text>
              </TouchableOpacity>
            )}
      </ScrollView>
    </SheetShell>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.card,
      paddingTop: 10,
      paddingHorizontal: 16,
    },
    body: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: `${colors.mutedForeground}40`,
      alignSelf: "center",
      marginBottom: spacing.md,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: spacing.md,
      paddingHorizontal: 4,
    },
    groupList: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      marginBottom: spacing.sm,
    },
    groupItem: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    groupName: {
      fontSize: fontSize.base,
      color: colors.foreground,
    },
    newGroupBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.sm,
    },
    newGroupText: {
      fontSize: fontSize.base,
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
    createRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    createInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: fontSize.base,
      color: colors.foreground,
      backgroundColor: colors.background,
    },
    createBtn: {
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
    },
    createBtnDisabled: {
      opacity: 0.5,
    },
    createBtnText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    ungroupedBtn: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    ungroupedText: {
      fontSize: fontSize.base,
      color: colors.destructive,
    },
  });

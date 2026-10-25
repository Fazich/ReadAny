import { SheetShell } from "@/components/ui/SheetShell";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
  withOpacity,
} from "@/styles/theme";
import { Picker } from "@react-native-picker/picker";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  DATE_PRECISIONS,
  type DatePrecision,
  MONTH_OPTIONS,
  YEAR_OPTIONS,
  buildPublishDateValue,
  datePrecisionLabel,
  formatMonthLabel,
  getDatePrecision,
  getDaysInMonth,
  normalizeDateParts,
} from "./book-details-date";

type TextMetadataField = "description";
export type OptionPickerTarget = {
  field: "language" | "groupId";
  label: string;
  value: string;
  options: { value: string; label: string }[];
};
export type TextEditorTarget =
  | {
      kind: "field";
      field: TextMetadataField;
      label: string;
      value: string;
      placeholder: string;
      multiline?: boolean;
    }
  | {
      kind: "review";
      reviewId: string;
      label: string;
      value: string;
      placeholder: string;
    }
  | {
      kind: "newReview";
      label: string;
      value: string;
      placeholder: string;
    };

function SheetHeader({
  title,
  cancelLabel,
  doneLabel,
  onClose,
  onDone,
}: {
  title: string;
  cancelLabel: string;
  doneLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <>
      <View style={styles.sheetHandle} />
      <View style={styles.textSheetHeader}>
        <TouchableOpacity
          style={styles.textSheetGhostButton}
          activeOpacity={0.82}
          onPress={onClose}
        >
          <Text style={styles.textSheetGhostButtonText}>{cancelLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.textSheetTitle}>{title}</Text>
        <TouchableOpacity style={styles.textSheetDoneButton} activeOpacity={0.82} onPress={onDone}>
          <Text style={styles.textSheetDoneButtonText}>{doneLabel}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

export function TextEditSheet({
  target,
  doneLabel,
  cancelLabel,
  onClose,
  onDone,
}: {
  target: TextEditorTarget | null;
  doneLabel: string;
  cancelLabel: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);
  const multiline = Boolean(target && (target.kind !== "field" || target.multiline));

  useEffect(() => {
    setDraft(target?.value ?? "");
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps({
        selection: { start: target.value.length, end: target.value.length },
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [target]);

  return (
    <SheetShell
      visible={Boolean(target)}
      onClose={onClose}
      placement="bottom"
      keyboardAware
      surfaceStyle={[styles.textSheet, multiline && styles.textSheetTall]}
      bodyStyle={multiline ? styles.multilineBody : undefined}
      header={
        <SheetHeader
          title={target?.label ?? ""}
          cancelLabel={cancelLabel}
          doneLabel={doneLabel}
          onClose={onClose}
          onDone={() => onDone(draft)}
        />
      }
    >
      <TextInput
        ref={inputRef}
        style={[styles.textSheetInput, multiline ? styles.textSheetMultilineInput : undefined]}
        value={draft}
        placeholder={target?.placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        returnKeyType={multiline ? "default" : "done"}
        onChangeText={setDraft}
        onSubmitEditing={() => {
          if (multiline) return;
          onDone(draft);
        }}
      />
    </SheetShell>
  );
}

export function OptionPickerSheet({
  target,
  doneLabel,
  cancelLabel,
  onClose,
  onDone,
}: {
  target: OptionPickerTarget | null;
  doneLabel: string;
  cancelLabel: string;
  onClose: () => void;
  onDone: (target: OptionPickerTarget, value: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(target?.value ?? "");
  }, [target]);

  return (
    <SheetShell
      visible={Boolean(target)}
      onClose={onClose}
      placement="bottom"
      surfaceStyle={styles.textSheet}
      header={
        <SheetHeader
          title={target?.label ?? ""}
          cancelLabel={cancelLabel}
          doneLabel={doneLabel}
          onClose={onClose}
          onDone={() => {
            if (target) onDone(target, draft);
          }}
        />
      }
    >
      <ScrollView style={styles.scrollBody}>
        <View style={styles.pickerSheetSurface}>
          <Picker
            selectedValue={draft}
            onValueChange={(nextValue) => {
              if (typeof nextValue === "string") setDraft(nextValue);
            }}
            itemStyle={styles.pickerItem}
            style={styles.nativePicker}
          >
            {(target?.options ?? []).map((option) => (
              <Picker.Item key={option.value || "none"} label={option.label} value={option.value} />
            ))}
          </Picker>
        </View>
      </ScrollView>
    </SheetShell>
  );
}

export function DatePickerSheet({
  visible,
  value,
  locale,
  title,
  doneLabel,
  cancelLabel,
  t,
  onClose,
  onDone,
}: {
  visible: boolean;
  value: string;
  locale: string;
  title: string;
  doneLabel: string;
  cancelLabel: string;
  t: TFunction;
  onClose: () => void;
  onDone: (value: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [draftPrecision, setDraftPrecision] = useState<DatePrecision>(
    value.trim() ? getDatePrecision(value) : "day",
  );
  const [draftParts, setDraftParts] = useState(() => normalizeDateParts(value));

  useEffect(() => {
    if (!visible) return;
    setDraftPrecision(value.trim() ? getDatePrecision(value) : "day");
    setDraftParts(normalizeDateParts(value));
  }, [value, visible]);

  const dayOptions = useMemo(
    () =>
      Array.from({ length: getDaysInMonth(draftParts.year, draftParts.month) }, (_, index) =>
        String(index + 1).padStart(2, "0"),
      ),
    [draftParts.year, draftParts.month],
  );

  const setPart = (key: keyof ReturnType<typeof normalizeDateParts>, nextValue: string) => {
    setDraftParts((current) => {
      const nextParts = { ...current, [key]: nextValue };
      const maxDay = getDaysInMonth(nextParts.year, nextParts.month);
      if (Number(nextParts.day) > maxDay) nextParts.day = String(maxDay).padStart(2, "0");
      return nextParts;
    });
  };

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      placement="bottom"
      surfaceStyle={styles.textSheet}
      header={
        <SheetHeader
          title={title}
          cancelLabel={cancelLabel}
          doneLabel={doneLabel}
          onClose={onClose}
          onDone={() => onDone(buildPublishDateValue(draftParts, draftPrecision))}
        />
      }
    >
      <ScrollView style={styles.scrollBody}>
        <View style={styles.segmentRow}>
          {DATE_PRECISIONS.map((item) => {
            const selected = draftPrecision === item;
            return (
              <TouchableOpacity
                key={item}
                style={[styles.segmentButton, selected && styles.segmentButtonActive]}
                activeOpacity={0.82}
                onPress={() => setDraftPrecision(item)}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>
                  {datePrecisionLabel(item, t)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.datePickerColumns}>
          <PickerColumn
            value={draftParts.year}
            options={YEAR_OPTIONS}
            onSelect={(nextValue) => setPart("year", nextValue)}
            styles={styles}
          />
          {draftPrecision !== "year" ? (
            <PickerColumn
              value={draftParts.month}
              options={MONTH_OPTIONS}
              format={(month) => formatMonthLabel(month, locale)}
              onSelect={(nextValue) => setPart("month", nextValue)}
              styles={styles}
            />
          ) : null}
          {draftPrecision === "day" ? (
            <PickerColumn
              value={draftParts.day}
              options={dayOptions}
              onSelect={(nextValue) => setPart("day", nextValue)}
              styles={styles}
            />
          ) : null}
        </View>
      </ScrollView>
    </SheetShell>
  );
}

function PickerColumn({
  value,
  options,
  format,
  onSelect,
  styles,
}: {
  value: string;
  options: string[];
  format?: (value: string) => string;
  onSelect: (value: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.pickerWheel}>
      <Picker
        selectedValue={value}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string" && nextValue !== value) onSelect(nextValue);
        }}
        itemStyle={styles.pickerItem}
        style={styles.nativePicker}
      >
        {options.map((option) => (
          <Picker.Item key={option} label={format ? format(option) : option} value={option} />
        ))}
      </Picker>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    textSheet: {
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.86),
      backgroundColor: colors.card,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -12 },
      shadowOpacity: 0.2,
      shadowRadius: 22,
      elevation: 18,
    },
    textSheetTall: {
      height: "68%",
    },
    pickerSheetSurface: {
      overflow: "hidden",
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.82),
      backgroundColor: withOpacity(colors.background, 0.38),
    },
    sheetHandle: {
      alignSelf: "center",
      width: 38,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: withOpacity(colors.mutedForeground, 0.28),
      marginBottom: spacing.sm,
    },
    textSheetHeader: {
      minHeight: 42,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    textSheetTitle: {
      flex: 1,
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      textAlign: "center",
    },
    textSheetGhostButton: {
      minWidth: 54,
      minHeight: 34,
      alignItems: "flex-start",
      justifyContent: "center",
    },
    textSheetGhostButtonText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    textSheetDoneButton: {
      minWidth: 54,
      minHeight: 34,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    textSheetDoneButtonText: {
      color: colors.primary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    textSheetInput: {
      minHeight: 44,
      marginTop: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.86),
      backgroundColor: withOpacity(colors.background, 0.72),
      color: colors.foreground,
      fontSize: fontSize.base,
      lineHeight: 22,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    textSheetMultilineInput: {
      flex: 1,
      minHeight: 0,
      textAlignVertical: "top",
    },
    segmentRow: {
      flexDirection: "row",
      gap: spacing.xs,
      padding: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withOpacity(colors.border, 0.62),
    },
    segmentButton: {
      flex: 1,
      minHeight: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: "transparent",
    },
    segmentButtonActive: {
      backgroundColor: withOpacity(colors.primary, 0.14),
    },
    segmentText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    segmentTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    datePickerColumns: {
      height: 200,
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.sm,
    },
    pickerWheel: {
      flex: 1,
      minWidth: 0,
      position: "relative",
      overflow: "hidden",
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.background, 0.46),
    },
    nativePicker: {
      width: "100%",
      height: 200,
    },
    pickerItem: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    multilineBody: { flex: 1 },
    scrollBody: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  });

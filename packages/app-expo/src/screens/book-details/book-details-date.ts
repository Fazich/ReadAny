import type { TFunction } from "i18next";

export const DATE_PRECISIONS = ["year", "month", "day"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];
export const YEAR_OPTIONS = Array.from({ length: 220 }, (_, index) =>
  String(new Date().getFullYear() + 5 - index),
);
export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);

export function getDatePrecision(value: string): DatePrecision {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "day";
  if (/^\d{4}-\d{2}$/.test(value)) return "month";
  return "year";
}

export function getTodayParts() {
  const today = new Date();
  return {
    year: String(today.getFullYear()),
    month: String(today.getMonth() + 1).padStart(2, "0"),
    day: String(today.getDate()).padStart(2, "0"),
  };
}

export function normalizeDateParts(value: string) {
  const match = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  const today = getTodayParts();
  return {
    year: match?.[1] ?? today.year,
    month: match?.[2] ?? today.month,
    day: match?.[3] ?? today.day,
  };
}

export function buildPublishDateValue(
  parts: { year: string; month: string; day: string },
  precision: DatePrecision,
) {
  if (precision === "day") return `${parts.year}-${parts.month}-${parts.day}`;
  if (precision === "month") return `${parts.year}-${parts.month}`;
  return parts.year;
}

export function getDaysInMonth(year: string, month: string) {
  return new Date(Number(year), Number(month), 0).getDate();
}

export function datePrecisionLabel(precision: DatePrecision, t: TFunction) {
  if (precision === "day") return t("library.detailsDatePrecisionDay", "年月日");
  if (precision === "month") return t("library.detailsDatePrecisionMonth", "年月");
  return t("library.detailsDatePrecisionYear", "仅年份");
}

export function formatMonthLabel(month: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, { month: "short" }).format(
      new Date(2024, Number(month) - 1, 1),
    );
  } catch {
    return month;
  }
}

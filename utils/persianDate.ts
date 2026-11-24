/**
 * Persian (Jalali) Date Utilities - v1.0.1
 * Strict Asia/Tehran timezone support
 */

export const IRAN_TIMEZONE = 'Asia/Tehran';

export const WEEK_DAYS_PERSIAN = ['شنبه', 'یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

/**
 * Converts Jalali year, month, day to Gregorian year, month, day
 */
export function jalaliToGregorian(j_y: number, j_m: number, j_d: number): { gy: number; gm: number; gd: number } {
  let gy = (j_y > 979) ? 1600 : 621;
  j_y = (j_y > 979) ? (j_y - 979) : j_y;
  let days = (365 * j_y) + (Math.floor(j_y / 33) * 8) + Math.floor(((j_y % 33) + 3) / 4) + 78 + j_d + ((j_m < 7) ? (j_m - 1) * 31 : ((j_m - 7) * 30) + 186);
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 0; gm < 13 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return { gy, gm, gd };
}

/**
 * Get mathematically accurate Persian day name for any Jalali date
 * e.g. (1405, 6, 17) => 'سه‌شنبه'
 * e.g. (1405, 6, 16) => 'دوشنبه'
 */
export function getDayNameForJalali(jy: number, jm: number, jd: number): string {
  const g = jalaliToGregorian(jy, jm, jd);
  const dt = new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 12, 0, 0));
  // getUTCDay(): 0=Sunday (یک‌شنبه), 1=Monday (دوشنبه), 2=Tuesday (سه‌شنبه), 3=Wednesday (چهارشنبه), 4=Thursday (پنج‌شنبه), 5=Friday (جمعه), 6=Saturday (شنبه)
  const weekDays = ['یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
  return weekDays[dt.getUTCDay()];
}

/**
 * Fixed Asia/Tehran UTC offset (+03:30, Iran permanently abolished DST in 2022)
 */
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

/**
 * Converts Gregorian year, month (1-12), day (1-31) to Jalali year, month (1-12), day (1-31)
 * Pure mathematical conversion — 100% deterministic across all browsers, Safari, and Android WebViews.
 */
export function gregorianToJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days =
    355666 +
    (365 * gy) +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return { jy, jm, jd };
}

/**
 * Returns current Persian date parts in Asia/Tehran timezone (pure mathematical, zero Intl quirks)
 */
export function getTodayPersianParts(date: Date = new Date()): { year: number; month: string; day: string; monthIndex: number } {
  const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const tehran = new Date(safeDate.getTime() + TEHRAN_OFFSET_MS);
  const { jy, jm, jd } = gregorianToJalali(
    tehran.getUTCFullYear(),
    tehran.getUTCMonth() + 1,
    tehran.getUTCDate()
  );
  const month = String(jm).padStart(2, '0');
  const day = String(jd).padStart(2, '0');
  return {
    year: jy,
    month,
    day,
    monthIndex: Math.max(0, Math.min(11, jm - 1))
  };
}

/**
 * Returns Persian date string for right now in Asia/Tehran timezone: YYYY/MM/DD
 * (e.g. "1405/09/04")
 */
export function getTodayPersianDateStr(date: Date = new Date()): string {
  const { year, month, day } = getTodayPersianParts(date);
  return `${year}/${month}/${day}`;
}

/**
 * Returns current time in Asia/Tehran timezone formatted as Persian digits: HH:MM
 */
export function getTodayPersianTimeStr(date: Date = new Date()): string {
  const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const tehran = new Date(safeDate.getTime() + TEHRAN_OFFSET_MS);
  const hh = String(tehran.getUTCHours()).padStart(2, '0');
  const mm = String(tehran.getUTCMinutes()).padStart(2, '0');
  return toPersianDigits(`${hh}:${mm}`);
}

/**
 * Returns current day of week in Persian (e.g. "سه‌شنبه") in Asia/Tehran timezone
 */
export function getTodayPersianWeekday(date: Date = new Date()): string {
  const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const tehran = new Date(safeDate.getTime() + TEHRAN_OFFSET_MS);
  const weekDays = ['یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
  return weekDays[tehran.getUTCDay()];
}

/**
 * Returns current Gregorian date string in Asia/Tehran timezone formatted as DD.MM.YYYY
 * (e.g. "09.09.2026")
 */
export function getTodayGregorianDateStr(date: Date = new Date()): string {
  const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const tehran = new Date(safeDate.getTime() + TEHRAN_OFFSET_MS);
  const dd = String(tehran.getUTCDate()).padStart(2, '0');
  const mm = String(tehran.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(tehran.getUTCFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Converts English digits to Persian digits
 */
export const toPersianDigits = (s: string | number): string => 
  String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * Converts Persian and Arabic digits to standard ASCII English digits (0-9)
 */
export const toEnglishDigits = (s: string | number | null | undefined): string => {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
};

/**
 * Returns a new Jalali date string (YYYY/MM/DD) offset by `daysToAdd` days
 */
export function getNextJalaliDate(jalaliDate: string, daysToAdd: number = 1): string {
  const parts = toEnglishDigits(jalaliDate).split('/').map(Number);
  if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return jalaliDate;
  }
  const g = jalaliToGregorian(parts[0], parts[1], parts[2]);
  const dt = new Date(Date.UTC(g.gy, g.gm - 1, g.gd + daysToAdd, 12, 0, 0));
  const { jy, jm, jd } = gregorianToJalali(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

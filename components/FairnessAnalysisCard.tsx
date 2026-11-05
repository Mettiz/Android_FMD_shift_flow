/**
 * Shift Schedule Fairness & Weighted Hours Analysis Component - v4.2.0
 * Provides 100% accurate canonical name matching, RTL-aligned benchmark bars,
 * dual Day/Night stacked breakdown, visual BarChart comparison, and precise
 * weighted/raw hour equity analytics for managers.
 */
import React, { useMemo, useState } from 'react';
import {
  Scale,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Moon,
  Sun,
  Zap,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Info,
  ShieldAlert,
  Sparkles,
  BarChart2,
  ListFilter,
  Users,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { ShiftEntry, Personnel, SHIFT_WEIGHTS } from '../types';
import { toPersianDigits } from '../utils/persianDate';
import { isSamePersonName } from '../utils/shiftNotifications';
import { getPersonColor as resolveCanonicalPersonColor } from '../utils/personnelColors';

export interface EmployeeFairnessMetric {
  name: string;
  shortName: string;
  dayCount: number;
  nightCount: number;
  totalShifts: number;
  holidayCount: number;
  rawHours: number;
  dayRawHours: number;
  nightRawHours: number;
  weightedScore: number;
  dayWeightedHours: number;
  nightWeightedHours: number;
  consecutiveNightsMax: number;
  deviationPercent: number;
  diffFromMean: number;
  sharePercent: number;
  status: 'optimal' | 'slight_high' | 'slight_low' | 'overload' | 'underload';
  hasFatigueRisk: boolean;
  color: string;
}

interface FairnessAnalysisCardProps {
  scheduleData: ShiftEntry[];
  shiftWorkers: string[];
  personnelList?: Personnel[];
  onQuickSwapSuggest?: (fromPerson: string, toPerson: string) => void;
}

/**
 * Splits composite or array participant entries cleanly and matches using canonical Persian name logic
 */
function extractShiftParticipants(primary?: string, extras?: string[]): string[] {
  const base = String(primary || '')
    .split(/[\/،,\-\+]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== 'نامشخص' && s !== '---');
  const ext = Array.isArray(extras)
    ? extras.map((s) => String(s || '').trim()).filter((s) => s && s !== 'نامشخص' && s !== '---')
    : [];
  const combined: string[] = [];
  for (const person of [...base, ...ext]) {
    if (!combined.some((existing) => isSamePersonName(existing, person))) {
      combined.push(person);
    }
  }
  return combined;
}

export function isPersonInShiftSlot(
  workerName: string,
  primary?: string,
  extras?: string[]
): boolean {
  if (!workerName) return false;
  const participants = extractShiftParticipants(primary, extras);
  return participants.some((p) => isSamePersonName(p, workerName));
}

const formatDecimalPersian = (num: number): string => {
  const rounded = Math.round(num * 10) / 10;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', '٫');
  return toPersianDigits(str);
};

export const FairnessAnalysisCard: React.FC<FairnessAnalysisCardProps> = ({
  scheduleData,
  shiftWorkers,
  personnelList = [],
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'alerts_only'>('all');
  const [metricMode, setMetricMode] = useState<'weighted' | 'raw' | 'shifts'>('weighted');
  const [displayStyle, setDisplayStyle] = useState<'bars' | 'chart'>('bars');
  const [showExplanation, setShowExplanation] = useState(false);

  // Perform comprehensive, 100% accurate fairness calculation
  const fairnessReport = useMemo(() => {
    if (!scheduleData || scheduleData.length === 0) {
      return null;
    }

    // Sort schedule chronologically to detect consecutive nights accurately
    const sortedSchedule = [...scheduleData].sort((a, b) => a.date.localeCompare(b.date));

    // Discover all active shift workers + any person who actually worked in this period
    const canonicalWorkers: string[] = [];
    const addWorkerIfUnique = (candidate: string) => {
      const clean = String(candidate || '').trim();
      if (!clean || clean === 'نامشخص' || clean === '---') return;
      if (!canonicalWorkers.some((w) => isSamePersonName(w, clean))) {
        canonicalWorkers.push(clean);
      }
    };

    shiftWorkers.forEach(addWorkerIfUnique);
    sortedSchedule.forEach((entry) => {
      extractShiftParticipants(entry.dayShiftPerson, entry.extraDayPersons).forEach(addWorkerIfUnique);
      extractShiftParticipants(entry.nightShiftPerson, entry.extraNightPersons).forEach(addWorkerIfUnique);
    });

    if (canonicalWorkers.length === 0) {
      return null;
    }

    // Calculate per-employee stats
    const employeeMetrics: EmployeeFairnessMetric[] = canonicalWorkers.map((worker) => {
      let dayCount = 0;
      let nightCount = 0;
      let holidayCount = 0;
      let currentConsecutiveNights = 0;
      let maxConsecutiveNights = 0;

      sortedSchedule.forEach((entry) => {
        const isDay = isPersonInShiftSlot(worker, entry.dayShiftPerson, entry.extraDayPersons);
        const isNight = isPersonInShiftSlot(worker, entry.nightShiftPerson, entry.extraNightPersons);
        const isHolidayOrFriday = Boolean(entry.isHoliday || entry.dayName === 'جمعه');

        if (isDay) {
          dayCount++;
          if (isHolidayOrFriday) holidayCount++;
        }

        if (isNight) {
          nightCount++;
          if (isHolidayOrFriday) holidayCount++;
          currentConsecutiveNights++;
          if (currentConsecutiveNights > maxConsecutiveNights) {
            maxConsecutiveNights = currentConsecutiveNights;
          }
        } else {
          currentConsecutiveNights = 0;
        }
      });

      const dayRawHours = dayCount * SHIFT_WEIGHTS.dayHours; // 11h per day shift
      const nightRawHours = nightCount * SHIFT_WEIGHTS.nightHours; // 13h per night shift
      const rawHours = dayRawHours + nightRawHours;

      const dayWeightedHours = dayRawHours; // 11h * 1.0
      const nightWeightedHours = nightRawHours * SHIFT_WEIGHTS.nightMultiplier; // 13h * 1.5 = 19.5h
      const weightedScore = dayWeightedHours + nightWeightedHours;
      const totalShifts = dayCount + nightCount;

      const hasFatigueRisk =
        maxConsecutiveNights >= 2 ||
        (nightCount >= 5 && nightCount / (totalShifts || 1) > 0.62);

      const shortName = worker.replace(/^(مهندس|آقای|اقای|خانم|دکتر)\s+/g, '').trim();

      return {
        name: worker,
        shortName,
        dayCount,
        nightCount,
        totalShifts,
        holidayCount,
        rawHours,
        dayRawHours,
        nightRawHours,
        weightedScore,
        dayWeightedHours,
        nightWeightedHours,
        consecutiveNightsMax: maxConsecutiveNights,
        deviationPercent: 0,
        diffFromMean: 0,
        sharePercent: 0,
        status: 'optimal',
        hasFatigueRisk,
        color: resolveCanonicalPersonColor(worker, personnelList),
      };
    });

    // Calculate team totals & benchmarks according to active metricMode
    const getMetricValue = (m: EmployeeFairnessMetric): number => {
      if (metricMode === 'raw') return m.rawHours;
      if (metricMode === 'shifts') return m.totalShifts;
      return m.weightedScore;
    };

    const n = employeeMetrics.length;
    const totalWeightedHours = employeeMetrics.reduce((acc, m) => acc + m.weightedScore, 0);
    const meanWeightedHours = n > 0 ? totalWeightedHours / n : 0;

    const totalRawHours = employeeMetrics.reduce((acc, m) => acc + m.rawHours, 0);
    const meanRawHours = n > 0 ? totalRawHours / n : 0;

    const totalShiftsCount = employeeMetrics.reduce((acc, m) => acc + m.totalShifts, 0);
    const meanShiftsCount = n > 0 ? totalShiftsCount / n : 0;

    const activeTotal = employeeMetrics.reduce((acc, m) => acc + getMetricValue(m), 0);
    const activeMean = n > 0 ? activeTotal / n : 0;

    // Standard deviation & Coefficient of Variation (CV) on active metric
    const variance =
      employeeMetrics.reduce((acc, m) => acc + Math.pow(getMetricValue(m) - activeMean, 2), 0) /
      (n || 1);
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = activeMean > 0 ? (stdDev / activeMean) * 100 : 0;

    // Gini Coefficient on active metric
    const sortedValues = employeeMetrics.map((m) => getMetricValue(m)).sort((a, b) => a - b);
    let gini = 0;
    if (n > 1 && activeTotal > 0) {
      let cumulativeSum = 0;
      for (let i = 0; i < n; i++) {
        cumulativeSum += (2 * (i + 1) - n - 1) * sortedValues[i];
      }
      gini = Math.max(0, cumulativeSum / (n * activeTotal));
    }

    // Accurate Fairness Score (100% when CV = 0, smooth realistic grading)
    const fairnessScore = Math.max(
      15,
      Math.min(100, Math.round(100 - coefficientOfVariation * 1.35))
    );

    // Update each employee's deviation, share percentage, and status relative to the active metric
    employeeMetrics.forEach((m) => {
      const val = getMetricValue(m);
      const diff = val - activeMean;
      const pct = activeMean > 0 ? (diff / activeMean) * 100 : 0;
      m.diffFromMean = Math.round(diff * 10) / 10;
      m.deviationPercent = Math.round(pct * 10) / 10;
      m.sharePercent = activeTotal > 0 ? Math.round((val / activeTotal) * 1000) / 10 : 0;

      if (pct >= 18) {
        m.status = 'overload';
      } else if (pct >= 9) {
        m.status = 'slight_high';
      } else if (pct <= -18) {
        m.status = 'underload';
      } else if (pct <= -9) {
        m.status = 'slight_low';
      } else {
        m.status = 'optimal';
      }
    });

    // Sort metrics descending by active value for clean visual ranking
    const sortedMetrics = [...employeeMetrics].sort(
      (a, b) => getMetricValue(b) - getMetricValue(a)
    );

    const overloadedCount = sortedMetrics.filter(
      (m) => m.status === 'overload' || m.status === 'slight_high'
    ).length;
    const underloadedCount = sortedMetrics.filter(
      (m) => m.status === 'underload' || m.status === 'slight_low'
    ).length;
    const fatigueCount = sortedMetrics.filter((m) => m.hasFatigueRisk).length;
    const totalImbalances = sortedMetrics.filter((m) => m.status !== 'optimal').length;

    // Smart actionable balancing suggestion
    const highestLoad = sortedMetrics[0];
    const lowestLoad = sortedMetrics[sortedMetrics.length - 1];
    let balancingSuggestion: string | null = null;

    if (highestLoad && lowestLoad && highestLoad.name !== lowestLoad.name) {
      const weightGap = highestLoad.weightedScore - lowestLoad.weightedScore;
      if (weightGap >= 30) {
        const shiftsToMove = Math.max(1, Math.round(weightGap / 39));
        balancingSuggestion = `پیشنهاد متعادل‌سازی: جابجایی ${toPersianDigits(
          shiftsToMove
        )} شیفت شب (یا روز) از «${highestLoad.shortName}» (${formatDecimalPersian(
          highestLoad.weightedScore
        )} ساعت وزنی) به «${lowestLoad.shortName}» (${formatDecimalPersian(
          lowestLoad.weightedScore
        )} ساعت وزنی) اختلاف بار کاری تیم را به حداقل می‌رساند.`;
      } else if (weightGap >= 19) {
        balancingSuggestion = `پیشنهاد متعادل‌سازی: انتقال ۱ شیفت از «${highestLoad.shortName}» به «${lowestLoad.shortName}» توزیع ساعات این بازه را کاملاً به میانگین (${formatDecimalPersian(
          meanWeightedHours
        )} ساعت وزنی) نزدیک می‌کند.`;
      }
    }

    const maxVal = Math.max(...sortedMetrics.map((m) => getMetricValue(m)), activeMean * 1.15, 1);

    return {
      metrics: sortedMetrics,
      meanWeightedHours,
      meanRawHours,
      meanShiftsCount,
      totalWeightedHours,
      totalRawHours,
      totalShiftsCount,
      activeMean,
      activeTotal,
      stdDev,
      gini,
      fairnessScore,
      overloadedCount,
      underloadedCount,
      fatigueCount,
      totalImbalances,
      balancingSuggestion,
      maxMetricValue: maxVal,
    };
  }, [scheduleData, shiftWorkers, personnelList, metricMode]);

  if (!fairnessReport) {
    return null;
  }

  const {
    metrics,
    meanWeightedHours,
    meanRawHours,
    meanShiftsCount,
    activeMean,
    stdDev,
    gini,
    fairnessScore,
    overloadedCount,
    underloadedCount,
    fatigueCount,
    totalImbalances,
    balancingSuggestion,
    maxMetricValue,
  } = fairnessReport;

  const displayMetrics =
    filterMode === 'alerts_only'
      ? metrics.filter((m) => m.status !== 'optimal' || m.hasFatigueRisk)
      : metrics;

  const getScoreBadge = (score: number) => {
    if (score >= 88) {
      return {
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        bar: 'bg-emerald-500',
        label: 'توزیع کاملاً عادلانه و متوازن',
        statusColor: 'text-emerald-700',
      };
    }
    if (score >= 74) {
      return {
        bg: 'bg-amber-50 text-amber-800 border-amber-200',
        bar: 'bg-amber-500',
        label: 'تعادل نسبی (با انحراف جزئی)',
        statusColor: 'text-amber-700',
      };
    }
    return {
      bg: 'bg-rose-50 text-rose-700 border-rose-200',
      bar: 'bg-rose-500',
      label: 'عدم تعادل بار کاری (نیازمند بازنگری)',
      statusColor: 'text-rose-700',
    };
  };

  const scoreBadge = getScoreBadge(fairnessScore);

  const unitLabel =
    metricMode === 'weighted' ? 'ساعت وزنی' : metricMode === 'raw' ? 'ساعت خام' : 'شیفت';

  // Prepare data for Recharts visual comparison chart
  const rechartsData = metrics.map((m) => ({
    name: m.shortName,
    fullName: m.name,
    dayPart:
      metricMode === 'weighted'
        ? m.dayWeightedHours
        : metricMode === 'raw'
          ? m.dayRawHours
          : m.dayCount,
    nightPart:
      metricMode === 'weighted'
        ? m.nightWeightedHours
        : metricMode === 'raw'
          ? m.nightRawHours
          : m.nightCount,
    total:
      metricMode === 'weighted'
        ? m.weightedScore
        : metricMode === 'raw'
          ? m.rawHours
          : m.totalShifts,
    dayCount: m.dayCount,
    nightCount: m.nightCount,
    holidayCount: m.holidayCount,
    deviationPercent: m.deviationPercent,
    color: m.color,
  }));

  return (
    <div className="bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden transition-all duration-200 no-print">
      {/* Header Bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 sm:px-5 sm:py-3.5 bg-linear-to-r from-indigo-50/80 via-slate-50/50 to-white border-b border-slate-200/80 flex items-center justify-between cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
            <Scale size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-black text-slate-800 tracking-tight">
                داشبورد جامع عدالت، سختی کار و توازن شیفت پرسنل
              </h3>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${scoreBadge.bg}`}
              >
                شاخص عدالت: {toPersianDigits(fairnessScore)}٪ ({scoreBadge.label})
              </span>
              {totalImbalances > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {toPersianDigits(totalImbalances)} نفر خارج از محدوده میانگین
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 font-medium">
              محاسبه دقیق شیفت روز ({toPersianDigits(11)} ساعت) + شیفت شب ({toPersianDigits(13)}{' '}
              ساعت خام / {toPersianDigits('19٫5')} ساعت وزنی با ضریب ۱٫۵×) و شیفت‌های کمکی
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
            aria-label="Toggle details"
          >
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 sm:p-5 space-y-4">
          {/* Top 4 KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {/* KPI 1: Fairness Index */}
            <div className="bg-slate-50/90 p-3 rounded-xl border border-slate-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">شاخص توازن تیم</span>
                <Scale size={15} className="text-indigo-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">
                  {toPersianDigits(fairnessScore)}٪
                </span>
                <span className={`text-[10px] font-bold ${scoreBadge.statusColor}`}>
                  (جینی: {toPersianDigits(gini.toFixed(2))})
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${scoreBadge.bar}`}
                  style={{ width: `${fairnessScore}%` }}
                />
              </div>
            </div>

            {/* KPI 2: Exact Team Benchmark Mean */}
            <div className="bg-slate-50/90 p-3 rounded-xl border border-slate-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">میانگین استاندارد هر نفر</span>
                <Clock size={15} className="text-emerald-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">
                  {formatDecimalPersian(activeMean)}
                </span>
                <span className="text-xs font-bold text-slate-500">{unitLabel}</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 truncate font-medium">
                خام: {formatDecimalPersian(meanRawHours)} ساعت | میانگین شیفت:{' '}
                {formatDecimalPersian(meanShiftsCount)}
              </p>
            </div>

            {/* KPI 3: Deviation & Overload/Underload */}
            <div className="bg-slate-50/90 p-3 rounded-xl border border-slate-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">انحراف از میانگین تیم</span>
                <AlertTriangle
                  size={15}
                  className={totalImbalances > 0 ? 'text-amber-600' : 'text-emerald-600'}
                />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5 flex-wrap">
                <span className="text-xl sm:text-2xl font-black text-slate-800 tabular-nums">
                  ±{formatDecimalPersian(stdDev)}
                </span>
                <span className="text-[11px] font-bold text-slate-500">{unitLabel}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold">
                <span className="text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                  {toPersianDigits(overloadedCount)} بالاتر از نرمال
                </span>
                <span className="text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200">
                  {toPersianDigits(underloadedCount)} کمتر از نرمال
                </span>
              </div>
            </div>

            {/* KPI 4: Fatigue & Night Concentration */}
            <div className="bg-slate-50/90 p-3 rounded-xl border border-slate-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">پایش خستگی شیفت شب</span>
                <Zap
                  size={15}
                  className={fatigueCount > 0 ? 'text-rose-600' : 'text-emerald-600'}
                />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`text-xl sm:text-2xl font-black tabular-nums ${
                    fatigueCount > 0 ? 'text-rose-600' : 'text-emerald-700'
                  }`}
                >
                  {toPersianDigits(fatigueCount)}
                </span>
                <span className="text-xs font-bold text-slate-500">نفر دارای هشدار</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 truncate font-medium">
                بررسی شب‌کاری متوالی در {toPersianDigits(scheduleData.length)} روز تقویم
              </p>
            </div>
          </div>

          {/* Actionable Balancing Banner */}
          {balancingSuggestion && (
            <div className="p-3 bg-indigo-50/90 border border-indigo-200/90 rounded-xl flex items-center justify-between gap-3 text-indigo-950">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-600 shrink-0" />
                <span className="text-xs sm:text-sm font-bold leading-relaxed">
                  {balancingSuggestion}
                </span>
              </div>
            </div>
          )}

          {/* Controls Toolbar: Metric Selector + Display Mode + Filter */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
            {/* Metric Mode Selector */}
            <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold text-slate-700">
              <button
                type="button"
                onClick={() => setMetricMode('weighted')}
                className={`px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                  metricMode === 'weighted'
                    ? 'bg-white text-indigo-700 shadow-2xs font-black ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ساعات وزنی (شب ۱٫۵×)
              </button>
              <button
                type="button"
                onClick={() => setMetricMode('raw')}
                className={`px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                  metricMode === 'raw'
                    ? 'bg-white text-indigo-700 shadow-2xs font-black ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ساعات خام واقعی
              </button>
              <button
                type="button"
                onClick={() => setMetricMode('shifts')}
                className={`px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                  metricMode === 'shifts'
                    ? 'bg-white text-indigo-700 shadow-2xs font-black ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                تعداد کل شیفت
              </button>
            </div>

            {/* Right Controls: Chart vs Bars + Filter */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Visual Display Toggle */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setDisplayStyle('bars')}
                  className={`px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer ${
                    displayStyle === 'bars'
                      ? 'bg-white text-slate-900 shadow-2xs font-black'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <ListFilter size={13} />
                  <span>نوار تفکیکی دقیق</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayStyle('chart')}
                  className={`px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer ${
                    displayStyle === 'chart'
                      ? 'bg-white text-indigo-700 shadow-2xs font-black'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <BarChart2 size={13} />
                  <span>نمودار ستونی مقایسه‌ای</span>
                </button>
              </div>

              {/* Filter All vs Alerts */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-2 py-1.5 rounded-lg transition cursor-pointer ${
                    filterMode === 'all'
                      ? 'bg-white text-slate-900 shadow-2xs font-black'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  همه ({toPersianDigits(metrics.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('alerts_only')}
                  className={`px-2 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer ${
                    filterMode === 'alerts_only'
                      ? 'bg-amber-500 text-white shadow-2xs font-black'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <AlertTriangle size={11} />
                  هشدارها (
                  {toPersianDigits(
                    metrics.filter((m) => m.status !== 'optimal' || m.hasFatigueRisk).length
                  )}
                  )
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowExplanation(!showExplanation)}
                className={`p-2 rounded-xl border transition cursor-pointer ${
                  showExplanation
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'text-slate-500 border-slate-200 hover:text-indigo-600 hover:bg-indigo-50'
                }`}
                title="فرمول و راهنمای محاسبه دقیق"
              >
                <Info size={15} />
              </button>
            </div>
          </div>

          {/* Formula & Regulatory Explanation Box */}
          {showExplanation && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed space-y-1.5">
              <div className="flex items-center gap-1.5 font-black text-slate-900">
                <ShieldAlert size={15} className="text-indigo-600" />
                <span>فرمول دقیق محاسبه ساعات و توزیع عدالت در این جدول:</span>
              </div>
              <p>
                • <strong>ساعت خام واقعی:</strong> هر شیفت روز = <strong>۱۱ ساعت</strong> (۰۸:۰۰ تا ۱۹:۰۰) و هر شیفت شب = <strong>۱۳ ساعت</strong> (۱۹:۰۰ تا ۰۸:۰۰ صبح فردا).
              </p>
              <p>
                • <strong>ساعت وزنی (با ضریب سختی شب):</strong> مطابق ضریب ۱٫۵× برای شیفت شب، هر شیفت شب معادل <strong>۱۹٫۵ ساعت وزنی</strong> (۱۳ × ۱٫۵) و هر شیفت روز معادل <strong>۱۱ ساعت وزنی</strong> محاسبه می‌شود.
              </p>
              <p>
                • <strong>پشتیبانی کامل از شیفت‌های دونفره/کمکی و تعطیلات:</strong> تمام نفرات اصلی و کمکی در شیفت‌های روز و شب و همچنین شیفت‌های روز جمعه و تعطیلات رسمی به صورت ۱۰۰٪ دقیق شمارش شده‌اند.
              </p>
            </div>
          )}

          {/* MODE A: Interactive Stacked Recharts BarChart */}
          {displayStyle === 'chart' && (
            <div className="bg-slate-50/60 border border-slate-200/90 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-black text-slate-700">
                  نمودار مقایسه‌ای سهم شیفت روز و شب هر کارشناس نسبت به خط میانگین تیم (
                  {formatDecimalPersian(activeMean)} {unitLabel})
                </span>
                <div className="flex items-center gap-3 text-[11px] font-bold">
                  <span className="flex items-center gap-1 text-amber-700">
                    <span className="w-3 h-3 rounded-xs bg-amber-500 inline-block" /> سهم شیفت روز
                  </span>
                  <span className="flex items-center gap-1 text-indigo-700">
                    <span className="w-3 h-3 rounded-xs bg-indigo-600 inline-block" /> سهم شیفت شب
                  </span>
                </div>
              </div>

              <div className="h-72 sm:h-80 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rechartsData}
                    margin={{ top: 16, right: 20, left: 10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#1e293b', fontSize: 12, fontWeight: 800 }}
                      axisLine={{ stroke: '#cbd5e1' }}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }}
                      axisLine={{ stroke: '#cbd5e1' }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div
                            className="bg-white/95 backdrop-blur-xs border border-slate-200 shadow-lg rounded-xl p-3 text-right space-y-1.5 min-w-[190px]"
                            dir="rtl"
                          >
                            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                              <span className="font-black text-xs text-slate-900">
                                {d.fullName}
                              </span>
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: d.color }}
                              />
                            </div>
                            <div className="text-[11px] text-amber-700 font-bold flex justify-between">
                              <span>شیفت روز ({toPersianDigits(d.dayCount)} نوبت):</span>
                              <span>
                                {formatDecimalPersian(d.dayPart)} {unitLabel}
                              </span>
                            </div>
                            <div className="text-[11px] text-indigo-700 font-bold flex justify-between">
                              <span>شیفت شب ({toPersianDigits(d.nightCount)} نوبت):</span>
                              <span>
                                {formatDecimalPersian(d.nightPart)} {unitLabel}
                              </span>
                            </div>
                            <div className="text-xs text-slate-900 font-black flex justify-between pt-1 border-t border-slate-100">
                              <span>مجموع کل:</span>
                              <span>
                                {formatDecimalPersian(d.total)} {unitLabel}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-bold flex justify-between">
                              <span>اختلاف با میانگین تیم:</span>
                              <span
                                className={
                                  d.deviationPercent > 0
                                    ? 'text-rose-600'
                                    : d.deviationPercent < 0
                                      ? 'text-purple-600'
                                      : 'text-emerald-600'
                                }
                              >
                                {d.deviationPercent > 0 ? '+' : ''}
                                {formatDecimalPersian(d.deviationPercent)}٪
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      y={activeMean}
                      stroke="#0f172a"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      label={{
                        value: `میانگین: ${formatDecimalPersian(activeMean)}`,
                        position: 'top',
                        fill: '#0f172a',
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    />
                    <Bar
                      dataKey="dayPart"
                      name="شیفت روز"
                      stackId="workload"
                      fill="#f59e0b"
                      radius={[0, 0, 4, 4]}
                      maxBarSize={48}
                    />
                    <Bar
                      dataKey="nightPart"
                      name="شیفت شب"
                      stackId="workload"
                      fill="#4f46e5"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* MODE B: Precision Dual-Segment Progress Bars & Detailed Table */}
          {displayStyle === 'bars' && (
            <div className="space-y-2.5 pt-1">
              {displayMetrics.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  هیچ کارشناسی با هشدار عدم تعادل یا خستگی در این بازه یافت نشد.
                </div>
              ) : (
                displayMetrics.map((item) => {
                  const activeValue =
                    metricMode === 'weighted'
                      ? item.weightedScore
                      : metricMode === 'raw'
                        ? item.rawHours
                        : item.totalShifts;
                  const daySegmentValue =
                    metricMode === 'weighted'
                      ? item.dayWeightedHours
                      : metricMode === 'raw'
                        ? item.dayRawHours
                        : item.dayCount;
                  const nightSegmentValue =
                    metricMode === 'weighted'
                      ? item.nightWeightedHours
                      : metricMode === 'raw'
                        ? item.nightRawHours
                        : item.nightCount;

                  const totalBarPct = Math.min(
                    100,
                    Math.max(2, (activeValue / maxMetricValue) * 100)
                  );
                  const daySegmentPct =
                    activeValue > 0 ? (daySegmentValue / activeValue) * totalBarPct : 0;
                  const nightSegmentPct =
                    activeValue > 0 ? (nightSegmentValue / activeValue) * totalBarPct : 0;

                  // IMPORTANT RTL FIX: Since dir="rtl", bars fill from RIGHT to LEFT.
                  // Therefore the benchmark line must be placed at `right: ${averagePercentage}%`!
                  const averagePercentage = Math.min(
                    100,
                    Math.max(0, (activeMean / maxMetricValue) * 100)
                  );

                  return (
                    <div
                      key={item.name}
                      className="p-3 sm:p-3.5 rounded-xl border border-slate-200/90 hover:border-slate-300 bg-white hover:bg-slate-50/40 transition-all space-y-2.5"
                    >
                      {/* Top Row: Name, Detailed Shift Counts, Status & Exact Numbers */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs ring-2 ring-white"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-black text-xs sm:text-sm text-slate-900 min-w-[110px]">
                            {item.name}
                          </span>

                          {/* Shift Breakdown Badges */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] bg-slate-100/90 px-2.5 py-1 rounded-lg border border-slate-200/70">
                            <span
                              className="flex items-center gap-1 text-amber-800 font-bold"
                              title={`شیفت روز: ${item.dayCount} نوبت (${item.dayRawHours} ساعت)`}
                            >
                              <Sun size={12} className="text-amber-500 fill-amber-500" />
                              {toPersianDigits(item.dayCount)} روز ({toPersianDigits(item.dayRawHours)}h)
                            </span>
                            <span className="text-slate-300">|</span>
                            <span
                              className="flex items-center gap-1 text-indigo-800 font-bold"
                              title={`شیفت شب: ${item.nightCount} نوبت (${item.nightRawHours} ساعت خام / ${item.nightWeightedHours} ساعت وزنی)`}
                            >
                              <Moon size={12} className="text-indigo-600 fill-indigo-600" />
                              {toPersianDigits(item.nightCount)} شب (
                              {metricMode === 'weighted'
                                ? `${formatDecimalPersian(item.nightWeightedHours)}h وزنی`
                                : `${toPersianDigits(item.nightRawHours)}h`}
                              )
                            </span>
                            <span className="text-slate-300">|</span>
                            <span className="text-slate-700 font-extrabold">
                              جمع: {toPersianDigits(item.totalShifts)} شیفت
                            </span>
                            {item.holidayCount > 0 && (
                              <>
                                <span className="text-slate-300">|</span>
                                <span className="text-rose-600 font-bold">
                                  {toPersianDigits(item.holidayCount)} تعطیل/جمعه
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Right Side: Deviation Badges & Exact Metric Value */}
                        <div className="flex items-center gap-2 mr-auto sm:mr-0">
                          {item.hasFatigueRisk && (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1"
                              title={`حداکثر شب متوالی: ${item.consecutiveNightsMax} شب`}
                            >
                              <Zap size={11} className="text-rose-600 fill-rose-600" />
                              ریسک خستگی ({toPersianDigits(item.consecutiveNightsMax)} شب متوالی)
                            </span>
                          )}

                          {item.status === 'overload' && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                              <TrendingUp size={11} />
                              بار سنگین (+{formatDecimalPersian(item.deviationPercent)}٪)
                            </span>
                          )}

                          {item.status === 'slight_high' && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                              +{formatDecimalPersian(item.deviationPercent)}٪ از میانگین
                            </span>
                          )}

                          {item.status === 'underload' && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                              <TrendingDown size={11} />
                              کمتر از میانگین ({formatDecimalPersian(item.deviationPercent)}٪)
                            </span>
                          )}

                          {item.status === 'slight_low' && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                              {formatDecimalPersian(item.deviationPercent)}٪ از میانگین
                            </span>
                          )}

                          {item.status === 'optimal' && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 size={11} />
                              متعادل (
                              {item.deviationPercent > 0
                                ? `+${formatDecimalPersian(item.deviationPercent)}٪`
                                : `${formatDecimalPersian(item.deviationPercent)}٪`}
                              )
                            </span>
                          )}

                          <div className="text-left min-w-[105px] bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/80">
                            <span className="text-sm font-black text-slate-900 tabular-nums">
                              {formatDecimalPersian(activeValue)}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500 mr-1">
                              {unitLabel}
                            </span>
                            <span className="block text-[9px] font-bold text-slate-400">
                              سهم از کل: {formatDecimalPersian(item.sharePercent)}٪
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Dual-Segment Bar (Day + Night) with Accurate RTL Mean Benchmark Line */}
                      <div className="relative pt-1.5 pb-0.5">
                        <div className="w-full bg-slate-100 rounded-full h-3 flex overflow-hidden border border-slate-200/60">
                          {/* Day Shift Segment (Amber) */}
                          {daySegmentPct > 0 && (
                            <div
                              className="h-full bg-amber-400 transition-all duration-300"
                              style={{ width: `${daySegmentPct}%` }}
                              title={`سهم شیفت روز: ${formatDecimalPersian(daySegmentValue)} ${unitLabel}`}
                            />
                          )}
                          {/* Night Shift Segment (Indigo/Rose depending on status) */}
                          {nightSegmentPct > 0 && (
                            <div
                              className={`h-full transition-all duration-300 ${
                                item.status === 'overload'
                                  ? 'bg-rose-500'
                                  : item.status === 'underload'
                                    ? 'bg-purple-500'
                                    : 'bg-indigo-600'
                              }`}
                              style={{ width: `${nightSegmentPct}%` }}
                              title={`سهم شیفت شب: ${formatDecimalPersian(nightSegmentValue)} ${unitLabel}`}
                            />
                          )}
                        </div>

                        {/* Accurate RTL Mean Indicator Line (uses `right:` to match RTL bar origin) */}
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-slate-900 z-10 pointer-events-none"
                          style={{ right: `${averagePercentage}%` }}
                        >
                          <span className="absolute -top-1.5 -translate-x-1/2 w-2 h-2 rounded-full bg-slate-900 border border-white" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Footer Legend & Summary */}
          <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-2.5 border-t border-slate-100 gap-2 font-medium">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-400" /> شیفت روز (۱۱ ساعت)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600" /> شیفت شب (
                {metricMode === 'weighted' ? '۱۹٫۵ ساعت وزنی' : '۱۳ ساعت خام'})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500" /> بار کاری سنگین (+۱۸٪)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-0.5 h-3.5 bg-slate-900" /> خط تراز میانگین تیم (
                {formatDecimalPersian(activeMean)} {unitLabel})
              </span>
            </div>
            <span>
              تحلیل بر مبنای {toPersianDigits(scheduleData.length)} روز تقویم و{' '}
              {toPersianDigits(metrics.length)} کارشناس
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

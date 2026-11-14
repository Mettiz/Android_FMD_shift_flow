
/**
 * ShiftFlow Dashboard Component - v1.0.1
 */
import React, { useMemo, useState } from 'react';
import { SHIFT_WEIGHTS, StatEntry, ShiftEntry, DashboardProps, DailyProcessTask, DailyProcessMap, ProcessDefinition } from '../types';
import { Calendar, Moon, Filter, ChevronRight, ChevronLeft, Lock, Unlock, Sun, RefreshCw, Printer, FileText, CalendarRange, XCircle, X, Search, ChevronDown, ChevronUp, Scale, Activity, Trophy, Clock, Users, CheckCircle2, CalendarCheck, Crown, ShieldCheck, Globe, Layers, Check, Edit, UserPlus, Trash2, FlaskConical, Sparkles } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Sector } from 'recharts';
import { ShiftUserCard } from './ShiftUserCard';
import { TodayHero } from './TodayHero';
import { StatsCard } from './StatsCard';
import { DailyProcessModal } from './DailyProcessModal';
import { FairnessAnalysisCard, isPersonInShiftSlot } from './FairnessAnalysisCard';
import { DEFAULT_PROCESS_DEFINITIONS, generateFullBioprocessCampaign } from '../utils/bioprocessData';
import { getTodayPersianDateStr } from '../utils/persianDate';
import { getPersonColor } from '../utils/personnelColors';

// --- Constants for Date Selectors ---
const PERSIAN_MONTHS = [
  { value: '01', label: 'فروردین' },
  { value: '02', label: 'اردیبهشت' },
  { value: '03', label: 'خرداد' },
  { value: '04', label: 'تیر' },
  { value: '05', label: 'مرداد' },
  { value: '06', label: 'شهریور' },
  { value: '07', label: 'مهر' },
  { value: '08', label: 'آبان' },
  { value: '09', label: 'آذر' },
  { value: '10', label: 'دی' },
  { value: '11', label: 'بهمن' },
  { value: '12', label: 'اسفند' },
];

const PERSIAN_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

// Dynamic Color Mapping per Person
const GET_PERSON_COLOR = (name: string, list?: any[]): string => {
  return getPersonColor(name, list);
};

// Helper to convert digits to Persian
const toPersianDigits = (s: string | number) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

// Reusable Date Select Component for Dashboard (Coordinated Style)
const DashboardDateSelect = ({ value, onChange, options, width = "w-[60px]" }: { value: string, onChange: (val: string) => void, options: any[], width?: string }) => (
  <div className={`relative h-9 ${width}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-full appearance-none bg-white border border-slate-300 hover:border-emerald-500 rounded-lg px-1 text-sm font-bold text-slate-700 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all cursor-pointer text-center dir-ltr"
        style={{ textAlign: 'center', textAlignLast: 'center' }}
      >
        {options.map((o) => {
          const val = typeof o === 'object' ? o.value : o;
          const label = typeof o === 'object' ? o.label : o;
          return (
            <option key={val} value={val}>
              {toPersianDigits(label)}
            </option>
          );
        })}
      </select>
  </div>
);

// Custom Sector Shape for Pie Chart supporting both slice hover and legend hover
const renderSectorShape = (props: any, activeIndex: number | null) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, index } = props;
  const isCurrentActive = index === activeIndex;

  if (isCurrentActive) {
    return (
      <g style={{ outline: 'none' }}>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius - 3}
          outerRadius={outerRadius + 7}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
          stroke="#ffffff"
          strokeWidth={3}
          cornerRadius={6}
        />
        <Sector
          cx={cx}
          cy={cy}
          startAngle={startAngle}
          endAngle={endAngle}
          innerRadius={outerRadius + 9}
          outerRadius={outerRadius + 14}
          fill={fill}
          fillOpacity={0.35}
          cornerRadius={8}
        />
      </g>
    );
  }

  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="#ffffff"
      strokeWidth={2.5}
      fillOpacity={activeIndex !== null && activeIndex !== undefined ? 0.9 : 1}
      cornerRadius={5}
    />
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ 
  scheduleData, 
  fullSchedule,
  shiftWorkers, 
  supervisors,
  personnelList,
  monthName, 
  year,
  onPrevMonth, 
  onNextMonth,
  onUpdateShift,
  onToggleHoliday,
  onOpenReport,
  isLocked,
  onToggleLock,
  onRegenerate,
  onNavigateToToday,
  isOwner,
  onOpenOwnerLogin,
  onLogoutOwner,
  publishedRange,
  onSavePublishedRange,
  onAddExtraPerson,
  onRemoveExtraPerson,
  onReplaceExtraPerson,
  dailyProcesses = {},
  onSaveDailyProcesses,
  processDefinitions = DEFAULT_PROCESS_DEFINITIONS,
  showProcessSchedule = true,
}) => {
  const todayPersianDate = useMemo(() => getTodayPersianDateStr(), []);
  const [filterPerson, setFilterPerson] = useState<string | 'All'>('All');
  const [filterShiftType, setFilterShiftType] = useState<'ALL' | 'DAY' | 'NIGHT'>('ALL');
  const [isShiftFilterOpen, setIsShiftFilterOpen] = useState(false);

  // Daily Process & Bioreactor Modal State
  const [selectedProcessDate, setSelectedProcessDate] = useState<{ date: string; dayName: string } | null>(null);
  const [isProcessModalOpen, setIsProcessModalOpen] = useState(false);

  // Dedicated Daily Process Table State (Bottom of Dashboard)
  const [processSearchQuery, setProcessSearchQuery] = useState('');
  
  // Quick Edit Shift Personnel (Manager / Admin) - Supports primary & extra personnel
  const [quickEditShift, setQuickEditShift] = useState<{
    id: number;
    date: string;
    dayName: string;
    field: 'dayShiftPerson' | 'nightShiftPerson' | 'onCallPerson' | 'extraDayPerson' | 'extraNightPerson';
    currentPerson: string;
    extraIndex?: number;
    actionType?: 'change' | 'add';
  } | null>(null);
  const [quickEditNotice, setQuickEditNotice] = useState<string | null>(null);

  const handleQuickSelectPerson = (selectedPerson: string) => {
    if (!quickEditShift) return;
    if (quickEditShift.field === 'dayShiftPerson' || quickEditShift.field === 'nightShiftPerson' || quickEditShift.field === 'onCallPerson') {
      onUpdateShift(quickEditShift.id, quickEditShift.field, selectedPerson);
      if (quickEditShift.field === 'nightShiftPerson' && selectedPerson) {
        setQuickEditNotice(`پرسنل شیفت شب به «${selectedPerson}» تغییر یافت و به صورت خودکار برای شیفت روز ۲ روز بعد نیز تنظیم گردید (قابل ویرایش دستی).`);
      } else {
        setQuickEditNotice(`پرسنل شیفت با موفقیت به «${selectedPerson}» تغییر یافت و ذخیره شد.`);
      }
    } else if (quickEditShift.field === 'extraDayPerson') {
      if (quickEditShift.actionType === 'add') {
        onAddExtraPerson?.(quickEditShift.id, 'Day', selectedPerson);
        setQuickEditNotice(`همکار کمکی «${selectedPerson}» با موفقیت افزوده شد.`);
      } else {
        if (onReplaceExtraPerson) {
          onReplaceExtraPerson(quickEditShift.id, 'Day', quickEditShift.currentPerson, selectedPerson);
        } else {
          onRemoveExtraPerson?.(quickEditShift.id, 'Day', quickEditShift.currentPerson);
          onAddExtraPerson?.(quickEditShift.id, 'Day', selectedPerson);
        }
        setQuickEditNotice(`پرسنل کمکی با موفقیت به «${selectedPerson}» تغییر یافت.`);
      }
    } else if (quickEditShift.field === 'extraNightPerson') {
      if (quickEditShift.actionType === 'add') {
        onAddExtraPerson?.(quickEditShift.id, 'Night', selectedPerson);
        setQuickEditNotice(`همکار کمکی «${selectedPerson}» به شیفت شب افزوده شد و برای شیفت روز ۲ روز بعد نیز ثبت گردید.`);
      } else {
        if (onReplaceExtraPerson) {
          onReplaceExtraPerson(quickEditShift.id, 'Night', quickEditShift.currentPerson, selectedPerson);
        } else {
          onRemoveExtraPerson?.(quickEditShift.id, 'Night', quickEditShift.currentPerson);
          onAddExtraPerson?.(quickEditShift.id, 'Night', selectedPerson);
        }
        setQuickEditNotice(`پرسنل کمکی با موفقیت به «${selectedPerson}» تغییر یافت.`);
      }
    }

    setTimeout(() => {
      setQuickEditNotice(null);
      setQuickEditShift(null);
    }, 900);
  };

  const handleQuickRemoveExtra = () => {
    if (!quickEditShift || !quickEditShift.currentPerson) return;
    const shiftType = quickEditShift.field === 'extraDayPerson' ? 'Day' : 'Night';
    onRemoveExtraPerson?.(quickEditShift.id, shiftType, quickEditShift.currentPerson);
    setQuickEditNotice(`پرسنل کمکی «${quickEditShift.currentPerson}» با موفقیت حذف گردید.`);
    setTimeout(() => {
      setQuickEditNotice(null);
      setQuickEditShift(null);
    }, 900);
  };

  const getQuickEditCandidates = () => {
    if (!quickEditShift) return [];
    if (quickEditShift.field === 'onCallPerson') return supervisors;
    
    // Allow both shift workers and supervisors to be assigned to day/night shifts
    const allAvailableStaff = Array.from(new Set([...shiftWorkers, ...supervisors]));

    if (quickEditShift.field === 'dayShiftPerson' || quickEditShift.field === 'nightShiftPerson') {
      return allAvailableStaff;
    }
    const targetEntry = fullSchedule.find(s => s.id === quickEditShift.id) || scheduleData.find(s => s.id === quickEditShift.id);
    if (quickEditShift.field === 'extraDayPerson') {
      const mainPerson = targetEntry?.dayShiftPerson;
      const otherExtras = (targetEntry?.extraDayPersons || []).filter(p => p !== quickEditShift.currentPerson);
      return allAvailableStaff.filter(name => name !== mainPerson && !otherExtras.includes(name));
    }
    if (quickEditShift.field === 'extraNightPerson') {
      const mainPerson = targetEntry?.nightShiftPerson;
      const otherExtras = (targetEntry?.extraNightPersons || []).filter(p => p !== quickEditShift.currentPerson);
      return allAvailableStaff.filter(name => name !== mainPerson && !otherExtras.includes(name));
    }
    return allAvailableStaff;
  };
  
  // --- Date Range Filter State ---
  const [viewMode, setViewMode] = useState<'MONTH' | 'RANGE'>(() => {
    return publishedRange && publishedRange.isActive ? 'RANGE' : 'MONTH';
  });
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  
  // Chart Interaction State
  const [activeIndex, setActiveIndex] = useState(0);
  
  // Initialize from current props logic
  const [fromDate, setFromDate] = useState(() => {
    if (publishedRange && publishedRange.isActive) {
      return publishedRange.from;
    }
    return { year: String(year), month: '09', day: '01' };
  });
  const [toDate, setToDate] = useState(() => {
    if (publishedRange && publishedRange.isActive) {
      return publishedRange.to;
    }
    return { year: String(year), month: '09', day: '30' };
  });
  
  // The applied filter state (what actually drives the table)
  const [appliedFilter, setAppliedFilter] = useState<{
      from: { year: string, month: string, day: string },
      to: { year: string, month: string, day: string }
  } | null>(() => {
    if (publishedRange && publishedRange.isActive) {
      return { from: publishedRange.from, to: publishedRange.to };
    }
    return null;
  });

  // Keep state synchronized with publishedRange
  const prevPublishedRangeRef = React.useRef(publishedRange);
  React.useEffect(() => {
    const wasActive = Boolean(prevPublishedRangeRef.current?.isActive);
    if (publishedRange && publishedRange.isActive) {
      setAppliedFilter({ from: publishedRange.from, to: publishedRange.to });
      setFromDate(publishedRange.from);
      setToDate(publishedRange.to);
      setViewMode('RANGE');
    } else if (!isOwner || wasActive) {
      setAppliedFilter(null);
      setViewMode('MONTH');
    }
  }, [publishedRange, isOwner]);

  // When the user or AI manually navigates to a different month/year, switch to MONTH view so the selected month is shown
  const prevMonthKeyRef = React.useRef(`${monthName}-${year}`);
  React.useEffect(() => {
    const key = `${monthName}-${year}`;
    const rangeJustChanged = prevPublishedRangeRef.current !== publishedRange;
    prevPublishedRangeRef.current = publishedRange;

    if (prevMonthKeyRef.current !== key) {
      prevMonthKeyRef.current = key;
      // Do not clobber RANGE view if publishedRange was just activated/updated in the same transition
      if (isOwner && !(rangeJustChanged && publishedRange?.isActive)) {
        setViewMode('MONTH');
        setAppliedFilter(null);
      }
    }
  }, [monthName, year, isOwner, publishedRange]);

  // Sync date picker defaults whenever month/scheduleData changes (if no range active)
  React.useEffect(() => {
     if (scheduleData.length > 0 && !publishedRange?.isActive && !appliedFilter) {
         const first = scheduleData[0].date.split('/');
         const last = scheduleData[scheduleData.length - 1].date.split('/');
         
         const defFrom = { year: first[0], month: first[1], day: first[2] };
         const defTo = { year: last[0], month: last[1], day: last[2] };
         
         setFromDate(defFrom);
         setToDate(defTo);
     }
  }, [scheduleData, year, publishedRange, appliedFilter]); 

  const handleApplyFilter = () => {
      // Validate ordering: if from > to, swap or correct
      const startStr = `${fromDate.year}/${fromDate.month}/${fromDate.day}`;
      const endStr = `${toDate.year}/${toDate.month}/${toDate.day}`;
      if (startStr > endStr) {
          setAppliedFilter({ from: toDate, to: fromDate });
          setFromDate(toDate);
          setToDate(fromDate);
      } else {
          setAppliedFilter({ from: fromDate, to: toDate });
      }
      setViewMode('RANGE');
      setIsFiltersOpen(false);
  };

  const handlePublishRangeForEveryone = () => {
      const startStr = `${fromDate.year}/${fromDate.month}/${fromDate.day}`;
      const endStr = `${toDate.year}/${toDate.month}/${toDate.day}`;
      let finalFrom = fromDate;
      let finalTo = toDate;
      if (startStr > endStr) {
          finalFrom = toDate;
          finalTo = fromDate;
          setFromDate(toDate);
          setToDate(fromDate);
      }
      const range = { isActive: true, from: finalFrom, to: finalTo };
      setAppliedFilter(range);
      setViewMode('RANGE');
      onSavePublishedRange(range);
      setIsFiltersOpen(false);
  };

  const handleClearPublishedRange = () => {
      onSavePublishedRange(null);
      setAppliedFilter(null);
      setViewMode('MONTH');
      if (scheduleData.length > 0) {
          const first = scheduleData[0].date.split('/');
          const last = scheduleData[scheduleData.length - 1].date.split('/');
          setFromDate({ year: first[0], month: first[1], day: first[2] });
          setToDate({ year: last[0], month: last[1], day: last[2] });
      }
  };

  const handleClearFilter = () => {
      // If there is an active published range and owner clears local filter, revert to published or full month
      if (publishedRange?.isActive) {
        setAppliedFilter({ from: publishedRange.from, to: publishedRange.to });
        setFromDate(publishedRange.from);
        setToDate(publishedRange.to);
        setViewMode('RANGE');
      } else {
        setAppliedFilter(null);
        setViewMode('MONTH');
        if (scheduleData.length > 0) {
            const first = scheduleData[0].date.split('/');
            const last = scheduleData[scheduleData.length - 1].date.split('/');
            setFromDate({ year: first[0], month: first[1], day: first[2] });
            setToDate({ year: last[0], month: last[1], day: last[2] });
        }
      }
  };

  // Quick Range Presets
  const applyQuickRange = (type: 'firstHalf' | 'secondHalf' | 'next7Days' | 'fullMonth') => {
      if (scheduleData.length === 0) return;
      const first = scheduleData[0].date.split('/');
      const last = scheduleData[scheduleData.length - 1].date.split('/');
      const currentYear = first[0];
      const currentMonth = first[1];

      if (type === 'firstHalf') {
          const from = { year: currentYear, month: currentMonth, day: '01' };
          const to = { year: currentYear, month: currentMonth, day: '15' };
          setFromDate(from);
          setToDate(to);
          setAppliedFilter({ from, to });
          setViewMode('RANGE');
      } else if (type === 'secondHalf') {
          const from = { year: currentYear, month: currentMonth, day: '16' };
          const to = { year: last[0], month: last[1], day: last[2] };
          setFromDate(from);
          setToDate(to);
          setAppliedFilter({ from, to });
          setViewMode('RANGE');
      } else if (type === 'next7Days') {
          const todayParts = todayPersianDate.split('/');
          const from = { year: todayParts[0], month: todayParts[1], day: todayParts[2] };
          // Find 7 days from today in fullSchedule
          const todayIdx = fullSchedule.findIndex(s => s.date === todayPersianDate);
          let targetEntry = todayIdx >= 0 && todayIdx + 6 < fullSchedule.length 
              ? fullSchedule[todayIdx + 6] 
              : fullSchedule[Math.min(todayIdx >= 0 ? todayIdx + 6 : fullSchedule.length - 1, fullSchedule.length - 1)];
          
          const toParts = (targetEntry ? targetEntry.date : todayPersianDate).split('/');
          const to = { year: toParts[0], month: toParts[1], day: toParts[2] };
          setFromDate(from);
          setToDate(to);
          setAppliedFilter({ from, to });
          setViewMode('RANGE');
      } else if (type === 'fullMonth') {
          handleClearFilter();
      }
  };

  const baseScheduleForView = useMemo(() => {
    if (viewMode === 'MONTH' || !appliedFilter) {
      return scheduleData;
    }
    const startStr = `${appliedFilter.from.year}/${appliedFilter.from.month}/${appliedFilter.from.day}`;
    const endStr = `${appliedFilter.to.year}/${appliedFilter.to.month}/${appliedFilter.to.day}`;
    return fullSchedule.filter(s => s.date >= startStr && s.date <= endStr);
  }, [scheduleData, fullSchedule, viewMode, appliedFilter]);

  const [chartMetricMode, setChartMetricMode] = useState<'raw' | 'weighted' | 'shifts'>('raw');

  const filteredSchedule = useMemo(() => {
    return baseScheduleForView.filter((s) => {
      if (filterPerson === 'All') {
        return true;
      }
      const dayMatches = isPersonInShiftSlot(filterPerson, s.dayShiftPerson, s.extraDayPersons);
      const nightMatches = isPersonInShiftSlot(filterPerson, s.nightShiftPerson, s.extraNightPersons);

      if (filterShiftType === 'ALL') {
        return dayMatches || nightMatches;
      } else if (filterShiftType === 'DAY') {
        return dayMatches;
      } else if (filterShiftType === 'NIGHT') {
        return nightMatches;
      }
      return true;
    });
  }, [baseScheduleForView, filterPerson, filterShiftType]);

  // Dedicated stats for individual selected person
  const selectedPersonStats = useMemo(() => {
    if (filterPerson === 'All') return null;

    let dayCount = 0;
    let nightCount = 0;
    baseScheduleForView.forEach((s) => {
      if (isPersonInShiftSlot(filterPerson, s.dayShiftPerson, s.extraDayPersons)) {
        dayCount++;
      }
      if (isPersonInShiftSlot(filterPerson, s.nightShiftPerson, s.extraNightPersons)) {
        nightCount++;
      }
    });

    return {
      name: filterPerson,
      dayCount,
      nightCount,
      totalCount: dayCount + nightCount,
      totalHours: (dayCount * 11) + (nightCount * 13)
    };
  }, [filterPerson, baseScheduleForView]);

  const stats = useMemo(() => {
    const dataToAnalyze = baseScheduleForView;

    // Discover all shift workers + anyone assigned in this schedule period
    const allWorkers: string[] = [...shiftWorkers];
    dataToAnalyze.forEach((entry) => {
      const checkAndAdd = (name?: string) => {
        const clean = String(name || '').trim();
        if (!clean || clean === 'نامشخص' || clean === '---') return;
        if (!allWorkers.some((w) => isPersonInShiftSlot(w, clean))) {
          allWorkers.push(clean);
        }
      };
      checkAndAdd(entry.dayShiftPerson);
      checkAndAdd(entry.nightShiftPerson);
      (entry.extraDayPersons || []).forEach(checkAndAdd);
      (entry.extraNightPersons || []).forEach(checkAndAdd);
    });

    const result: StatEntry[] = allWorkers.map(worker => {
      let dayShifts = 0;
      let nightShifts = 0;
      let workedHours = 0;

      dataToAnalyze.forEach(entry => {
        if (isPersonInShiftSlot(worker, entry.dayShiftPerson, entry.extraDayPersons)) {
          dayShifts++;
          workedHours += 11; 
        }
        if (isPersonInShiftSlot(worker, entry.nightShiftPerson, entry.extraNightPersons)) {
          nightShifts++;
          workedHours += 13; 
        }
      });

      const weightedScore = (dayShifts * 11) + (nightShifts * 13 * 1.5);
      const totalHours = (dayShifts * 11) + (nightShifts * 13);

      return {
        name: worker,
        dayShifts,
        nightShifts,
        totalHours,
        weightedScore,
        offHours: 0, 
        workedHours
      };
    });
    
    return result;
  }, [baseScheduleForView, shiftWorkers]);

  // Derived Stats for Cards (exact person-shifts including extra shifts)
  const totalShifts = useMemo(() => {
    if (filterPerson !== 'All' && selectedPersonStats) {
      return selectedPersonStats.totalCount;
    }
    return stats.reduce((acc, curr) => acc + curr.dayShifts + curr.nightShifts, 0);
  }, [filterPerson, selectedPersonStats, stats]);
  const totalHoursSum = stats.reduce((acc, curr) => acc + curr.totalHours, 0);
  
  // Top Performer Logic
  const topPerformer = useMemo(() => {
      if (stats.length === 0) return null;
      const maxHours = Math.max(...stats.map(s => s.totalHours));
      const bests = stats.filter(s => s.totalHours === maxHours);
      
      return {
          isTie: bests.length > 1,
          count: bests.length,
          names: bests.map(b => b.name),
          value: maxHours
      };
  }, [stats]);

  // Chart Data - Sorted by Active Metric (Raw Hours, Weighted Score, or Shift Count)
  const chartData = useMemo(() => {
    return stats
      .filter(s => s.totalHours > 0)
      .map(s => ({
        ...s,
        totalShiftsCount: s.dayShifts + s.nightShifts,
        activeChartValue:
          chartMetricMode === 'weighted'
            ? s.weightedScore
            : chartMetricMode === 'shifts'
              ? s.dayShifts + s.nightShifts
              : s.totalHours
      }))
      .sort((a, b) => b.activeChartValue - a.activeChartValue);
  }, [stats, chartMetricMode]);

  // Sync pie chart focus when a person is filtered
  React.useEffect(() => {
    if (filterPerson !== 'All') {
      const idx = chartData.findIndex(c => c.name === filterPerson);
      if (idx >= 0) {
        setActiveIndex(idx);
      }
    }
  }, [filterPerson, chartData]);

  // Active person for center chart display
  const activePerson = useMemo(() => {
    if (chartData.length === 0) return null;
    if (activeIndex !== null && chartData[activeIndex]) {
      return chartData[activeIndex];
    }
    return chartData[0];
  }, [chartData, activeIndex]);

  const renderCustomSector = (props: any) => {
    return renderSectorShape(props, activeIndex);
  };

  // Sync Legend Clicks with Chart Active Index
  const onPieClick = (_: any, index: number) => {
    setActiveIndex(index);
  };

  // Dedicated Daily Process Table Computations (Only days with active processes)
  const totalDaysWithProcesses = useMemo(() => {
    return baseScheduleForView.filter(s => (dailyProcesses?.[s.date]?.length ?? 0) > 0).length;
  }, [baseScheduleForView, dailyProcesses]);

  const processTableEntries = useMemo(() => {
    return baseScheduleForView.filter(entry => {
      const tasks = (dailyProcesses && dailyProcesses[entry.date]) || [];
      // Only include days with active processes
      if (tasks.length === 0) return false;

      if (processSearchQuery.trim()) {
        const q = processSearchQuery.trim().toLowerCase();
        const hasMatchingTask = tasks.some(t => 
          t.title?.toLowerCase().includes(q) || 
          t.vessel?.toLowerCase().includes(q) ||
          t.phase?.toLowerCase().includes(q) ||
          t.details?.toLowerCase().includes(q)
        );
        const matchesDate = entry.date.includes(q) || entry.dayName.includes(q);
        return hasMatchingTask || matchesDate;
      }
      return true;
    });
  }, [baseScheduleForView, dailyProcesses, processSearchQuery]);
  
  const handlePrint = () => {
    const originalTitle = document.title;
    document.title = `داشبورد آمار و گزارشات شیفت - ${monthName}`;
    
    document.body.classList.remove('print-mode-modal');
    document.body.classList.add('print-mode-dashboard');
    
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.body.classList.remove('print-mode-dashboard');
        document.title = originalTitle;
      }, 500);
    }, 100);
  };

  const getPrintDateRange = () => {
      if (filteredSchedule.length === 0) return '';
      const start = toPersianDigits(filteredSchedule[0].date);
      const end = toPersianDigits(filteredSchedule[filteredSchedule.length - 1].date);
      return `${start} - ${end}`;
  };

  // Smooth scroll and focus on Today's shift card/row
  const handleNavigateAndScrollToToday = () => {
    // 1. Sync parent year and month
    if (onNavigateToToday) {
      onNavigateToToday();
    }

    // 2. If a local filter is currently active and excludes today (and not publishedRange forced), reset it
    if (appliedFilter && !publishedRange?.isActive) {
      const todayStr = todayPersianDate;
      const fromStr = `${appliedFilter.from.year}/${appliedFilter.from.month}/${appliedFilter.from.day}`;
      const toStr = `${appliedFilter.to.year}/${appliedFilter.to.month}/${appliedFilter.to.day}`;
      if (todayStr < fromStr || todayStr > toStr) {
        handleClearFilter();
      }
    }

    // 3. Smooth scroll directly to today's shift card (on mobile) or row (on desktop)
    const attemptScroll = (retries = 0) => {
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;
      const todayRow = document.getElementById('shift-today-row');
      const todayCard = document.getElementById('shift-today-card');
      const targetElem = isDesktop ? (todayRow || todayCard) : (todayCard || todayRow);

      if (targetElem) {
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Visual pulsing ring and cell highlight for today's schedule
        if (isDesktop && todayRow && targetElem === todayRow) {
          todayRow.classList.add('outline-3', 'outline-emerald-500', 'ring-4', 'ring-emerald-400/60');
          const cells = todayRow.querySelectorAll('td');
          cells.forEach(td => td.classList.add('bg-emerald-200/90', 'transition-colors', 'duration-500'));
          setTimeout(() => {
            todayRow.classList.remove('outline-3', 'outline-emerald-500', 'ring-4', 'ring-emerald-400/60');
            cells.forEach(td => td.classList.remove('bg-emerald-200/90'));
          }, 2500);
        } else {
          targetElem.classList.add('ring-4', 'ring-emerald-500', 'ring-offset-2', 'transition-all', 'duration-500');
          setTimeout(() => {
            targetElem.classList.remove('ring-4', 'ring-emerald-500', 'ring-offset-2');
          }, 2500);
        }
      } else if (retries < 6) {
        setTimeout(() => attemptScroll(retries + 1), 100);
      } else {
        // Fallback: If not in current schedule, scroll to Today's Live Status card
        const hero = document.getElementById('today-hero-section');
        if (hero) {
          hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };

    setTimeout(() => attemptScroll(0), 50);
  };

  return (
    <div className="dashboard-container space-y-6">
      
      {/* Today Hero (Live Status) */}
      <TodayHero 
        schedule={fullSchedule} 
        onNavigateToToday={handleNavigateAndScrollToToday} 
        todayProcesses={showProcessSchedule ? (dailyProcesses[todayPersianDate] || []) : []}
        onOpenProcessModal={showProcessSchedule ? ((d) => {
          const entry = fullSchedule.find(s => s.date === d);
          setSelectedProcessDate({ date: d, dayName: entry?.dayName || '' });
          setIsProcessModalOpen(true);
        }) : undefined}
      />

      {/* Header & Controls */}
      <div className="flex flex-col gap-3 no-print">
         
         {/* Unified Top Control Card: Title, Month Nav, Actions & Inline Filters */}
         <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden divide-y divide-slate-100">
            
            {/* 1. Header Row: Period Title + Today & Month Navigation */}
            <div className="p-3 sm:p-4 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
               
               {/* Period Info */}
               <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${
                     viewMode === 'RANGE' && appliedFilter
                       ? 'bg-blue-600 text-white'
                       : 'bg-emerald-600 text-white'
                  }`}>
                     <CalendarRange size={19} />
                  </div>
                  <div className="min-w-0 flex-1">
                     {viewMode === 'RANGE' && appliedFilter ? (
                        <div className="space-y-1">
                           <div className="flex items-center gap-1.5 flex-wrap">
                              <h2 className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-snug">
                                 برنامه شیفت
                              </h2>
                              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full border border-blue-200 whitespace-nowrap">
                                 <Lock size={10} />
                                 <span>بازه محدود</span>
                              </span>
                              {filterPerson !== 'All' && (
                                 <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 whitespace-nowrap">
                                    {filterPerson.replace('مهندس', '')}
                                 </span>
                              )}
                           </div>
                           <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold text-slate-600">
                              <span className="tabular-nums text-blue-950 font-black">
                                 {toPersianDigits(appliedFilter.from.year)}/{toPersianDigits(appliedFilter.from.month)}/{toPersianDigits(appliedFilter.from.day)}
                                 <span className="text-slate-400 mx-1 font-medium">تا</span>
                                 {toPersianDigits(appliedFilter.to.year)}/{toPersianDigits(appliedFilter.to.month)}/{toPersianDigits(appliedFilter.to.day)}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="tabular-nums">{toPersianDigits(filteredSchedule.length)} روز</span>
                           </div>
                        </div>
                     ) : (
                        <div>
                           <div className="flex items-center gap-2 flex-wrap">
                              <h2 className="text-sm sm:text-base md:text-lg font-black text-slate-900 tracking-tight leading-snug">
                                 برنامه شیفت {monthName} {toPersianDigits(year)}
                              </h2>
                              {filterPerson !== 'All' && (
                                 <span className="bg-emerald-50 text-emerald-800 text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 whitespace-nowrap">
                                    فیلتر: {filterPerson.replace('مهندس', '')}
                                 </span>
                              )}
                           </div>
                           <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5 tabular-nums">
                              {toPersianDigits(filteredSchedule.length)} روز شیفت در جدول
                           </p>
                        </div>
                     )}
                  </div>
               </div>

               {/* Today Button + Month Navigator */}
               <div className="flex items-center gap-2 justify-between sm:justify-end w-full md:w-auto shrink-0 pt-2.5 md:pt-0 border-t md:border-t-0 border-slate-100">
                  {onNavigateToToday && (
                     <button 
                       onClick={handleNavigateAndScrollToToday}
                       className="h-9 sm:h-10 flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300/80 hover:border-emerald-400 px-3 rounded-xl text-xs font-black transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 group"
                       title="پرش و اسکرول مستقیم به برنامه شیفت امروز"
                     >
                       <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                       <CalendarCheck size={15} className="text-emerald-600 shrink-0" />
                       <span>امروز</span>
                       <span className="hidden sm:inline text-[10.5px] font-black text-emerald-700 bg-white/80 px-1.5 py-0.5 rounded-md tabular-nums">
                          {toPersianDigits(todayPersianDate)}
                       </span>
                     </button>
                  )}
                  <div className="h-9 sm:h-10 flex items-center bg-slate-50/90 px-1 rounded-xl border border-slate-200/90 shrink-0">
                     <button onClick={onPrevMonth} className="p-1.5 hover:bg-white rounded-lg text-slate-600 transition cursor-pointer" title="ماه قبل">
                        <ChevronRight size={17} />
                     </button>
                     <span className="font-extrabold text-slate-800 text-xs sm:text-sm px-2 sm:px-2.5 text-center min-w-[82px] sm:min-w-[94px] whitespace-nowrap">
                        {monthName} {toPersianDigits(year)}
                     </span>
                     <button onClick={onNextMonth} className="p-1.5 hover:bg-white rounded-lg text-slate-600 transition cursor-pointer" title="ماه بعد">
                        <ChevronLeft size={17} />
                     </button>
                  </div>
               </div>
            </div>

            {/* 2. Unified Action Toolbar Row */}
            <div className="px-3 py-2.5 sm:px-4 bg-slate-50/45 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
               {/* Owner Tools Group */}
               {isOwner ? (
                 <div className="flex items-center gap-1.5 w-full md:w-auto flex-wrap">
                    <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-black text-amber-800 bg-amber-50 border border-amber-200/90 px-2 py-1 rounded-lg shrink-0">
                       <Crown size={12} className="text-amber-600 shrink-0" />
                       <span>مدیریت</span>
                    </span>

                    <button 
                      onClick={onRegenerate}
                      className="h-9 flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50/50 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer"
                      title="چیدمان مجدد هوشمند"
                    >
                       <RefreshCw size={14} className="shrink-0 text-amber-600" />
                       <span>آپدیت</span>
                    </button>

                    <button 
                      onClick={onToggleLock}
                      className={`h-9 flex items-center justify-center gap-1.5 border px-2.5 sm:px-3 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                        isLocked 
                          ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100' 
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                      title={isLocked ? 'قفل شده' : 'باز (قابل ویرایش)'}
                    >
                       {isLocked ? <Lock size={14} className="shrink-0 text-red-500" /> : <Unlock size={14} className="shrink-0 text-slate-500" />}
                       <span>{isLocked ? 'قفل' : 'باز'}</span>
                    </button>

                    <button 
                       onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                       className={`h-9 flex items-center justify-center gap-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition border whitespace-nowrap cursor-pointer ${
                          publishedRange?.isActive 
                             ? 'bg-amber-500 text-white border-amber-600' 
                             : appliedFilter 
                                ? 'bg-blue-600 text-white border-blue-700' 
                                : isFiltersOpen 
                                   ? 'bg-amber-50 border-amber-300 text-amber-900' 
                                   : 'bg-white border-slate-200 text-slate-700 hover:bg-amber-50/40 hover:border-amber-200'
                       }`}
                       title="محدودسازی روزها و تعیین بازه برای نمایش به سایر کاربران"
                    >
                       <Crown size={14} className={`shrink-0 ${publishedRange?.isActive || appliedFilter ? 'text-white' : 'text-amber-600'}`} />
                       <span>محدودسازی بازه</span>
                       {publishedRange?.isActive ? (
                          <span className="hidden sm:inline bg-black/20 text-white px-1.5 py-0.5 rounded-full text-[9px] font-black">
                             منتشر
                          </span>
                       ) : appliedFilter ? (
                          <span className="hidden sm:inline bg-white/25 text-white px-1.5 py-0.5 rounded-full text-[9px] font-black">
                             فیلتر
                          </span>
                       ) : null}
                       {isFiltersOpen ? <ChevronUp size={13} className="shrink-0" /> : <ChevronDown size={13} className="shrink-0" />}
                    </button>
                 </div>
               ) : null}

               {/* General Actions Group */}
               <div className={`flex flex-wrap items-center gap-1.5 w-full md:w-auto ${isOwner ? 'pt-2 md:pt-0 border-t md:border-t-0 border-slate-200/70 md:mr-auto' : 'md:mr-auto md:justify-end'}`}>
                  <button 
                    id="btn-toggle-shift-filter"
                    type="button"
                    onClick={() => setIsShiftFilterOpen(prev => !prev)}
                    className={`h-9 flex items-center justify-center gap-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                      filterPerson !== 'All' || filterShiftType !== 'ALL'
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : isShiftFilterOpen
                          ? 'bg-blue-50 text-blue-800 border border-blue-300'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                    title="فیلتر هوشمند پرسنل و نوع شیفت"
                  >
                     <Filter size={14} className={filterPerson !== 'All' || filterShiftType !== 'ALL' ? 'text-white' : 'text-blue-600'} />
                     <span>فیلتر شیفت</span>
                     {(filterPerson !== 'All' || filterShiftType !== 'ALL') && (
                       <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                         {filterPerson !== 'All' && filterShiftType !== 'ALL' ? '۲' : '۱'}
                       </span>
                     )}
                     {isShiftFilterOpen ? <ChevronUp size={13} className="shrink-0 opacity-70" /> : <ChevronDown size={13} className="shrink-0 opacity-70" />}
                  </button>

                  {isOwner && (
                    <button 
                      type="button"
                      onClick={() => {
                        const el = document.getElementById('fairness-analysis-section');
                        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="h-9 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:border-indigo-400 text-slate-700 hover:text-indigo-700 hover:bg-indigo-50/50 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer"
                      title="تحلیل عدالت، سختی کار و ساعت وزنی پرسنل"
                    >
                       <Scale size={14} className="shrink-0 text-indigo-600" />
                       <span>تحلیل عدالت</span>
                    </button>
                  )}

                  <button 
                    onClick={onOpenReport}
                    className="h-9 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 sm:px-3 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer"
                    title="گزارش فردی"
                  >
                     <FileText size={14} className="shrink-0" />
                     <span>کارکرد پرسنل</span>
                  </button>

                  <button 
                    onClick={handlePrint}
                    className="h-9 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-black text-white px-2.5 sm:px-3 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer"
                    title="چاپ برنامه"
                  >
                     <Printer size={14} className="shrink-0" />
                     <span>پرینت</span>
                  </button>
               </div>
            </div>

            {/* 3. Inline Active Filter Strip (when panel is closed & filter is active) */}
            {!isShiftFilterOpen && (filterPerson !== 'All' || filterShiftType !== 'ALL') && (
              <div className="flex items-center justify-between gap-2 bg-blue-50/70 text-blue-950 px-3 py-2 sm:px-4 text-xs font-bold print:hidden">
                <div className="flex items-center gap-2 flex-wrap">
                  <Filter size={13} className="text-blue-600 shrink-0" />
                  <span className="text-slate-600">فیلتر فعال:</span>
                  {filterPerson !== 'All' && (
                    <span className="bg-white px-2 py-0.5 rounded-lg border border-blue-200 text-slate-900 font-extrabold">
                      {filterPerson}
                    </span>
                  )}
                  {filterShiftType !== 'ALL' && (
                    <span className={`px-2 py-0.5 rounded-lg text-white text-[11px] font-black ${
                      filterShiftType === 'DAY' ? 'bg-amber-500' : 'bg-indigo-600'
                    }`}>
                      {filterShiftType === 'DAY' ? 'شیفت روز' : 'شیفت شب'}
                    </span>
                  )}
                  <span className="text-slate-500 text-[11px] font-medium tabular-nums">
                    ({toPersianDigits(filteredSchedule.length)} روز)
                  </span>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsShiftFilterOpen(true)}
                    className="text-blue-700 hover:text-blue-900 hover:underline text-xs cursor-pointer font-bold"
                  >
                    تغییر
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterPerson('All');
                      setFilterShiftType('ALL');
                    }}
                    className="flex items-center gap-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded-lg text-xs font-bold transition cursor-pointer"
                    title="حذف فیلترها"
                  >
                    <X size={12} />
                    <span>حذف</span>
                  </button>
                </div>
              </div>
            )}

            {/* 4. Inline Collapsible Shift & Personnel Filter Drawer */}
            {isShiftFilterOpen && (
              <div className="bg-slate-50/60 p-3.5 sm:p-4 space-y-3.5 animate-in slide-in-from-top-2 duration-150 print:hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Filter size={15} className="text-blue-600" />
                    <span className="font-extrabold text-slate-900 text-xs sm:text-sm">
                      فیلتر هوشمند شیفت و پرسنل
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {(filterPerson !== 'All' || filterShiftType !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterPerson('All');
                          setFilterShiftType('ALL');
                        }}
                        className="text-[11px] font-bold text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
                      >
                        <X size={13} />
                        <span>حذف فیلترها</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsShiftFilterOpen(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition cursor-pointer"
                      title="بستن منوی فیلتر"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 items-start">
                  <div className="space-y-1.5">
                    <label htmlFor="modal-person-filter" className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <Users size={14} className="text-emerald-600 shrink-0" />
                      <span>انتخاب پرسنل:</span>
                    </label>
                    <div className="relative">
                      <select
                        id="modal-person-filter"
                        value={filterPerson}
                        onChange={(e) => setFilterPerson(e.target.value)}
                        className="w-full h-10 bg-white text-slate-900 text-xs font-black rounded-xl px-3 pl-8 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition cursor-pointer appearance-none"
                      >
                        <option value="All">همه پرسنل (نمایش عمومی تقویم)</option>
                        {shiftWorkers.map((person) => (
                          <option key={person} value={person}>
                            {person}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <Layers size={14} className="text-blue-600 shrink-0" />
                      <span>تفکیک شیفت کاری:</span>
                    </label>
                    <div className="grid grid-cols-3 gap-1 bg-slate-200/70 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setFilterShiftType('ALL')}
                        className={`h-8 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                          filterShiftType === 'ALL'
                            ? 'bg-white text-slate-900 shadow-2xs font-black'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span>هر دو شیفت</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setFilterShiftType('DAY')}
                        className={`h-8 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                          filterShiftType === 'DAY'
                            ? 'bg-amber-500 text-white shadow-2xs font-black'
                            : 'text-slate-600 hover:text-amber-700 hover:bg-amber-50'
                        }`}
                      >
                        <Sun size={13} className={filterShiftType === 'DAY' ? 'text-white' : 'text-amber-500'} />
                        <span>روز (۰۸-۱۹)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setFilterShiftType('NIGHT')}
                        className={`h-8 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap ${
                          filterShiftType === 'NIGHT'
                            ? 'bg-indigo-600 text-white shadow-2xs font-black'
                            : 'text-slate-600 hover:text-indigo-700 hover:bg-indigo-50'
                        }`}
                      >
                        <Moon size={13} className={filterShiftType === 'NIGHT' ? 'text-white' : 'text-indigo-500'} />
                        <span>شب (۱۹-۰۸)</span>
                      </button>
                    </div>
                  </div>
                </div>

                {selectedPersonStats && (
                  <div className="pt-2.5 border-t border-slate-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span 
                        className="w-2.5 h-2.5 rounded-full shrink-0" 
                        style={{ backgroundColor: GET_PERSON_COLOR(selectedPersonStats.name, personnelList) }}
                      />
                      <span className="font-black text-slate-900">
                        {selectedPersonStats.name}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="font-bold text-slate-600 tabular-nums">
                        {toPersianDigits(selectedPersonStats.totalCount)} شیفت ({toPersianDigits(selectedPersonStats.totalHours)} ساعت)
                      </span>
                      <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-black text-[11px] tabular-nums">
                        روز: {toPersianDigits(selectedPersonStats.dayCount)}
                      </span>
                      <span className="bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-md font-black text-[11px] tabular-nums">
                        شب: {toPersianDigits(selectedPersonStats.nightCount)}
                      </span>
                    </div>

                    <span className="bg-emerald-600 text-white px-2.5 py-0.5 rounded-full font-black text-[10.5px] tabular-nums">
                      {toPersianDigits(filteredSchedule.length)} روز در جدول
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
                  <span className="text-[11px] text-slate-500 font-medium tabular-nums">
                    {filteredSchedule.length === 0
                      ? 'هیچ شیفتی با فیلتر فعلی یافت نشد'
                      : `نمایش ${toPersianDigits(filteredSchedule.length)} روز بر اساس فیلتر انتخابی`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsShiftFilterOpen(false)}
                    className="bg-slate-800 hover:bg-slate-950 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    بستن
                  </button>
                </div>
              </div>
            )}
            {/* 5. Active Range Banner (Unified inside Top Card, flattened pills) */}
            {/* Case 1: Owner viewing with a Published Range active */}
            {isOwner && publishedRange?.isActive && !isFiltersOpen && (
              <div className="bg-amber-50/70 px-3 py-2.5 sm:px-4 text-xs text-amber-950">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                      <Crown size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-black text-amber-950 text-xs sm:text-[13px]">
                          بازه عمومی محدودشده
                        </span>
                        <span className="inline-flex items-center gap-1 bg-amber-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          <Lock size={10} />
                          <span>قفل و فعال برای همه</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] font-bold text-amber-900">
                        <span className="inline-flex items-center gap-1 tabular-nums font-black text-amber-950">
                          <CalendarRange size={12} className="text-amber-600 shrink-0" />
                          {toPersianDigits(publishedRange.from.year)}/{toPersianDigits(publishedRange.from.month)}/{toPersianDigits(publishedRange.from.day)}
                          <span className="text-amber-700/70 font-medium mx-0.5">تا</span>
                          {toPersianDigits(publishedRange.to.year)}/{toPersianDigits(publishedRange.to.month)}/{toPersianDigits(publishedRange.to.day)}
                        </span>
                        <span className="text-amber-300">•</span>
                        <span className="tabular-nums">{toPersianDigits(filteredSchedule.length)} روز شیفت</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-amber-200/70 shrink-0">
                    <button
                      onClick={() => setIsFiltersOpen(true)}
                      className="flex-1 sm:flex-initial bg-white hover:bg-amber-100/70 text-amber-900 border border-amber-300/90 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer text-center"
                    >
                      تغییر بازه
                    </button>
                    <button
                      onClick={handleClearPublishedRange}
                      className="flex-1 sm:flex-initial flex items-center justify-center gap-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                      title="لغو انتشار بازه برای کاربران و بازگشت به نمایش تقویم عادی برای همه"
                    >
                      <X size={14} />
                      <span>لغو انتشار</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Case 2: Owner with a temporary local filter applied (not yet published) */}
            {isOwner && !publishedRange?.isActive && appliedFilter && !isFiltersOpen && (
              <div className="bg-blue-50/70 px-3 py-2.5 sm:px-4 text-xs text-blue-950">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                      <Filter size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-black text-blue-950 text-xs sm:text-[13px]">
                          بازه موقت (پیش‌نمایش شخصی)
                        </span>
                        <span className="bg-slate-200/90 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          ذخیره نشده برای دیگران
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] font-bold text-blue-900">
                        <span className="inline-flex items-center gap-1 tabular-nums font-black text-blue-950">
                          <CalendarRange size={12} className="text-blue-600 shrink-0" />
                          {toPersianDigits(appliedFilter.from.year)}/{toPersianDigits(appliedFilter.from.month)}/{toPersianDigits(appliedFilter.from.day)}
                          <span className="text-blue-700/60 font-medium mx-0.5">تا</span>
                          {toPersianDigits(appliedFilter.to.year)}/{toPersianDigits(appliedFilter.to.month)}/{toPersianDigits(appliedFilter.to.day)}
                        </span>
                        <span className="text-blue-300">•</span>
                        <span className="tabular-nums">{toPersianDigits(filteredSchedule.length)} روز</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-blue-200/70 flex-wrap shrink-0">
                    <button
                      onClick={handlePublishRangeForEveryone}
                      className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer"
                      title="انتشار این بازه برای همه کاربران تا سایرین فقط این روزها را ببینند"
                    >
                      <Crown size={14} />
                      <span>انتشار برای همه</span>
                    </button>
                    <button
                      onClick={() => setIsFiltersOpen(true)}
                      className="bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      تغییر بازه
                    </button>
                    <button
                      onClick={handleClearFilter}
                      className="flex items-center justify-center gap-1 bg-white hover:bg-red-50 text-red-600 border border-red-200 px-2.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      <X size={14} />
                      <span>لغو</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Case 3: Non-Owner viewing when a Published Range is active */}
            {!isOwner && publishedRange?.isActive && (
              <div className="bg-blue-50/70 px-3 py-2.5 sm:px-4 text-xs text-blue-950">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                      <ShieldCheck size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-black text-blue-950 text-xs sm:text-[13px]">
                          بازه زمانی مجاز (تعیین‌شده توسط مدیریت)
                        </span>
                        <span className="inline-flex items-center gap-1 bg-emerald-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          <Check size={10} strokeWidth={3} />
                          <span>تأیید شده</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 font-medium mt-0.5 hidden sm:block">
                        سامانه صرفاً شیفت‌های این محدوده زمانی را نمایش می‌دهد.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap mr-10 sm:mr-0 text-[11px] font-bold text-blue-900 shrink-0">
                    <span className="inline-flex items-center gap-1.5 bg-white/90 px-2.5 py-1 rounded-xl border border-blue-200/80 text-blue-950 font-black tabular-nums">
                      <CalendarRange size={13} className="text-blue-600 shrink-0" />
                      {toPersianDigits(publishedRange.from.year)}/{toPersianDigits(publishedRange.from.month)}/{toPersianDigits(publishedRange.from.day)}
                      <span className="text-slate-400 font-medium">تا</span>
                      {toPersianDigits(publishedRange.to.year)}/{toPersianDigits(publishedRange.to.month)}/{toPersianDigits(publishedRange.to.day)}
                    </span>
                    <span className="text-blue-700 font-extrabold tabular-nums">
                      {toPersianDigits(filteredSchedule.length)} روز شیفت
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 6. Inline Owner Range Management Drawer - STRICTLY OWNER ONLY */}
            {isOwner && isFiltersOpen && (
              <div className="bg-amber-50/25 p-3.5 sm:p-4 md:p-5 space-y-4 animate-in slide-in-from-top-2 duration-150">
                
                {/* Drawer Header */}
                <div className="flex justify-between items-center pb-2.5 border-b border-amber-200/60">
                  <div className="flex items-center gap-2">
                    <Crown size={17} className="text-amber-500 shrink-0" />
                    <span className="font-extrabold text-slate-900 text-xs sm:text-sm">
                      مدیریت و محدودسازی بازه نمایش روزها (مخصوص مدیر پنل)
                    </span>
                  </div>
                  <button
                    onClick={() => setIsFiltersOpen(false)}
                    className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
                  >
                    <X size={17} />
                  </button>
                </div>

                {/* Concise Tip Strip (no extra outer card border) */}
                <div className="border-r-2 border-amber-400 pr-3 text-xs text-amber-900 leading-5">
                  <p className="font-bold">
                    بازه روزها را انتخاب کرده و دکمه <strong>«انتشار و قفل برای همه کاربران»</strong> را بزنید تا سایر کاربران صرفاً همین بازه را مشاهده کنند.
                  </p>
                </div>

                {/* Quick Presets */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-slate-600 block">انتخاب سریع بازه روزها:</span>
                    {(appliedFilter || publishedRange?.isActive) && (
                      <button
                        onClick={handleClearFilter}
                        className="flex items-center gap-1 text-[11px] font-bold text-red-600 hover:bg-red-50 px-2 py-0.5 rounded transition cursor-pointer"
                      >
                        <X size={12} />
                        حذف محدودیت
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => applyQuickRange('firstHalf')}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200 transition cursor-pointer"
                    >
                      ۱ تا ۱۵ ماه (نیمه اول)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickRange('secondHalf')}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200 transition cursor-pointer"
                    >
                      ۱۶ تا پایان ماه (نیمه دوم)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickRange('next7Days')}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 border border-slate-200 transition cursor-pointer"
                    >
                      ۷ روز از امروز به بعد
                    </button>
                    <button
                      type="button"
                      onClick={() => applyQuickRange('fullMonth')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                        !appliedFilter && !publishedRange?.isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      کل ماه
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200/70">
                  {/* Date Range Selector */}
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">محدود کردن دقیق روزها (از تاریخ ... تا تاریخ ...):</label>
                    <div className="flex flex-col gap-2.5 bg-white p-3 rounded-xl border border-slate-200/90">
                      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
                        {/* From Group */}
                        <div className="flex items-center gap-1.5 w-full sm:w-auto justify-start">
                          <span className="text-xs font-bold text-slate-500 min-w-[20px]">از:</span>
                          <div className="flex items-center gap-1 flex-1 sm:flex-initial">
                            <DashboardDateSelect value={fromDate.day} onChange={(v) => setFromDate({...fromDate, day: v})} options={PERSIAN_DAYS} width="w-12 sm:w-[50px]" />
                            <DashboardDateSelect value={fromDate.month} onChange={(v) => setFromDate({...fromDate, month: v})} options={PERSIAN_MONTHS} width="w-20 sm:w-[82px]" />
                            <DashboardDateSelect value={fromDate.year} onChange={(v) => setFromDate({...fromDate, year: v})} options={['1403', '1404', '1405']} width="w-16 sm:w-[62px]" />
                          </div>
                        </div>

                        {/* To Group */}
                        <div className="flex items-center gap-1.5 w-full sm:w-auto justify-start">
                          <span className="text-xs font-bold text-slate-500 min-w-[20px]">تا:</span>
                          <div className="flex items-center gap-1 flex-1 sm:flex-initial">
                            <DashboardDateSelect value={toDate.day} onChange={(v) => setToDate({...toDate, day: v})} options={PERSIAN_DAYS} width="w-12 sm:w-[50px]" />
                            <DashboardDateSelect value={toDate.month} onChange={(v) => setToDate({...toDate, month: v})} options={PERSIAN_MONTHS} width="w-20 sm:w-[82px]" />
                            <DashboardDateSelect value={toDate.year} onChange={(v) => setToDate({...toDate, year: v})} options={['1403', '1404', '1405']} width="w-16 sm:w-[62px]" />
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100">
                        <span className="text-[11px] text-slate-500 block tabular-nums">
                          بازه انتخابی: <strong className="text-slate-800 dir-ltr">{toPersianDigits(fromDate.year)}/{toPersianDigits(fromDate.month)}/{toPersianDigits(fromDate.day)}</strong> تا <strong className="text-slate-800 dir-ltr">{toPersianDigits(toDate.year)}/{toPersianDigits(toDate.month)}/{toPersianDigits(toDate.day)}</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Person Filter */}
                  <div>
                    <label className="text-xs font-bold text-slate-600 mb-2 block">فیلتر پرسنل (اختیاری):</label>
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      <button
                        onClick={() => setFilterPerson('All')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${filterPerson === 'All' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                      >
                        همه
                      </button>
                      {shiftWorkers.map(p => (
                        <button
                          key={p}
                          onClick={() => setFilterPerson(p)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${filterPerson === p ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                        >
                          {p.replace('مهندس', '')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom Actions for Owner */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-slate-200/80">
                  <div className="flex items-center gap-2">
                    {publishedRange?.isActive && (
                      <button
                        type="button"
                        onClick={handleClearPublishedRange}
                        className="h-9 px-3 flex items-center justify-center bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-xs font-bold transition gap-1 cursor-pointer w-full sm:w-auto"
                        title="لغو انتشار بازه برای کاربران و بازگشت به نمایش تقویم عادی"
                      >
                        <X size={14} />
                        <span>لغو بازه عمومی (نمایش کامل برای همه)</span>
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col xs:flex-row items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      type="button"
                      onClick={handleApplyFilter}
                      className="h-9 px-3.5 flex items-center justify-center bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition gap-1.5 cursor-pointer w-full xs:w-auto"
                      title="اعمال موقت فقط در نشست فعلی شما"
                    >
                      <CheckCircle2 size={15} className="text-slate-600" />
                      <span>پیش‌نمایش برای خودم</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishRangeForEveryone}
                      className="h-9 px-4 sm:px-5 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black transition gap-1.5 sm:gap-2 cursor-pointer w-full xs:w-auto"
                      title="ذخیره و محدودسازی نمایش فقط به این بازه برای تمام کاربران"
                    >
                      <Crown size={15} />
                      <span>انتشار و قفل برای همه کاربران</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
         </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 print:block print:w-full">
        
        {/* Left: Schedule Table */}
        <div className="lg:col-span-3 space-y-6 print:col-span-full print:w-full print:space-y-0">
            
            {/* --- DEDICATED EXECUTIVE PRINT VIEW --- */}
            <div className="hidden print:block w-full text-slate-900 font-sans" id="dashboard-print-view">
                
                {/* 1. Official Header Frame */}
                <div className="border-2 border-slate-800 rounded-xl p-3 bg-white mb-2 shadow-2xs">
                    <div className="grid grid-cols-3 items-center gap-2">
                        {/* Right: Organization */}
                        <div className="flex items-center gap-2.5 text-right">
                            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black text-sm tracking-wider shadow-xs shrink-0" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
                                FMD
                            </div>
                            <div>
                                <h2 className="text-sm font-black text-slate-900 leading-tight">سامانه مدیریت شیفت تولید</h2>
                            </div>
                        </div>

                        {/* Center: Main Document Title */}
                        <div className="flex flex-col items-center justify-center text-center">
                            <h1 className="text-lg font-black text-slate-900">
                                جدول زمان‌بندی و برنامه شیفت کاری
                            </h1>
                            <div className="text-xs font-extrabold text-slate-700 mt-1">
                                {`${monthName} ماه ${toPersianDigits(year)}`}
                            </div>
                        </div>

                        {/* Left: Administrative Metadata */}
                        <div className="flex flex-col items-end text-left space-y-0.5 text-[8pt]">
                            <div className="bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-[7.5pt] font-black text-slate-800">
                                کد سند: DOC-FMD-ROSTER
                            </div>
                            <div className="text-slate-800 font-bold">
                                تاریخ چاپ: <span className="font-black">{toPersianDigits(new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' }))}</span>
                            </div>
                            <div className="text-slate-600 font-bold">
                                زمان چاپ: <span className="font-black">{toPersianDigits(new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }))}</span>
                            </div>
                            <div className="text-slate-700 font-bold">
                                بازه زمانی: <span dir="ltr" className="font-black">{getPrintDateRange()}</span>
                            </div>
                            <div className="text-emerald-800 font-black text-[7.5pt]">
                                وضعیت: نسخه رسمی و مصوب
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Key Metrics & Legend Ribbon */}
                <div className="flex items-center justify-between bg-slate-100 border border-slate-300 rounded-lg px-3 py-1.5 mb-2 text-[8pt]">
                    {/* Summary Badges */}
                    <div className="flex items-center gap-3 font-bold text-slate-800">
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500">کل روزهای دوره:</span>
                            <span className="font-black bg-white px-1.5 py-0.5 rounded border border-slate-300">{toPersianDigits(filteredSchedule.length)} روز</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500">روزهای عادی کاری:</span>
                            <span className="font-black bg-white px-1.5 py-0.5 rounded border border-slate-300 text-slate-900">{toPersianDigits(filteredSchedule.filter(s => !s.isHoliday && s.dayName !== 'جمعه').length)} روز</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500">تعطیل رسمی و جمعه:</span>
                            <span className="font-black bg-white px-1.5 py-0.5 rounded border border-slate-300 text-red-600">{toPersianDigits(filteredSchedule.filter(s => s.isHoliday || s.dayName === 'جمعه').length)} روز</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500">پرسنل شیفت:</span>
                            <span className="font-black bg-white px-1.5 py-0.5 rounded border border-slate-300">{toPersianDigits(shiftWorkers.length)} نفر</span>
                        </div>
                    </div>

                    {/* Shift Legend */}
                    <div className="flex items-center gap-3 text-[7.5pt] font-black text-slate-700">
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-600"></span>
                            <span>شیفت روز: ۰۸:۰۰ الی ۱۹:۰۰</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                            <span>شیفت شب: ۱۹:۰۰ الی ۰۸:۰۰</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                            <span>سرپرست: ۲۴ ساعته</span>
                        </span>
                    </div>
                </div>

                {/* 3. The Beautified Print Table */}
                <table className="w-full text-center border-collapse border-2 border-slate-800 text-[8.5pt]" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '19%' }} />
                    </colgroup>
                    <thead>
                        <tr className="bg-slate-800 text-white font-black">
                            <th className="border border-slate-700 py-1.5 px-1 text-center">ردیف</th>
                            <th className="border border-slate-700 py-1.5 px-1 text-center">روز</th>
                            <th className="border border-slate-700 py-1.5 px-1 text-center">تاریخ</th>
                            <th className="border border-slate-700 py-1.5 px-1 text-center">نوع روز</th>
                            <th className="border border-slate-700 py-1.5 px-1 text-center">
                                شیفت روز (۰۸ - ۱۹)
                            </th>
                            <th className="border border-slate-700 py-1.5 px-1 text-center">
                                شیفت شب (۱۹ - ۰۸)
                            </th>
                            <th className="border border-slate-700 py-1.5 px-1 text-center">
                                سرپرست (On-Call)
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                        {filteredSchedule.map((entry, index) => {
                            const isFriday = entry.dayName === 'جمعه';
                            const isHoliday = entry.isHoliday;
                            const isThursday = entry.dayName === 'پنج‌شنبه';

                            let rowBg = index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70';
                            if (isFriday || isHoliday) {
                                rowBg = 'bg-red-50/80 text-red-950 font-semibold';
                            } else if (isThursday) {
                                rowBg = 'bg-purple-50/50';
                            }

                            const isDaySwapped = entry.originalDayShiftPerson && entry.originalDayShiftPerson !== entry.dayShiftPerson;
                            const isNightSwapped = entry.originalNightShiftPerson && entry.originalNightShiftPerson !== entry.nightShiftPerson;

                            return (
                                <tr key={`print-row-${entry.id}`} className={rowBg} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                                    {/* Row Number */}
                                    <td className="border border-slate-400 py-1 px-1 text-center font-bold text-slate-700">
                                        {toPersianDigits(index + 1)}
                                    </td>

                                    {/* Day Name */}
                                    <td className={`border border-slate-400 py-1 px-1 text-center font-black ${isFriday || isHoliday ? 'text-red-700' : isThursday ? 'text-purple-800' : 'text-slate-800'}`}>
                                        {entry.dayName}
                                    </td>

                                    {/* Persian Date */}
                                    <td className="border border-slate-400 py-1 px-1 text-center font-bold text-slate-800 dir-ltr">
                                        {toPersianDigits(entry.date)}
                                    </td>

                                    {/* Day Status */}
                                    <td className="border border-slate-400 py-1 px-1 text-center">
                                        {isHoliday ? (
                                            <span className="inline-block bg-red-100 text-red-700 border border-red-300 px-1 py-0.5 rounded text-[7pt] font-black">
                                                تعطیل رسمی
                                            </span>
                                        ) : isFriday ? (
                                            <span className="inline-block bg-red-100 text-red-700 border border-red-300 px-1 py-0.5 rounded text-[7pt] font-black">
                                                جمعه
                                            </span>
                                        ) : isThursday ? (
                                            <span className="inline-block bg-purple-100 text-purple-700 border border-purple-200 px-1 py-0.5 rounded text-[7pt] font-bold">
                                                پنج‌شنبه
                                            </span>
                                        ) : (
                                            <span className="text-[7.5pt] font-medium text-slate-600">
                                                عادی
                                            </span>
                                        )}
                                    </td>

                                    {/* Day Shift */}
                                    <td className="border border-slate-400 py-1 px-1.5 text-center">
                                        <div className="flex flex-col items-center justify-center leading-tight">
                                            <span className="font-black text-[9pt] text-slate-900">
                                                {entry.dayShiftPerson}
                                            </span>
                                            {isDaySwapped && (
                                                <span className="text-[6.5pt] text-amber-900 font-bold bg-amber-50 px-1 rounded border border-amber-200 mt-0.5">
                                                    (جابجایی با {entry.originalDayShiftPerson})
                                                </span>
                                            )}
                                            {entry.extraDayPersons && entry.extraDayPersons.length > 0 && (
                                                <div className="flex flex-col items-center gap-0.5 mt-0.5">
                                                    {entry.extraDayPersons.map((extraName, idx) => (
                                                        <span key={idx} className="text-[7.5pt] font-black text-orange-950 bg-orange-100/90 px-1 rounded border border-orange-300">
                                                            + {extraName} (نفر {idx === 0 ? 'دوم' : 'سوم'})
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </td>

                                    {/* Night Shift */}
                                    <td className="border border-slate-400 py-1 px-1.5 text-center">
                                        <div className="flex flex-col items-center justify-center leading-tight">
                                            <span className="font-black text-[9pt] text-slate-900">
                                                {entry.nightShiftPerson}
                                            </span>
                                            {isNightSwapped && (
                                                <span className="text-[6.5pt] text-amber-900 font-bold bg-amber-50 px-1 rounded border border-amber-200 mt-0.5">
                                                    (جابجایی با {entry.originalNightShiftPerson})
                                                </span>
                                            )}
                                            {entry.extraNightPersons && entry.extraNightPersons.length > 0 && (
                                                <div className="flex flex-col items-center gap-0.5 mt-0.5">
                                                    {entry.extraNightPersons.map((extraName, idx) => (
                                                        <span key={idx} className="text-[7.5pt] font-black text-indigo-950 bg-indigo-100/90 px-1 rounded border border-indigo-300">
                                                            + {extraName} (نفر {idx === 0 ? 'دوم' : 'سوم'})
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </td>

                                    {/* Supervisor */}
                                    <td className="border border-slate-400 py-1 px-1.5 text-center">
                                        <span className="font-extrabold text-[8.5pt] text-slate-800">
                                            {entry.onCallPerson}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {/* 4. Single Unit Supervisor Approval Box */}
                <div className="mt-3 flex items-end justify-between" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                    <div className="text-[7.5pt] text-slate-500 max-w-md">
                        <p className="font-bold text-slate-700 mb-0.5">ملاحظات اداری:</p>
                        <p>این سند مبنای حضور، غیاب و صدور کارکرد ماهانه پرسنل بوده و هرگونه جابجایی صرفاً با تأیید کتبی سرپرست معتبر است.</p>
                    </div>

                    <div className="w-64 border-2 border-slate-800 rounded-xl p-2.5 bg-white text-center shadow-2xs">
                        <div className="text-[9pt] font-black text-slate-900 mb-1">
                            تأییدیه سرپرست واحد
                        </div>
                        <div className="text-[7.5pt] text-slate-600 mb-3">
                            نام و نام خانوادگی: .............................
                        </div>
                        <div className="border-t border-dashed border-slate-300 pt-1 flex justify-between items-center text-[7pt] text-slate-600 px-1">
                            <span>تاریخ: ..... / ..... / ۱۴۰</span>
                            <span>امضا: ....................</span>
                        </div>
                    </div>
                </div>

                {/* 5. Official Footer */}
                <div className="mt-1.5 flex items-center justify-end text-[7pt] font-bold text-slate-500 px-1" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                    <p>
                        سامانه یکپارچه مدیریت شیفت ShiftFlow
                    </p>
                </div>
            </div>

            {/* Desktop Table (Screen Only) */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hidden md:block print:hidden">
               <div className="overflow-x-auto">
                 <table className="w-full text-sm text-center border-collapse">
                   <colgroup className="hidden print:table-column-group">
                       <col style={{width: '8%'}} />
                       <col style={{width: '12%'}} />
                       <col style={{width: '26.6%'}} />
                       <col style={{width: '26.6%'}} />
                       <col style={{width: '26.6%'}} />
                   </colgroup>
                   
                   <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 print:bg-gray-100 print:text-black print:border-black">
                     <tr>
                       <th className="p-4 print:p-1 border border-slate-200 print:border-black">روز</th>
                       <th className="p-4 print:p-1 border border-slate-200 print:border-black">تاریخ</th>
                        <th className={`p-4 print:p-1 border border-slate-200 print:border-black transition-colors ${filterShiftType === 'DAY' ? 'bg-amber-100/80 text-amber-950 font-black border-amber-300 ring-1 ring-amber-400/40' : ''}`}>
                          <div className="flex items-center justify-center gap-1.5">
                            <Sun size={15} className="text-amber-500 shrink-0" />
                            <span>شیفت روز (۰۸ - ۱۹)</span>
                            {filterShiftType === 'DAY' && (
                              <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.2 rounded-full font-black">فعال</span>
                            )}
                          </div>
                        </th>
                        <th className={`p-4 print:p-1 border border-slate-200 print:border-black transition-colors ${filterShiftType === 'NIGHT' ? 'bg-indigo-100/80 text-indigo-950 font-black border-indigo-300 ring-1 ring-indigo-400/40' : ''}`}>
                          <div className="flex items-center justify-center gap-1.5">
                            <Moon size={15} className="text-indigo-500 shrink-0" />
                            <span>شیفت شب (۱۹ - ۰۸)</span>
                            {filterShiftType === 'NIGHT' && (
                              <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.2 rounded-full font-black">فعال</span>
                            )}
                          </div>
                        </th>
                       <th className="p-4 print:p-1 border border-slate-200 print:border-black">سرپرست (On-Call)</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100 print:divide-black">
                     {filteredSchedule.map((entry) => {
                       const isToday = entry.date === todayPersianDate;
                       const isFriday = entry.dayName === 'جمعه';
                       const isHoliday = entry.isHoliday;
                       const isThursday = entry.dayName === 'پنج‌شنبه';
                       
                       let rowClass = 'hover:bg-slate-50 transition-colors'; 
                       if (isToday) {
                           rowClass = 'bg-emerald-50/90 hover:bg-emerald-100 text-emerald-950 font-semibold ring-2 ring-emerald-500/50 print:bg-white print:text-black';
                       } else if (isFriday || isHoliday) {
                           rowClass = 'bg-red-50 hover:bg-red-100 text-red-900 print:bg-gray-200 print:text-black';
                       } else if (isThursday) {
                           rowClass = 'bg-[#f3e8ff] hover:bg-purple-100 text-purple-900 print:bg-white print:text-black';
                       }

                       return (
                         <tr 
                           key={entry.id} 
                           id={isToday ? "shift-today-row" : `shift-row-${entry.date.replace(/\//g, '-')}`}
                           className={`${rowClass} ${isToday ? 'scroll-mt-32' : ''}`}
                         >
                           <td className={`p-4 print:p-0.5 border border-slate-200 print:border-black font-bold ${isToday ? 'text-emerald-800 font-black' : isFriday || isHoliday ? 'text-red-600 print:text-black' : ''}`}>
                              <div className="flex flex-col items-center justify-center">
                                  <span>{entry.dayName}</span>
                              </div>
                           </td>
                           {(() => {
                             const dateTasks = (showProcessSchedule && dailyProcesses && dailyProcesses[entry.date]) || [];
                             return (
                               <td 
                                 onClick={() => {
                                   if (showProcessSchedule) {
                                     setSelectedProcessDate({ date: entry.date, dayName: entry.dayName });
                                     setIsProcessModalOpen(true);
                                   }
                                 }}
                                 className={`p-2 sm:p-3 print:p-0.5 border border-slate-200 print:border-black text-slate-700 print:text-black font-bold text-center ${
                                   showProcessSchedule ? 'cursor-pointer hover:bg-emerald-50/70 transition-colors group/date' : ''
                                 }`}
                                 title={showProcessSchedule ? "برای مشاهده و مدیریت فرآیندهای تولید، بیوراکتورها و تسک‌های این روز کلیک کنید" : undefined}
                               >
                                 <div className="flex flex-col items-center justify-center gap-1">
                                   <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                     <span className={`${showProcessSchedule ? 'group-hover/date:text-emerald-700 transition' : ''} font-black text-sm`}>{toPersianDigits(entry.date)}</span>
                                     {isToday && (
                                       <span className="text-[10px] bg-emerald-600 text-white font-black px-2 py-0.5 rounded-full shadow-xs print:hidden">
                                         امروز
                                       </span>
                                     )}
                                   </div>

                                   {/* Daily Process Badges */}
                                   {showProcessSchedule && (
                                     dateTasks.length > 0 ? (
                                       <div className="flex flex-col items-center gap-0.5 mt-0.5 w-full">
                                         <span 
                                           className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-100/90 text-emerald-950 border border-emerald-300 flex items-center gap-1 max-w-[170px] truncate shadow-2xs hover:bg-emerald-200 transition"
                                           title={dateTasks[0].title}
                                         >
                                           <FlaskConical size={11} className="shrink-0 text-emerald-700" />
                                           <span className="truncate">{dateTasks[0].title}</span>
                                         </span>
                                         {dateTasks.length > 1 && (
                                           <span className="text-[9px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.2 rounded-full transition">
                                             +{toPersianDigits(dateTasks.length - 1)} پروسه دیگر
                                           </span>
                                         )}
                                       </div>
                                     ) : isOwner ? (
                                       <div className="mt-0.5 opacity-0 group-hover/date:opacity-100 transition print:hidden">
                                         <span className="text-[9.5px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 rounded-md border border-emerald-200 transition flex items-center gap-0.5">
                                           <span>+ ثبت پروسه</span>
                                         </span>
                                       </div>
                                     ) : null
                                   )}
                                 </div>
                               </td>
                             );
                           })()}
                           <td className="p-2 print:p-0.5 border border-slate-200 print:border-black">
                              <div className="print:hidden">
                                <div className="flex items-center justify-between gap-1 group/day">
                                  <div className="flex-1 min-w-0">
                                    <ShiftUserCard 
                                        name={entry.dayShiftPerson} 
                                        type="Day" 
                                        originalName={entry.originalDayShiftPerson}
                                    />
                                  </div>
                                  {isOwner && (
                                    <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover/day:opacity-100 transition">
                                      <button
                                        type="button"
                                        onClick={() => setQuickEditShift({
                                          id: entry.id,
                                          date: entry.date,
                                          dayName: entry.dayName,
                                          field: 'dayShiftPerson',
                                          currentPerson: entry.dayShiftPerson
                                        })}
                                        className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100/80 rounded-md transition cursor-pointer"
                                        title="تغییر پرسنل شیفت روز"
                                      >
                                        <Edit size={13} />
                                      </button>
                                      {(!entry.extraDayPersons || entry.extraDayPersons.length === 0) && (
                                        <button
                                          type="button"
                                          onClick={() => setQuickEditShift({
                                            id: entry.id,
                                            date: entry.date,
                                            dayName: entry.dayName,
                                            field: 'extraDayPerson',
                                            currentPerson: '',
                                            extraIndex: 0,
                                            actionType: 'add'
                                          })}
                                          className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100/80 rounded-md transition cursor-pointer"
                                          title="افزودن پرسنل کمکی به شیفت روز"
                                        >
                                          <UserPlus size={13} />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {entry.extraDayPersons && entry.extraDayPersons.length > 0 && (
                                  <div className={`mt-1 pt-1 border-t border-orange-100/90 ${
                                    entry.extraDayPersons.length === 2 
                                      ? 'grid grid-cols-2 gap-1' 
                                      : 'flex items-center justify-between gap-1'
                                  }`}>
                                    {entry.extraDayPersons.map((extraPerson, extraIdx) => {
                                      const isTwo = entry.extraDayPersons!.length === 2;
                                      const nameLen = extraPerson.length;
                                      const fontClass = isTwo
                                        ? (nameLen > 13 ? 'text-[7.5px] leading-tight' : nameLen > 9 ? 'text-[8px] sm:text-[8.5px]' : 'text-[8.5px] sm:text-[9px]')
                                        : (nameLen > 14 ? 'text-[9px]' : 'text-[10px] sm:text-[10.5px]');

                                      return (
                                        <div 
                                          key={extraIdx} 
                                          className={`flex items-center justify-between gap-0.5 bg-orange-50/80 hover:bg-orange-100/80 border border-orange-200/90 rounded px-1 py-0.5 min-w-0 shadow-2xs group/extra transition ${isTwo ? 'w-full' : 'flex-1'}`}
                                        >
                                          <div className="flex items-center gap-1 min-w-0 flex-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                                            {!isTwo && (
                                              <span className="text-[8.5px] font-black text-orange-800 shrink-0">کمکی:</span>
                                            )}
                                            <span 
                                              className={`font-bold text-slate-800 truncate ${fontClass}`} 
                                              title={extraPerson}
                                            >
                                              {extraPerson}
                                            </span>
                                          </div>
                                          {isOwner && (
                                            <button
                                              type="button"
                                              onClick={() => setQuickEditShift({
                                                id: entry.id,
                                                date: entry.date,
                                                dayName: entry.dayName,
                                                field: 'extraDayPerson',
                                                currentPerson: extraPerson,
                                                extraIndex: extraIdx,
                                                actionType: 'change'
                                              })}
                                              className="p-0.5 text-slate-400 hover:text-amber-800 hover:bg-amber-200/70 rounded transition cursor-pointer shrink-0 opacity-75 group-hover/extra:opacity-100"
                                              title={`تغییر پرسنل کمکی (${extraIdx === 0 ? 'نفر دوم' : 'نفر سوم'})`}
                                            >
                                              <Edit size={10} />
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {isOwner && entry.extraDayPersons.length === 1 && (
                                      <button
                                        type="button"
                                        onClick={() => setQuickEditShift({
                                          id: entry.id,
                                          date: entry.date,
                                          dayName: entry.dayName,
                                          field: 'extraDayPerson',
                                          currentPerson: '',
                                          extraIndex: 1,
                                          actionType: 'add'
                                        })}
                                        className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100/80 rounded transition cursor-pointer shrink-0"
                                        title="افزودن همکار کمکی دوم (نفر سوم شیفت)"
                                      >
                                        <UserPlus size={11} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="hidden print:block font-bold">
                                <div>{entry.dayShiftPerson}</div>
                                {entry.extraDayPersons && entry.extraDayPersons.map((extraPerson, extraIdx) => (
                                  <div key={extraIdx} className="text-[7.5pt] font-semibold text-slate-800">
                                    + {extraPerson}
                                  </div>
                                ))}
                              </div>
                           </td>
                           <td className="p-2 print:p-0.5 border border-slate-200 print:border-black">
                              <div className="print:hidden">
                                <div className="flex items-center justify-between gap-1 group/night">
                                  <div className="flex-1 min-w-0">
                                    <ShiftUserCard 
                                        name={entry.nightShiftPerson} 
                                        type="Night" 
                                        originalName={entry.originalNightShiftPerson}
                                    />
                                  </div>
                                  {isOwner && (
                                    <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover/night:opacity-100 transition">
                                      <button
                                        type="button"
                                        onClick={() => setQuickEditShift({
                                          id: entry.id,
                                          date: entry.date,
                                          dayName: entry.dayName,
                                          field: 'nightShiftPerson',
                                          currentPerson: entry.nightShiftPerson
                                        })}
                                        className="p-1 text-slate-400 hover:text-indigo-700 hover:bg-indigo-100/80 rounded-md transition cursor-pointer"
                                        title="تغییر پرسنل شیفت شب"
                                      >
                                        <Edit size={13} />
                                      </button>
                                      {(!entry.extraNightPersons || entry.extraNightPersons.length === 0) && (
                                        <button
                                          type="button"
                                          onClick={() => setQuickEditShift({
                                            id: entry.id,
                                            date: entry.date,
                                            dayName: entry.dayName,
                                            field: 'extraNightPerson',
                                            currentPerson: '',
                                            extraIndex: 0,
                                            actionType: 'add'
                                          })}
                                          className="p-1 text-slate-400 hover:text-indigo-700 hover:bg-indigo-100/80 rounded-md transition cursor-pointer"
                                          title="افزودن پرسنل کمکی به شیفت شب"
                                        >
                                          <UserPlus size={13} />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {entry.extraNightPersons && entry.extraNightPersons.length > 0 && (
                                  <div className={`mt-1 pt-1 border-t border-indigo-100/90 ${
                                    entry.extraNightPersons.length === 2 
                                      ? 'grid grid-cols-2 gap-1' 
                                      : 'flex items-center justify-between gap-1'
                                  }`}>
                                    {entry.extraNightPersons.map((extraPerson, extraIdx) => {
                                      const isTwo = entry.extraNightPersons!.length === 2;
                                      const nameLen = extraPerson.length;
                                      const fontClass = isTwo
                                        ? (nameLen > 13 ? 'text-[7.5px] leading-tight' : nameLen > 9 ? 'text-[8px] sm:text-[8.5px]' : 'text-[8.5px] sm:text-[9px]')
                                        : (nameLen > 14 ? 'text-[9px]' : 'text-[10px] sm:text-[10.5px]');

                                      return (
                                        <div 
                                          key={extraIdx} 
                                          className={`flex items-center justify-between gap-0.5 bg-indigo-50/80 hover:bg-indigo-100/80 border border-indigo-200/90 rounded px-1 py-0.5 min-w-0 shadow-2xs group/nextra transition ${isTwo ? 'w-full' : 'flex-1'}`}
                                        >
                                          <div className="flex items-center gap-1 min-w-0 flex-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                                            {!isTwo && (
                                              <span className="text-[8.5px] font-black text-indigo-900 shrink-0">کمکی:</span>
                                            )}
                                            <span 
                                              className={`font-bold text-slate-800 truncate ${fontClass}`} 
                                              title={extraPerson}
                                            >
                                              {extraPerson}
                                            </span>
                                          </div>
                                          {isOwner && (
                                            <button
                                              type="button"
                                              onClick={() => setQuickEditShift({
                                                id: entry.id,
                                                date: entry.date,
                                                dayName: entry.dayName,
                                                field: 'extraNightPerson',
                                                currentPerson: extraPerson,
                                                extraIndex: extraIdx,
                                                actionType: 'change'
                                              })}
                                              className="p-0.5 text-slate-400 hover:text-indigo-800 hover:bg-indigo-200/70 rounded transition cursor-pointer shrink-0 opacity-75 group-hover/nextra:opacity-100"
                                              title={`تغییر پرسنل کمکی (${extraIdx === 0 ? 'نفر دوم' : 'نفر سوم'})`}
                                            >
                                              <Edit size={10} />
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {isOwner && entry.extraNightPersons.length === 1 && (
                                      <button
                                        type="button"
                                        onClick={() => setQuickEditShift({
                                          id: entry.id,
                                          date: entry.date,
                                          dayName: entry.dayName,
                                          field: 'extraNightPerson',
                                          currentPerson: '',
                                          extraIndex: 1,
                                          actionType: 'add'
                                        })}
                                        className="p-1 text-slate-400 hover:text-indigo-700 hover:bg-indigo-100/80 rounded transition cursor-pointer shrink-0"
                                        title="افزودن همکار کمکی دوم (نفر سوم شیفت)"
                                      >
                                        <UserPlus size={11} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="hidden print:block font-bold">
                                <div>{entry.nightShiftPerson}</div>
                                {entry.extraNightPersons && entry.extraNightPersons.map((extraPerson, extraIdx) => (
                                  <div key={extraIdx} className="text-[7.5pt] font-semibold text-slate-800">
                                    + {extraPerson}
                                  </div>
                                ))}
                              </div>
                           </td>
                           <td className="p-2 print:p-0.5 border border-slate-200 print:border-black">
                              <div className="print:hidden">
                                <div className="flex items-center justify-between gap-1 group/super">
                                  <div className="flex-1 min-w-0">
                                    <ShiftUserCard name={entry.onCallPerson} type="Supervisor" />
                                  </div>
                                  {isOwner && (
                                    <button
                                      type="button"
                                      onClick={() => setQuickEditShift({
                                        id: entry.id,
                                        date: entry.date,
                                        dayName: entry.dayName,
                                        field: 'onCallPerson',
                                        currentPerson: entry.onCallPerson
                                      })}
                                      className="p-1 text-slate-400 hover:text-emerald-700 hover:bg-emerald-100/80 rounded-md transition cursor-pointer shrink-0 opacity-70 group-hover/super:opacity-100"
                                      title="تغییر سرپرست کشیک"
                                    >
                                      <Edit size={13} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <span className="hidden print:block font-bold">{entry.onCallPerson}</span>
                           </td>
                         </tr>
                       );
                     })}
                     {filteredSchedule.length === 0 && (
                       <tr>
                         <td colSpan={5} className="p-8 text-center text-slate-500 bg-slate-50/50">
                            <div className="flex flex-col items-center justify-center gap-2">
                               <CalendarRange size={32} className="text-slate-300" />
                               <p className="font-bold text-sm text-slate-600">در بازه زمانی انتخاب شده رکوردی یافت نشد</p>
                               <button 
                                  onClick={handleClearFilter}
                                  className="mt-1 text-xs font-bold text-blue-600 hover:text-blue-800 underline"
                                >
                                  بازگشت به نمایش کل ماه
                               </button>
                            </div>
                         </td>
                       </tr>
                     )}
                   </tbody>
                 </table>
               </div>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 print:hidden">
              {filteredSchedule.length === 0 && (
                 <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                    <CalendarRange size={32} className="text-slate-300 mx-auto mb-2" />
                    <p className="font-bold text-sm text-slate-700">
                       {filterPerson !== "All"
                         ? `برای پرسنل «${filterPerson}» با فیلتر شیفت انتخابی رکوردی یافت نشد`
                         : "در بازه زمانی انتخاب شده رکوردی یافت نشد"}
                    </p>
                    <button 
                       onClick={() => {
                         setFilterPerson('All');
                         setFilterShiftType('ALL');
                         handleClearFilter();
                       }}
                       className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                    >
                       نمایش کامل برنامه (حذف فیلترها)
                    </button>
                 </div>
              )}

              {filteredSchedule.map(entry => {
                 const isToday = entry.date === todayPersianDate;
                 const isFriday = entry.dayName === 'جمعه';
                 const isHoliday = entry.isHoliday;
                 const isThursday = entry.dayName === 'پنج‌شنبه';
                 
                 let cardBg = 'bg-white';
                 let borderColor = 'border-slate-200/90';
                 if (isToday) {
                     cardBg = 'bg-emerald-50/75';
                     borderColor = 'border-emerald-500 ring-1 ring-emerald-400';
                 } else if (isFriday || isHoliday) {
                     cardBg = 'bg-red-50/85';
                     borderColor = 'border-red-200';
                 } else if (isThursday) {
                     cardBg = 'bg-[#f5eeff]';
                     borderColor = 'border-purple-200';
                 }

                 const dateTasks = (showProcessSchedule && dailyProcesses && dailyProcesses[entry.date]) || [];
                 const isPersonMatchedDay =
                   filterPerson !== 'All' &&
                   isPersonInShiftSlot(filterPerson, entry.dayShiftPerson, entry.extraDayPersons);
                 const isPersonMatchedNight =
                   filterPerson !== 'All' &&
                   isPersonInShiftSlot(filterPerson, entry.nightShiftPerson, entry.extraNightPersons);

                 const dayTileTone =
                   filterShiftType === 'NIGHT'
                     ? 'bg-orange-50/45 border-orange-200/60 opacity-60'
                     : filterShiftType === 'DAY' || isPersonMatchedDay
                       ? 'bg-white border-amber-400 ring-2 ring-amber-400/50 shadow-2xs'
                       : 'bg-orange-50/85 border-orange-200/85';

                 const nightTileTone =
                   filterShiftType === 'DAY'
                     ? 'bg-indigo-50/45 border-indigo-200/60 opacity-60'
                     : filterShiftType === 'NIGHT' || isPersonMatchedNight
                       ? 'bg-white border-indigo-400 ring-2 ring-indigo-500/45 shadow-2xs'
                       : 'bg-indigo-50/85 border-indigo-200/85';

                 return (
                  <div 
                    key={entry.id} 
                    id={isToday ? "shift-today-card" : `shift-card-${entry.date.replace(/\//g, '-')}`}
                    className={`${cardBg} rounded-2xl shadow-xs border ${borderColor} p-3 ${isToday ? 'scroll-mt-28' : ''}`}
                  >
                    {/* Top Row: Day, Date, Today/Holiday & Process Badge */}
                    <div 
                      onClick={() => {
                        if (showProcessSchedule) {
                          setSelectedProcessDate({ date: entry.date, dayName: entry.dayName });
                          setIsProcessModalOpen(true);
                        }
                      }}
                      className={`flex flex-col gap-1.5 mb-2.5 pb-2 border-b border-slate-200/70 ${
                        showProcessSchedule ? 'cursor-pointer hover:bg-white/60 rounded-lg p-1 -m-1 mb-2 transition' : ''
                      }`}
                      title={showProcessSchedule ? "برای مشاهده و مدیریت فرآیندهای تولید این روز کلیک کنید" : undefined}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`font-black text-sm ${isToday ? 'text-emerald-800' : isFriday || isHoliday ? 'text-red-600' : 'text-slate-800'}`}>
                            {entry.dayName}
                          </span>
                          <span className="text-xs text-slate-500 font-bold tabular-nums">
                            {toPersianDigits(entry.date)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isToday && (
                            <span className="text-[10px] bg-emerald-600 text-white font-black px-2 py-0.5 rounded-full shadow-2xs">
                              امروز
                            </span>
                          )}
                          {entry.isHoliday && (
                            <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold border border-red-200/80">
                              تعطیل
                            </span>
                          )}
                        </div>
                      </div>

                      {showProcessSchedule && dateTasks.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-emerald-900 bg-emerald-100/90 border border-emerald-300 px-2 py-1 rounded-lg truncate">
                          <FlaskConical size={12} className="shrink-0 text-emerald-700" />
                          <span className="truncate">{dateTasks[0].title}</span>
                          {dateTasks.length > 1 && (
                            <span className="text-[9.5px] bg-emerald-200 text-emerald-950 px-1.5 py-0.2 rounded-full font-black mr-auto">
                              +{toPersianDigits(dateTasks.length - 1)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Side-by-Side 2-Column Shift Grid (Day | Night) */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* Day Shift Column */}
                      <div className={`${dayTileTone} border rounded-xl p-2.5 flex flex-col justify-between transition-all`}>
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <div className="flex items-center gap-1 min-w-0">
                              <Sun size={13} className="text-amber-500 shrink-0" />
                              <span className="text-[11px] font-black text-amber-800 truncate">روز</span>
                              <span className="text-[9.5px] font-bold text-amber-700/75 tabular-nums hidden xs:inline">۰۸–۱۹</span>
                            </div>
                            {isOwner && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setQuickEditShift({
                                    id: entry.id,
                                    date: entry.date,
                                    dayName: entry.dayName,
                                    field: 'dayShiftPerson',
                                    currentPerson: entry.dayShiftPerson
                                  })}
                                  className="min-h-[36px] min-w-[32px] -my-1.5 flex items-center justify-center text-slate-400 hover:text-amber-700 hover:bg-amber-100 rounded-lg transition cursor-pointer"
                                  title="تغییر پرسنل شیفت روز"
                                >
                                  <Edit size={13} />
                                </button>
                                {(!entry.extraDayPersons || entry.extraDayPersons.length === 0) && (
                                  <button
                                    type="button"
                                    onClick={() => setQuickEditShift({
                                      id: entry.id,
                                      date: entry.date,
                                      dayName: entry.dayName,
                                      field: 'extraDayPerson',
                                      currentPerson: '',
                                      extraIndex: 0,
                                      actionType: 'add'
                                    })}
                                    className="min-h-[36px] min-w-[32px] -my-1.5 flex items-center justify-center text-slate-400 hover:text-amber-700 hover:bg-amber-100 rounded-lg transition cursor-pointer"
                                    title="افزودن پرسنل کمکی"
                                  >
                                    <UserPlus size={13} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="font-black text-slate-900 text-[13px] leading-snug break-words">
                            {entry.dayShiftPerson}
                          </div>
                          {entry.originalDayShiftPerson && entry.originalDayShiftPerson !== entry.dayShiftPerson && (
                            <div className="text-[10px] text-red-500 line-through decoration-red-300 mt-0.5">
                              {entry.originalDayShiftPerson}
                            </div>
                          )}
                        </div>

                        {entry.extraDayPersons && entry.extraDayPersons.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-orange-200/70 space-y-1">
                            {entry.extraDayPersons.map((extraPerson, extraIdx) => (
                              <div key={extraIdx} className="flex items-center justify-between gap-1 bg-white/95 border border-orange-200/90 px-1.5 py-0.5 rounded-lg shadow-2xs">
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                                  <span className="text-[10px] font-bold text-slate-800 truncate">{extraPerson}</span>
                                </div>
                                {isOwner && (
                                  <button
                                    type="button"
                                    onClick={() => setQuickEditShift({
                                      id: entry.id,
                                      date: entry.date,
                                      dayName: entry.dayName,
                                      field: 'extraDayPerson',
                                      currentPerson: extraPerson,
                                      extraIndex: extraIdx,
                                      actionType: 'change'
                                    })}
                                    className="p-0.5 text-slate-400 hover:text-amber-800 hover:bg-amber-100 rounded transition cursor-pointer shrink-0"
                                    title="تغییر پرسنل کمکی"
                                  >
                                    <Edit size={11} />
                                  </button>
                                )}
                              </div>
                            ))}
                            {isOwner && entry.extraDayPersons.length === 1 && (
                              <button
                                type="button"
                                onClick={() => setQuickEditShift({
                                  id: entry.id,
                                  date: entry.date,
                                  dayName: entry.dayName,
                                  field: 'extraDayPerson',
                                  currentPerson: '',
                                  extraIndex: 1,
                                  actionType: 'add'
                                })}
                                className="w-full py-0.5 flex items-center justify-center gap-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100/80 border border-dashed border-amber-300 rounded-lg transition cursor-pointer"
                                title="افزودن کمکی دوم"
                              >
                                <UserPlus size={11} />
                                <span>کمکی دوم</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Night Shift Column */}
                      <div className={`${nightTileTone} border rounded-xl p-2.5 flex flex-col justify-between transition-all`}>
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <div className="flex items-center gap-1 min-w-0">
                              <Moon size={13} className="text-indigo-600 shrink-0" />
                              <span className="text-[11px] font-black text-indigo-800 truncate">شب</span>
                              <span className="text-[9.5px] font-bold text-indigo-700/75 tabular-nums hidden xs:inline">۱۹–۰۸</span>
                            </div>
                            {isOwner && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setQuickEditShift({
                                    id: entry.id,
                                    date: entry.date,
                                    dayName: entry.dayName,
                                    field: 'nightShiftPerson',
                                    currentPerson: entry.nightShiftPerson
                                  })}
                                  className="min-h-[36px] min-w-[32px] -my-1.5 flex items-center justify-center text-slate-400 hover:text-indigo-700 hover:bg-indigo-100 rounded-lg transition cursor-pointer"
                                  title="تغییر پرسنل شیفت شب"
                                >
                                  <Edit size={13} />
                                </button>
                                {(!entry.extraNightPersons || entry.extraNightPersons.length === 0) && (
                                  <button
                                    type="button"
                                    onClick={() => setQuickEditShift({
                                      id: entry.id,
                                      date: entry.date,
                                      dayName: entry.dayName,
                                      field: 'extraNightPerson',
                                      currentPerson: '',
                                      extraIndex: 0,
                                      actionType: 'add'
                                    })}
                                    className="min-h-[36px] min-w-[32px] -my-1.5 flex items-center justify-center text-slate-400 hover:text-indigo-700 hover:bg-indigo-100 rounded-lg transition cursor-pointer"
                                    title="افزودن پرسنل کمکی"
                                  >
                                    <UserPlus size={13} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="font-black text-slate-900 text-[13px] leading-snug break-words">
                            {entry.nightShiftPerson}
                          </div>
                          {entry.originalNightShiftPerson && entry.originalNightShiftPerson !== entry.nightShiftPerson && (
                            <div className="text-[10px] text-red-500 line-through decoration-red-300 mt-0.5">
                              {entry.originalNightShiftPerson}
                            </div>
                          )}
                        </div>

                        {entry.extraNightPersons && entry.extraNightPersons.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-indigo-200/70 space-y-1">
                            {entry.extraNightPersons.map((extraPerson, extraIdx) => (
                              <div key={extraIdx} className="flex items-center justify-between gap-1 bg-white/95 border border-indigo-200/90 px-1.5 py-0.5 rounded-lg shadow-2xs">
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                                  <span className="text-[10px] font-bold text-slate-800 truncate">{extraPerson}</span>
                                </div>
                                {isOwner && (
                                  <button
                                    type="button"
                                    onClick={() => setQuickEditShift({
                                      id: entry.id,
                                      date: entry.date,
                                      dayName: entry.dayName,
                                      field: 'extraNightPerson',
                                      currentPerson: extraPerson,
                                      extraIndex: extraIdx,
                                      actionType: 'change'
                                    })}
                                    className="p-0.5 text-slate-400 hover:text-indigo-800 hover:bg-indigo-100 rounded transition cursor-pointer shrink-0"
                                    title="تغییر پرسنل کمکی"
                                  >
                                    <Edit size={11} />
                                  </button>
                                )}
                              </div>
                            ))}
                            {isOwner && entry.extraNightPersons.length === 1 && (
                              <button
                                type="button"
                                onClick={() => setQuickEditShift({
                                  id: entry.id,
                                  date: entry.date,
                                  dayName: entry.dayName,
                                  field: 'extraNightPerson',
                                  currentPerson: '',
                                  extraIndex: 1,
                                  actionType: 'add'
                                })}
                                className="w-full py-0.5 flex items-center justify-center gap-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100/80 border border-dashed border-indigo-300 rounded-lg transition cursor-pointer"
                                title="افزودن کمکی دوم"
                              >
                                <UserPlus size={11} />
                                <span>کمکی دوم</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Compact Supervisor Strip */}
                    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-200/60">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                        <span className="text-[11px] font-bold text-slate-500 shrink-0">سرپرست:</span>
                        <span className="font-bold text-slate-800 text-xs truncate">{entry.onCallPerson}</span>
                      </div>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => setQuickEditShift({
                            id: entry.id,
                            date: entry.date,
                            dayName: entry.dayName,
                            field: 'onCallPerson',
                            currentPerson: entry.onCallPerson
                          })}
                          className="min-h-[40px] min-w-[40px] -my-2 -ml-1.5 flex items-center justify-center text-slate-400 hover:text-emerald-700 hover:bg-emerald-100 rounded-lg transition cursor-pointer shrink-0"
                          title="تغییر سرپرست کشیک"
                        >
                          <Edit size={13} />
                        </button>
                      )}
                    </div>
                  </div>
              );})}
            </div>
        </div>

        {/* Right: Stats & Charts */}
        <div className="space-y-4 print:hidden">
           
           {/* Chart Section */}
           <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
               <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <Scale size={16} className="text-indigo-600 shrink-0" />
                    <h3 className="font-black text-slate-800 text-sm lg:text-base">نمودار توزیع عدالت و کارکرد</h3>
                  </div>

                  {/* Metric Switcher Pill */}
                  <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setChartMetricMode('raw')}
                      className={`px-2 py-1 rounded-md transition cursor-pointer ${
                        chartMetricMode === 'raw'
                          ? 'bg-white text-slate-900 shadow-2xs font-black'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      ساعت خام
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMetricMode('weighted')}
                      className={`px-2 py-1 rounded-md transition cursor-pointer ${
                        chartMetricMode === 'weighted'
                          ? 'bg-white text-indigo-700 shadow-2xs font-black'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      ساعت وزنی
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMetricMode('shifts')}
                      className={`px-2 py-1 rounded-md transition cursor-pointer ${
                        chartMetricMode === 'shifts'
                          ? 'bg-white text-emerald-700 shadow-2xs font-black'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      تعداد شیفت
                    </button>
                  </div>
               </div>

               <div className="flex flex-col items-center w-full">
                  {/* Donut Chart Container with Center Info */}
                  <div className="h-64 sm:h-72 w-full relative flex items-center justify-center">
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         <Pie
                           data={chartData as any}
                           cx="50%"
                           cy="50%"
                           innerRadius="62%"
                           outerRadius="84%"
                           paddingAngle={3}
                           dataKey="activeChartValue"
                           nameKey="name"
                           shape={renderCustomSector}
                           onClick={onPieClick}
                           onMouseEnter={onPieClick}
                         >
                           {chartData.map((entry, index) => (
                             <Cell 
                                 key={`cell-${index}`} 
                                 fill={GET_PERSON_COLOR(entry.name, personnelList)} 
                                 style={{ outline: "none" }}
                             />
                           ))}
                         </Pie>
                       </PieChart>
                     </ResponsiveContainer>

                     {/* Center Display: Shows hovered person's name, active value, and exact Day/Night breakdown */}
                     {activePerson && (
                       <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none transition-all duration-200 px-4 text-center">
                         <span className="text-sm sm:text-base font-black text-slate-800 tracking-tight leading-tight">
                           {activePerson.name.replace("مهندس", "").trim()}
                         </span>
                         <div className="flex items-center gap-1 mt-1" dir="rtl">
                           <span className="text-sm sm:text-base font-black text-slate-900 tabular-nums">
                             {toPersianDigits(
                               Number.isInteger((activePerson as any).activeChartValue)
                                 ? (activePerson as any).activeChartValue
                                 : (activePerson as any).activeChartValue?.toFixed(1).replace('.', '٫')
                             )}
                           </span>
                           <span className="text-[11px] font-bold text-slate-500">
                             {chartMetricMode === 'weighted'
                               ? 'ساعت وزنی'
                               : chartMetricMode === 'shifts'
                                 ? 'شیفت کل'
                                 : 'ساعت کار'}
                           </span>
                         </div>
                         <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-slate-500 bg-slate-100/90 px-2 py-0.5 rounded-full">
                           <span className="text-amber-700">{toPersianDigits(activePerson.dayShifts)} روز</span>
                           <span>•</span>
                           <span className="text-indigo-700">{toPersianDigits(activePerson.nightShifts)} شب</span>
                         </div>
                       </div>
                     )}
                  </div>

                  {/* Personnel Name Grid (Legend) - 2 people per row with exact shift/hour numbers */}
                  <ul className="grid grid-cols-2 gap-2 mt-3.5 w-full px-1">
                     {chartData.map((entry, index) => {
                         const isActive = index === activeIndex;
                         const color = GET_PERSON_COLOR(entry.name, personnelList);
                         const isOdd = chartData.length % 2 !== 0;
                         const isLast = index === chartData.length - 1;
                         const isOddLast = isOdd && isLast;
                         const rawVal = (entry as any).activeChartValue;
                         const formattedVal = toPersianDigits(
                           Number.isInteger(rawVal) ? rawVal : rawVal?.toFixed(1).replace('.', '٫')
                         );
                         
                         return (
                            <li 
                                key={`legend-item-${index}`} 
                                className={`flex flex-col items-center justify-center px-2.5 py-2 rounded-xl cursor-pointer transition-all duration-200 select-none border ${
                                  isOddLast ? "col-span-2 justify-self-center w-full max-w-[200px] sm:max-w-[230px]" : ""
                                } ${
                                  isActive 
                                    ? "bg-white shadow-md ring-2 ring-offset-1 ring-slate-200" 
                                    : "bg-slate-50/90 hover:bg-white hover:shadow-xs border-slate-200 hover:border-slate-300"
                                }`}
                                style={{
                                    borderColor: isActive ? color : undefined,
                                    boxShadow: isActive ? `0 4px 14px ${color}30` : undefined,
                                }}
                                onClick={() => setActiveIndex(index)}
                                onMouseEnter={() => setActiveIndex(index)}
                            >
                                <div className="flex items-center justify-between w-full gap-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span 
                                      className={`w-2.5 h-2.5 rounded-full transition-transform duration-200 shrink-0 ring-1 ring-white ${isActive ? "scale-125 shadow-xs" : ""}`} 
                                      style={{ backgroundColor: color }}
                                    />
                                    <span 
                                        className={`text-xs truncate transition-colors duration-200 ${isActive ? "font-black" : "font-bold text-slate-700"}`}
                                        style={{ color: isActive ? color : undefined }}
                                    >
                                      {entry.name.replace("مهندس", "").trim()}
                                    </span>
                                  </div>
                                  <span className="text-[11px] font-black text-slate-800 tabular-nums shrink-0">
                                    {formattedVal}
                                    <span className="text-[9px] font-bold text-slate-400 mr-0.5">
                                      {chartMetricMode === 'shifts' ? 'نوبت' : 'h'}
                                    </span>
                                  </span>
                                </div>
                                <div className="flex items-center justify-between w-full text-[9px] font-bold text-slate-400 mt-1 pt-1 border-t border-slate-200/60">
                                  <span className="text-amber-700">{toPersianDigits(entry.dayShifts)} روز</span>
                                  <span>|</span>
                                  <span className="text-indigo-700">{toPersianDigits(entry.nightShifts)} شب</span>
                                  <span>|</span>
                                  <span className="text-slate-600">{toPersianDigits(entry.dayShifts + entry.nightShifts)} کل</span>
                                </div>
                            </li>
                         );
                     })}
                  </ul>
               </div>
           </div>

           {/* Compact Stats Grid (2x2 KPI Tiles) */}
           <div className="grid grid-cols-2 gap-2.5">
              <StatsCard 
                 type="compact"
                 title="تعداد کل شیفت"
                 value={toPersianDigits(totalShifts)}
                 icon={Activity}
                 colorClass="bg-blue-500"
              />
              <StatsCard 
                 type="compact"
                 title="مجموع ساعات"
                 value={toPersianDigits(totalHoursSum)}
                 icon={Clock}
                 colorClass="bg-emerald-500"
              />
              <StatsCard 
                 type="compact"
                 title="نفرات فعال"
                 value={toPersianDigits(shiftWorkers.length)}
                 icon={Users}
                 colorClass="bg-indigo-500"
              />
              <StatsCard 
                 type="compact"
                 title="بیشترین کارکرد"
                 value={topPerformer ? (topPerformer.isTie ? `${toPersianDigits(topPerformer.count)} نفر` : topPerformer.names[0]) : '---'}
                 subtitle={topPerformer ? (topPerformer.isTie ? `مشترک (${toPersianDigits(topPerformer.value)} ساعت)` : `${toPersianDigits(topPerformer.value)} ساعت`) : ''}
                 icon={Trophy}
                 colorClass="bg-amber-500"
              />
           </div>

        </div>
      </div>

      {/* --- FAIRNESS & WEIGHTED HOURS ANALYSIS (MANAGER ONLY) --- */}
      {isOwner && (
        <div id="fairness-analysis-section">
          <FairnessAnalysisCard 
            scheduleData={baseScheduleForView}
            shiftWorkers={shiftWorkers}
            personnelList={personnelList}
          />
        </div>
      )}

      {/* --- COMPACT DAILY PROCESSES TABLE (MANAGER ONLY) --- */}
      {showProcessSchedule && isOwner && (
      <div className="bg-white rounded-xl shadow-2xs border border-slate-200 overflow-hidden no-print">
        {/* Compact Header Ribbon */}
        <div className="px-3.5 py-2.5 border-b border-slate-200 bg-linear-to-r from-emerald-50/70 via-white to-slate-50 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-2xs shrink-0">
              <FlaskConical size={15} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-black text-slate-800">
                جدول فرآیندهای روزانه
              </h3>
              <span className="text-[11px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-200/80">
                {toPersianDigits(processTableEntries.length)} روز دارای پروسه
              </span>
            </div>
          </div>

          {/* Compact Quick Search */}
          {totalDaysWithProcesses > 0 && (
            <div className="relative w-40 sm:w-48">
              <input
                type="text"
                placeholder="جستجوی پروسه..."
                value={processSearchQuery}
                onChange={(e) => setProcessSearchQuery(e.target.value)}
                className="w-full text-xs font-bold pl-6 pr-2.5 py-1 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400 placeholder:font-normal"
              />
              {processSearchQuery ? (
                <button
                  type="button"
                  onClick={() => setProcessSearchQuery('')}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  title="پاک کردن"
                >
                  <X size={12} />
                </button>
              ) : (
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              )}
            </div>
          )}
        </div>

        {/* Table Content: Only Days With Processes */}
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-[11px]">
                <th className="py-2 px-3 w-20 sm:w-24 text-center border-l border-slate-200">
                  روز
                </th>
                <th className="py-2 px-3 w-28 sm:w-32 text-center border-l border-slate-200">
                  تاریخ
                </th>
                <th className="py-2 px-3 text-right">
                  عنوان پروسه
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {processTableEntries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-400 font-bold">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-xs">
                      <FlaskConical size={20} className="text-slate-300" />
                      <span>
                        {totalDaysWithProcesses === 0
                          ? 'هیچ فرآیندی برای روزهای این دوره ثبت نشده است.'
                          : 'هیچ پروسه‌ای مطابق با عبارت جستجو یافت نشد.'}
                      </span>
                      {processSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setProcessSearchQuery('')}
                          className="text-[11px] text-emerald-600 hover:underline font-bold"
                        >
                          پاک کردن جستجو
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                processTableEntries.map((entry) => {
                  const tasks = (dailyProcesses && dailyProcesses[entry.date]) || [];
                  const isToday = entry.date === todayPersianDate;
                  const isWeekend = entry.isFriday || entry.isHoliday;

                  return (
                    <tr
                      key={entry.id || entry.date}
                      onClick={() => {
                        setSelectedProcessDate({ date: entry.date, dayName: entry.dayName });
                        setIsProcessModalOpen(true);
                      }}
                      className={`group cursor-pointer transition-colors ${
                        isToday
                          ? 'bg-emerald-50/50 hover:bg-emerald-100/60'
                          : 'hover:bg-slate-50'
                      }`}
                      title="برای مشاهده و مدیریت جزئیات پروسه کلیک کنید"
                    >
                      {/* 1. Day of Week */}
                      <td className="py-1.5 px-3 text-center border-l border-slate-100 whitespace-nowrap">
                        <span
                          className={`font-black text-xs ${
                            isToday
                              ? 'text-emerald-700'
                              : isWeekend
                                ? 'text-red-600'
                                : 'text-slate-800'
                          }`}
                        >
                          {entry.dayName}
                        </span>
                      </td>

                      {/* 2. Date */}
                      <td className="py-1.5 px-3 text-center border-l border-slate-100 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <span
                            className={`font-bold text-xs ${
                              isToday ? 'font-black text-emerald-800' : 'text-slate-700'
                            }`}
                          >
                            {toPersianDigits(entry.date)}
                          </span>
                          {isToday && (
                            <span className="text-[9px] bg-emerald-600 text-white font-black px-1.5 py-0.2 rounded-full shadow-2xs">
                              امروز
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Process Title */}
                      <td className="py-1.5 px-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {tasks.map((task, idx) => (
                              <div
                                key={task.id || idx}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold bg-white text-slate-800 border border-slate-200 shadow-2xs group-hover:border-emerald-300 transition-colors"
                                style={{
                                  borderRightWidth: '3px',
                                  borderRightColor: task.color || '#10b981',
                                }}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: task.color || '#10b981' }}
                                />
                                <span className="font-extrabold text-slate-900">
                                  {task.title}
                                </span>
                                {task.vessel && (
                                  <span className="text-[10px] text-slate-500 bg-slate-100 px-1 py-0.2 rounded font-mono dir-ltr">
                                    {task.vessel}
                                  </span>
                                )}
                                {task.phase && (
                                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded">
                                    {task.phase}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>

                          <ChevronLeft size={14} className="text-slate-300 group-hover:text-emerald-600 group-hover:-translate-x-0.5 transition-all shrink-0 ms-auto" />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Quick Edit Shift Personnel Modal (Admin / Manager Mode) */}
      {quickEditShift && (
        <div 
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150 print:hidden"
          onClick={() => setQuickEditShift(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-xs ${
                  quickEditShift.field === 'dayShiftPerson' || quickEditShift.field === 'extraDayPerson'
                    ? 'bg-amber-500 text-white'
                    : quickEditShift.field === 'nightShiftPerson' || quickEditShift.field === 'extraNightPerson'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-emerald-600 text-white'
                }`}>
                  {quickEditShift.field === 'dayShiftPerson' || quickEditShift.field === 'extraDayPerson' ? <Sun size={18} /> : quickEditShift.field === 'nightShiftPerson' || quickEditShift.field === 'extraNightPerson' ? <Moon size={18} /> : <ShieldCheck size={18} />}
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-800">
                    {quickEditShift.field === 'extraDayPerson'
                      ? (quickEditShift.actionType === 'add' ? 'افزودن همکار کمکی به شیفت روز' : `تغییر پرسنل کمکی (${quickEditShift.extraIndex === 0 ? 'نفر دوم' : 'نفر سوم'} شیفت روز)`)
                      : quickEditShift.field === 'extraNightPerson'
                        ? (quickEditShift.actionType === 'add' ? 'افزودن همکار کمکی به شیفت شب' : `تغییر پرسنل کمکی (${quickEditShift.extraIndex === 0 ? 'نفر دوم' : 'نفر سوم'} شیفت شب)`)
                        : `تغییر پرسنل ${quickEditShift.field === 'dayShiftPerson' ? 'شیفت روز' : quickEditShift.field === 'nightShiftPerson' ? 'شیفت شب' : 'سرپرست کشیک'}`
                    }
                  </h3>
                  <p className="text-xs text-slate-500 font-bold">
                    {quickEditShift.dayName} - {toPersianDigits(quickEditShift.date)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuickEditShift(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Notice alert when saved */}
              {quickEditNotice && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  <span>{quickEditNotice}</span>
                </div>
              )}

              {(quickEditShift.field === 'nightShiftPerson' || quickEditShift.field === 'extraNightPerson') && (
                <div className="bg-indigo-50/80 border border-indigo-200/80 text-indigo-900 px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2">
                  <Sparkles size={15} className="text-indigo-600 shrink-0" />
                  <span>چرخش خودکار: با انتخاب این فرد برای شیفت شب، نام ایشان به صورت خودکار ۲ روز بعد در شیفت روز نیز ثبت می‌شود (قابل ویرایش دستی).</span>
                </div>
              )}

              {quickEditShift.currentPerson ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">
                    {quickEditShift.field.startsWith('extra') ? 'پرسنل کمکی فعلی:' : 'پرسنل فعلی:'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs">
                      {quickEditShift.currentPerson}
                    </span>
                    {quickEditShift.field.startsWith('extra') && (
                      <button
                        type="button"
                        onClick={handleQuickRemoveExtra}
                        className="flex items-center gap-1 text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg transition cursor-pointer"
                        title="حذف این پرسنل کمکی از شیفت"
                      >
                        <Trash2 size={13} />
                        <span>حذف کمکی</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  {quickEditShift.actionType === 'add' ? 'انتخاب همکار جهت افزودن به عنوان پرسنل کمکی:' : 'انتخاب همکار جدید جهت جایگزینی:'}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {getQuickEditCandidates().map((name) => {
                    const isCurrent = name === quickEditShift.currentPerson;
                    const personColor = GET_PERSON_COLOR(name, personnelList);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleQuickSelectPerson(name)}
                        className={`flex items-center justify-between p-2.5 rounded-xl border text-right transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-200 shadow-xs'
                            : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span 
                            className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10"
                            style={{ backgroundColor: personColor }}
                          />
                          <span className={`text-xs font-bold truncate ${isCurrent ? 'text-emerald-950 font-black' : 'text-slate-800'}`}>
                            {name}
                          </span>
                        </div>
                        {isCurrent && (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">
                            فعلی
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className="p-3 sm:p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button
                type="button"
                onClick={() => setQuickEditShift(null)}
                className="text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl transition cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily Bioprocess & Task Management Modal */}
      {showProcessSchedule && isProcessModalOpen && selectedProcessDate && (
        <DailyProcessModal
          isOpen={isProcessModalOpen}
          onClose={() => {
            setIsProcessModalOpen(false);
            setSelectedProcessDate(null);
          }}
          date={selectedProcessDate.date}
          dayName={selectedProcessDate.dayName}
          tasks={dailyProcesses[selectedProcessDate.date] || []}
          onSaveTasks={(newTasks) => {
            const updated = {
              ...dailyProcesses,
              [selectedProcessDate.date]: newTasks
            };
            onSaveDailyProcesses?.(updated);
          }}
          onScheduleNextPassage={(targetDate, newTask) => {
            const existing = dailyProcesses[targetDate] || [];
            const updated = {
              ...dailyProcesses,
              [targetDate]: [...existing, newTask]
            };
            onSaveDailyProcesses?.(updated);
          }}
          onScheduleRemainingTimeline={(timeline) => {
            const merged = { ...dailyProcesses };
            Object.entries(timeline).forEach(([d, ts]) => {
              merged[d] = [...(merged[d] || []), ...(ts as DailyProcessTask[])];
            });
            onSaveDailyProcesses?.(merged);
          }}
          onApplyCampaignFromDate={(startDate, options) => {
            const campaignTimeline = generateFullBioprocessCampaign(startDate, options);
            const merged = { ...dailyProcesses };
            Object.entries(campaignTimeline).forEach(([d, ts]) => {
              merged[d] = [...(merged[d] || []), ...ts];
            });
            onSaveDailyProcesses?.(merged);
          }}
          isOwner={isOwner}
          onOpenOwnerLogin={onOpenOwnerLogin}
          processDefinitions={processDefinitions}
          personnelList={personnelList}
        />
      )}
    </div>
  );
}

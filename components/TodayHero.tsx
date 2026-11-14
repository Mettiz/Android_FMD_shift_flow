
/**
 * Today Hero Component - v1.0.1
 */
import React, { useEffect, useState } from 'react';
import { ShiftEntry, DailyProcessTask } from '../types';
import { ShiftUserCard } from './ShiftUserCard';
import { Calendar, Clock, ArrowLeft, FlaskConical, ChevronLeft, Sun, Moon } from 'lucide-react';
import { 
  getTodayPersianDateStr, 
  getTodayGregorianDateStr,
  getTodayPersianTimeStr, 
  getTodayPersianWeekday, 
  toPersianDigits 
} from '../utils/persianDate';

const getCurrentShiftByTehranHour = (): 'DAY' | 'NIGHT' => {
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      hour12: false,
    }).format(new Date());
    const hour = Number.parseInt(hourStr, 10);
    if (!Number.isNaN(hour) && (hour >= 19 || hour < 8)) {
      return 'NIGHT';
    }
  } catch {
    // fallback to DAY
  }
  return 'DAY';
};

interface TodayHeroProps {
  schedule: ShiftEntry[];
  onNavigateToToday?: () => void;
  todayProcesses?: DailyProcessTask[];
  onOpenProcessModal?: (date: string) => void;
}

export const TodayHero: React.FC<TodayHeroProps> = ({ 
  schedule, 
  onNavigateToToday,
  todayProcesses = [],
  onOpenProcessModal 
}) => {
  const [currentDateStr, setCurrentDateStr] = useState<string>('');
  const [currentGregorianDateStr, setCurrentGregorianDateStr] = useState<string>('');
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');
  const [currentWeekdayStr, setCurrentWeekdayStr] = useState<string>('');
  const [todayEntry, setTodayEntry] = useState<ShiftEntry | undefined>(undefined);
  const [liveShiftNow, setLiveShiftNow] = useState<'DAY' | 'NIGHT'>(getCurrentShiftByTehranHour);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      
      // Get Persian Date & Time strictly in Asia/Tehran timezone
      const persianDate = getTodayPersianDateStr(now);
      setCurrentDateStr(persianDate);
      setCurrentGregorianDateStr(getTodayGregorianDateStr(now));
      setCurrentTimeStr(getTodayPersianTimeStr(now));
      setCurrentWeekdayStr(getTodayPersianWeekday(now));
      setLiveShiftNow(getCurrentShiftByTehranHour());

      const entry = schedule.find(s => s.date === persianDate);
      setTodayEntry(entry);
    };

    updateTime();
    const timer = setInterval(updateTime, 10000); 

    return () => clearInterval(timer);
  }, [schedule]);

  const dayShiftCards = todayEntry ? (
    <div className="flex flex-col gap-1.5 h-full justify-center">
      <ShiftUserCard 
        name={todayEntry.dayShiftPerson} 
        type="Day" 
        showIcon={true} 
        badgeLabel={todayEntry.extraDayPersons && todayEntry.extraDayPersons.length > 0 ? 'نفر اصلی' : undefined}
      />
      {todayEntry.extraDayPersons && todayEntry.extraDayPersons.map((extraPerson, extraIdx) => (
        <ShiftUserCard 
          key={`today-extra-day-${extraIdx}`}
          name={extraPerson} 
          type="Day" 
          size="sm"
          showIcon={true}
          badgeLabel={extraIdx === 0 ? 'نفر دوم' : 'نفر سوم'}
          className="border border-dashed border-orange-300 bg-orange-50/70"
        />
      ))}
    </div>
  ) : null;

  const nightShiftCards = todayEntry ? (
    <div className="flex flex-col gap-1.5 h-full justify-center">
      <ShiftUserCard 
        name={todayEntry.nightShiftPerson} 
        type="Night" 
        showIcon={true} 
        badgeLabel={todayEntry.extraNightPersons && todayEntry.extraNightPersons.length > 0 ? 'نفر اصلی' : undefined}
      />
      {todayEntry.extraNightPersons && todayEntry.extraNightPersons.map((extraPerson, extraIdx) => (
        <ShiftUserCard 
          key={`today-extra-night-${extraIdx}`}
          name={extraPerson} 
          type="Night" 
          size="sm"
          showIcon={true}
          badgeLabel={extraIdx === 0 ? 'نفر دوم' : 'نفر سوم'}
          className="border border-dashed border-slate-300 bg-slate-100/80"
        />
      ))}
    </div>
  ) : null;

  return (
    <div id="today-hero-section" className="bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden relative no-print scroll-mt-20 divide-y divide-slate-100">
      {/* Top Accent Line */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500"></div>
      
      {/* 1. Balanced Header Row: Live Status Title + Symmetrical 3-Column Day | Date | Clock Strip */}
      <div className="p-3.5 sm:p-4 pt-4 sm:pt-4.5 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
        {/* Right: Live Status Identity & Active Shift Badge */}
        <div className="flex items-center justify-between md:justify-start gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs relative">
              <Clock size={20} />
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse"></span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base md:text-lg font-black text-slate-900 tracking-tight leading-snug">
                  وضعیت زنده شیفت امروز
                </h2>
                <span className={`inline-flex items-center gap-1 text-[10.5px] sm:text-[11px] font-black px-2.5 py-0.5 rounded-full border whitespace-nowrap ${
                  liveShiftNow === 'DAY'
                    ? 'bg-amber-50 text-amber-800 border-amber-200/90'
                    : 'bg-indigo-50 text-indigo-800 border-indigo-200/90'
                }`}>
                  {liveShiftNow === 'DAY' ? <Sun size={12} className="text-amber-500 shrink-0" /> : <Moon size={12} className="text-indigo-600 shrink-0" />}
                  <span>{liveShiftNow === 'DAY' ? 'نوبت روز فعال' : 'نوبت شب فعال'}</span>
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                برنامه کشیک و پرسنل حاضر در شیفت جاری
              </p>
            </div>
          </div>
        </div>

        {/* Left: Balanced 3-Column Strip (Day | Date | Clock) on BOTH Mobile & Desktop */}
        <div className="grid grid-cols-3 gap-2 md:gap-4 w-full md:w-auto md:min-w-[440px] lg:min-w-[500px] bg-slate-50/90 border border-slate-200/90 rounded-xl px-2.5 py-2.5 md:px-4 md:py-3 text-center items-center shrink-0">
          {/* Col 1: Weekday */}
          <div className="flex flex-col items-center justify-center border-l border-slate-200/80 pl-2 md:pl-4 min-w-0 text-center">
            <span className="text-[10px] md:text-xs font-bold text-slate-400 mb-0.5 md:mb-1">روز هفته</span>
            <span className="text-sm sm:text-base md:text-xl lg:text-2xl font-black text-slate-800 truncate w-full text-center">
              {currentWeekdayStr || 'سه‌شنبه'}
            </span>
          </div>

          {/* Col 2: Persian & Gregorian Date (Strictly Centered & Equal Size on Mobile & Desktop) */}
          <div className="flex flex-col items-center justify-center border-l border-slate-200/80 px-1.5 md:px-3 min-w-0 text-center" dir="ltr">
            <span className="text-xs sm:text-sm md:text-base lg:text-lg font-black text-slate-800 tabular-nums tracking-tight text-center leading-tight w-full">
              {toPersianDigits(currentDateStr)}
            </span>
            <div className="w-10 md:w-16 h-px bg-slate-200/90 my-1"></div>
            <span className="text-xs sm:text-sm md:text-base lg:text-lg font-black text-slate-600 tabular-nums tracking-tight text-center leading-tight w-full">
              {currentGregorianDateStr}
            </span>
          </div>

          {/* Col 3: Live Clock */}
          <div className="flex flex-col items-center justify-center pr-1.5 md:pr-3 min-w-0 text-center">
            <span className="text-[10px] md:text-xs font-bold text-slate-400 mb-0.5 md:mb-1">ساعت</span>
            <span className="text-sm sm:text-base md:text-xl lg:text-2xl font-black text-slate-800 tabular-nums text-center w-full" dir="ltr">
              {toPersianDigits(currentTimeStr)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Balanced Shifts Section */}
      <div className="p-3.5 sm:p-4 bg-slate-50/35">
        <div className="w-full">
           {todayEntry ? (
             <>
               {/* Mobile Side-by-Side Compact View */}
               <div className="md:hidden space-y-2.5">
                 <div className="grid grid-cols-2 gap-2">
                   {/* Day Shift Tile */}
                   <div className={`rounded-xl p-2.5 border transition-colors ${
                     liveShiftNow === 'DAY'
                       ? 'bg-orange-50/90 border-orange-300 ring-1 ring-amber-400/50'
                       : 'bg-orange-50/60 border-orange-200/80'
                   }`}>
                     <div className="flex items-center justify-between gap-1 mb-1.5">
                       <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-800">
                         <Sun size={13} className="text-amber-500 shrink-0" />
                         <span>روز</span>
                       </span>
                       <span className="text-[10px] font-bold text-amber-700/80 tabular-nums">۰۸–۱۹</span>
                     </div>
                     <div className="font-black text-slate-900 text-xs sm:text-sm leading-snug break-words">
                       {todayEntry.dayShiftPerson}
                     </div>
                     {todayEntry.originalDayShiftPerson && todayEntry.originalDayShiftPerson !== todayEntry.dayShiftPerson && (
                       <div className="text-[10px] text-red-500 line-through decoration-red-300 mt-0.5">
                         {todayEntry.originalDayShiftPerson}
                       </div>
                     )}
                     {todayEntry.extraDayPersons && todayEntry.extraDayPersons.length > 0 && (
                       <div className="mt-1.5 pt-1.5 border-t border-orange-200/70 space-y-1">
                         {todayEntry.extraDayPersons.map((extraPerson, extraIdx) => (
                           <div key={`m-today-d-${extraIdx}`} className="text-[10px] font-bold text-orange-900 bg-white/90 border border-orange-200 rounded-md px-1.5 py-0.5 truncate">
                             + {extraPerson}
                           </div>
                         ))}
                       </div>
                     )}
                   </div>

                   {/* Night Shift Tile */}
                   <div className={`rounded-xl p-2.5 border transition-colors ${
                     liveShiftNow === 'NIGHT'
                       ? 'bg-indigo-50/95 border-indigo-300 ring-1 ring-indigo-400/50'
                       : 'bg-indigo-50/60 border-indigo-200/80'
                   }`}>
                     <div className="flex items-center justify-between gap-1 mb-1.5">
                       <span className="inline-flex items-center gap-1 text-[11px] font-black text-indigo-800">
                         <Moon size={13} className="text-indigo-600 shrink-0" />
                         <span>شب</span>
                       </span>
                       <span className="text-[10px] font-bold text-indigo-700/80 tabular-nums">۱۹–۰۸</span>
                     </div>
                     <div className="font-black text-slate-900 text-xs sm:text-sm leading-snug break-words">
                       {todayEntry.nightShiftPerson}
                     </div>
                     {todayEntry.originalNightShiftPerson && todayEntry.originalNightShiftPerson !== todayEntry.nightShiftPerson && (
                       <div className="text-[10px] text-red-500 line-through decoration-red-300 mt-0.5">
                         {todayEntry.originalNightShiftPerson}
                       </div>
                     )}
                     {todayEntry.extraNightPersons && todayEntry.extraNightPersons.length > 0 && (
                       <div className="mt-1.5 pt-1.5 border-t border-indigo-200/70 space-y-1">
                         {todayEntry.extraNightPersons.map((extraPerson, extraIdx) => (
                           <div key={`m-today-n-${extraIdx}`} className="text-[10px] font-bold text-indigo-900 bg-white/90 border border-indigo-200 rounded-md px-1.5 py-0.5 truncate">
                             + {extraPerson}
                           </div>
                         ))}
                       </div>
                     )}
                   </div>
                 </div>

                 {/* Compact Supervisor Strip on Mobile */}
                 <ShiftUserCard
                   name={todayEntry.onCallPerson}
                   type="Supervisor"
                   showIcon={true}
                   size="sm"
                   badgeLabel="سرپرست امروز"
                 />
               </div>

               {/* Desktop Symmetrical 3-Column Grid (Aligned with Table Columns: Day -> Night -> Supervisor) */}
               <div className="hidden md:grid md:grid-cols-3 gap-3.5 items-stretch">
                 {/* 1. Day Shift */}
                 <div className="flex flex-col gap-1.5 items-stretch bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                   <div className="flex items-center justify-between px-1">
                     <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-amber-800">
                       <Sun size={14} className="text-amber-500 shrink-0" />
                       <span>شیفت روز (۰۸ - ۱۹)</span>
                     </span>
                     {todayEntry.extraDayPersons && todayEntry.extraDayPersons.length > 0 ? (
                       <span className="text-[10px] font-black text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                         {toPersianDigits(todayEntry.extraDayPersons.length + 1)} نفره
                       </span>
                     ) : liveShiftNow === 'DAY' ? (
                       <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.2 rounded-full">
                         در حال انجام
                       </span>
                     ) : null}
                   </div>
                   <div className="flex-1 flex flex-col justify-center">
                     {dayShiftCards}
                   </div>
                 </div>

                 {/* 2. Night Shift */}
                 <div className="flex flex-col gap-1.5 items-stretch bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                   <div className="flex items-center justify-between px-1">
                     <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-indigo-800">
                       <Moon size={14} className="text-indigo-600 shrink-0" />
                       <span>شیفت شب (۱۹ - ۰۸)</span>
                     </span>
                     {todayEntry.extraNightPersons && todayEntry.extraNightPersons.length > 0 ? (
                       <span className="text-[10px] font-black text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                         {toPersianDigits(todayEntry.extraNightPersons.length + 1)} نفره
                       </span>
                     ) : liveShiftNow === 'NIGHT' ? (
                       <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.2 rounded-full">
                         در حال انجام
                       </span>
                     ) : null}
                   </div>
                   <div className="flex-1 flex flex-col justify-center">
                     {nightShiftCards}
                   </div>
                 </div>

                 {/* 3. Supervisor */}
                 <div className="flex flex-col gap-1.5 items-stretch bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                   <div className="flex items-center justify-between px-1">
                     <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-800">
                       <span>سرپرست کشیک (On-Call)</span>
                     </span>
                     <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.2 rounded-full">
                       ۲۴ ساعته
                     </span>
                   </div>
                   <div className="flex-1 flex flex-col justify-center">
                     <ShiftUserCard name={todayEntry.onCallPerson} type="Supervisor" showIcon={true} />
                   </div>
                 </div>
               </div>
             </>
           ) : (
             <div className="flex flex-col items-center justify-center text-center py-4 bg-white rounded-xl border border-dashed border-slate-200 h-full">
               <Calendar size={36} className="text-slate-300 mb-2" />
               <p className="text-slate-500 font-medium text-xs sm:text-sm">برای تاریخ امروز ({toPersianDigits(currentDateStr)}) شیفتی در دیتابیس ثبت نشده است.</p>
               {onNavigateToToday && (
                 <button 
                   onClick={onNavigateToToday}
                   className="mt-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition cursor-pointer"
                 >
                   <span>مشاهده تقویم و شیفت‌های ماه جاری</span>
                   <ArrowLeft size={14} />
                 </button>
               )}
             </div>
           )}

           {/* Today Bioprocesses Banner */}
           {todayProcesses.length > 0 && (
             <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5 bg-gradient-to-l from-emerald-50/70 to-teal-50/70 p-3 rounded-xl border border-emerald-200/60">
               <div className="flex items-center gap-2.5">
                 <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                   <FlaskConical size={15} />
                 </div>
                 <div>
                   <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                     پروسه بیوراکتور و تولید فعال امروز:
                   </span>
                   <div className="text-xs sm:text-sm font-black text-slate-850 mt-0.5 flex items-center gap-2 flex-wrap">
                     <span>{todayProcesses[0].title}</span>
                     {todayProcesses[0].vessel && (
                       <span className="text-[11px] text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200 font-medium">
                         {todayProcesses[0].vessel}
                       </span>
                     )}
                     {todayProcesses.length > 1 && (
                       <span className="text-[10px] bg-emerald-200 text-emerald-900 font-black px-1.5 py-0.5 rounded-full">
                         +{toPersianDigits(todayProcesses.length - 1)} پروسه دیگر
                       </span>
                     )}
                   </div>
                 </div>
               </div>

               {onOpenProcessModal && (
                 <button
                   type="button"
                   onClick={() => onOpenProcessModal(currentDateStr)}
                   className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer"
                 >
                   <span>مشاهده و ویرایش فرآیند</span>
                   <ChevronLeft size={14} />
                 </button>
               )}
             </div>
           )}
        </div>

      </div>
    </div>
  );
};

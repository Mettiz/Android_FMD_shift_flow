
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
    <div id="today-hero-section" className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden relative no-print scroll-mt-20">
      {/* Background Pattern */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500"></div>
      
      <div className="p-4 sm:p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
        
        {/* Date & Time Section */}
        <div className="flex flex-col items-center md:items-start gap-1.5 sm:gap-2 w-full md:w-auto md:min-w-[200px]">
           <div className="flex items-center justify-between md:justify-start w-full md:w-auto gap-2">
             <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full text-[11px] font-bold border border-emerald-200/70">
               <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
               <span>وضعیت زنده</span>
             </div>
             <span className={`md:hidden text-[11px] font-black px-2.5 py-1 rounded-full border flex items-center gap-1 ${
               liveShiftNow === 'DAY'
                 ? 'bg-amber-50 text-amber-800 border-amber-200'
                 : 'bg-indigo-50 text-indigo-800 border-indigo-200'
             }`}>
               {liveShiftNow === 'DAY' ? <Sun size={12} className="text-amber-500" /> : <Moon size={12} className="text-indigo-600" />}
               <span>{liveShiftNow === 'DAY' ? 'نوبت روز فعال' : 'نوبت شب فعال'}</span>
             </span>
           </div>

           <div className="flex flex-row md:flex-col items-center md:items-start justify-between w-full md:w-auto gap-2 mt-1">
             <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-800 tracking-tight text-right">
               {currentWeekdayStr || 'سه‌شنبه'}
             </h2>
             
             {/* LTR Container: Icon Date (Persian & Gregorian) | Divider | Icon Time */}
             <div className="flex items-center gap-2.5 sm:gap-4 text-slate-500 font-medium" dir="ltr">
               <div className="flex items-center gap-1.5 sm:gap-2">
                 <Calendar size={16} className="text-emerald-500 shrink-0 self-center" />
                 <div className="flex flex-col items-center justify-center leading-tight">
                   <span className="text-sm sm:text-lg font-black text-slate-800 tracking-tight text-center tabular-nums">{toPersianDigits(currentDateStr)}</span>
                   <span className="text-[10px] sm:text-xs font-semibold text-slate-500 tracking-wider tabular-nums text-center mt-0.5">
                     {currentGregorianDateStr}
                   </span>
                 </div>
               </div>
               <div className="w-px h-7 sm:h-8.5 bg-slate-200 mx-0.5 sm:mx-1"></div>
               <div className="flex items-center gap-1.5 sm:gap-2">
                 <Clock size={16} className="text-blue-500 shrink-0" />
                 <span className="text-sm sm:text-lg font-bold text-slate-700 tabular-nums">{toPersianDigits(currentTimeStr)}</span>
               </div>
             </div>
           </div>
        </div>

        {/* Vertical Divider (Desktop) */}
        <div className="hidden md:block w-px h-24 bg-slate-100"></div>

        {/* Shifts Section */}
        <div className="flex-1 w-full">
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
                       : 'bg-slate-100/80 border-slate-200/90'
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

               {/* Desktop 3-Column Grid */}
               <div className="hidden md:grid md:grid-cols-3 gap-4">
                 {/* Supervisor */}
                 <div className="flex flex-col gap-1 items-stretch">
                   <span className="text-xs font-bold text-slate-400 pr-1 text-right">سرپرست</span>
                   <ShiftUserCard name={todayEntry.onCallPerson} type="Supervisor" showIcon={true} />
                 </div>
                 
                 {/* Day Shift */}
                 <div className="flex flex-col gap-1 items-stretch">
                   <div className="flex items-center justify-between pr-1">
                     <span className="text-xs font-bold text-slate-400 text-right">شیفت روز (۰۸ - ۱۹)</span>
                     {todayEntry.extraDayPersons && todayEntry.extraDayPersons.length > 0 && (
                       <span className="text-[10px] font-black text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                         {todayEntry.extraDayPersons.length + 1} نفره
                       </span>
                     )}
                   </div>
                   {dayShiftCards}
                 </div>

                 {/* Night Shift */}
                 <div className="flex flex-col gap-1 items-stretch">
                   <div className="flex items-center justify-between pr-1">
                     <span className="text-xs font-bold text-slate-400 text-right">شیفت شب (۱۹ - ۰۸)</span>
                     {todayEntry.extraNightPersons && todayEntry.extraNightPersons.length > 0 && (
                       <span className="text-[10px] font-black text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                         {todayEntry.extraNightPersons.length + 1} نفره
                       </span>
                     )}
                   </div>
                   {nightShiftCards}
                 </div>
               </div>
             </>
           ) : (
             <div className="flex flex-col items-center justify-center text-center py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 h-full">
               <Calendar size={40} className="text-slate-300 mb-2" />
               <p className="text-slate-500 font-medium">برای تاریخ امروز ({toPersianDigits(currentDateStr)}) شیفتی در دیتابیس ثبت نشده است.</p>
               {onNavigateToToday && (
                 <button 
                   onClick={onNavigateToToday}
                   className="mt-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition"
                 >
                   <span>مشاهده تقویم و شیفت‌های شهریور</span>
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

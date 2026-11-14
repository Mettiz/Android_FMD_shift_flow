/**
 * Stats Card Component - v1.0.1
 */
import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  colorClass: string;
  type?: 'horizontal' | 'square' | 'compact';
}

const getSoftBadgeStyles = (colorClass: string): string => {
  if (colorClass.includes('emerald')) {
    return 'bg-emerald-50 text-emerald-600 border-emerald-200/80';
  }
  if (colorClass.includes('indigo')) {
    return 'bg-indigo-50 text-indigo-600 border-indigo-200/80';
  }
  if (colorClass.includes('amber') || colorClass.includes('orange')) {
    return 'bg-amber-50 text-amber-600 border-amber-200/80';
  }
  return 'bg-blue-50 text-blue-600 border-blue-200/80';
};

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  colorClass,
  type = 'horizontal',
}) => {
  const badgeTone = getSoftBadgeStyles(colorClass);

  if (type === 'square' || type === 'compact') {
    const stringValue = typeof value === 'string' ? value : String(value ?? '');
    const textLength = stringValue.length;

    let valueFontSize = 'text-xl sm:text-2xl leading-none font-black';
    if (textLength > 20) {
      valueFontSize = 'text-[11px] sm:text-xs leading-snug font-black';
    } else if (textLength > 14) {
      valueFontSize = 'text-xs sm:text-sm leading-snug font-black';
    } else if (textLength > 9) {
      valueFontSize = 'text-sm sm:text-base leading-snug font-black';
    } else if (textLength > 5) {
      valueFontSize = 'text-base sm:text-lg leading-tight font-black';
    }

    return (
      <div className="bg-white p-3 sm:p-3.5 rounded-2xl shadow-2xs border border-slate-200/90 flex flex-col justify-between gap-2 transition-all hover:border-slate-300 hover:shadow-xs h-full w-full overflow-hidden">
        {/* Top Row: Label + Tinted Icon */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <p className="text-[11px] sm:text-xs text-slate-500 font-bold truncate">
            {title}
          </p>
          <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl border flex items-center justify-center shrink-0 ${badgeTone}`}>
            <Icon size={15} />
          </div>
        </div>

        {/* Bottom Row: Primary Value + Subtitle */}
        <div className="min-w-0 pt-0.5">
          <p
            className={`text-slate-900 tabular-nums break-words text-right ${valueFontSize}`}
            title={stringValue}
          >
            {value}
          </p>
          {subtitle && (
            <p className="text-[10.5px] sm:text-[11px] text-slate-500 mt-1 font-bold tabular-nums truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-2xs border border-slate-200/90 flex items-center gap-3.5 transition-all hover:border-slate-300 hover:shadow-xs">
      <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${badgeTone}`}>
        <Icon size={22} />
      </div>
      <div className="min-w-0">
        <p className="text-xs sm:text-sm text-slate-500 font-bold">{title}</p>
        <p className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5 font-medium tabular-nums">{subtitle}</p>}
      </div>
    </div>
  );
};
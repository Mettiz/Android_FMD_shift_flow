
/**
 * Shift User Badge Card - v1.0.1
 */
import React from 'react';
import { Sun, Moon, CheckCircle2 } from 'lucide-react';

interface ShiftUserCardProps {
  name: string;
  type: 'Day' | 'Night' | 'Supervisor';
  className?: string;
  originalName?: string; // New prop to show previous owner
  showIcon?: boolean; // New prop to show icon instead of initial
  badgeLabel?: string; // Optional tag e.g. "همیار" or "نفر دوم"
  size?: 'sm' | 'md';
}

export const ShiftUserCard: React.FC<ShiftUserCardProps> = ({ 
  name, 
  type, 
  className = '', 
  originalName, 
  showIcon = true,
  badgeLabel,
  size = 'md'
}) => {
  const isDay = type === 'Day';
  const isNight = type === 'Night';
  
  // Display full name with prefix (matching Settings page)
  const displayName = name ? name.trim() : '---';
  const displayOriginal = originalName ? originalName.trim() : null;

  // Styling Config
  let styles = {
    wrapper: '',
    avatar: '',
    subText: '',
    indicator: ''
  };

  if (isDay) {
    styles = {
      wrapper: 'bg-orange-50/80 hover:bg-orange-100/90 text-orange-950 border border-orange-200/70',
      avatar: 'bg-white text-amber-500 shadow-2xs ring-1 ring-orange-200',
      subText: 'text-orange-600/70',
      indicator: 'bg-amber-500'
    };
  } else if (isNight) {
    styles = {
      wrapper: 'bg-indigo-50/60 hover:bg-indigo-100/75 text-slate-800 border border-indigo-200/70',
      avatar: 'bg-white text-indigo-600 shadow-2xs ring-1 ring-indigo-200',
      subText: 'text-indigo-500',
      indicator: 'bg-indigo-600'
    };
  } else {
    // Supervisor
    styles = {
      wrapper: 'bg-emerald-50/80 hover:bg-emerald-100/90 text-emerald-950 border border-emerald-200/70',
      avatar: 'bg-white text-emerald-600 shadow-2xs ring-1 ring-emerald-200',
      subText: 'text-emerald-600/70',
      indicator: 'bg-emerald-500'
    };
  }
  
  // Icon Selection (Always use Sun / Moon / CheckCircle2 icons instead of name initials)
  const Icon = isDay ? Sun : (isNight ? Moon : CheckCircle2);
  const isCompact = size === 'sm';

  return (
    <div className={`
      relative flex items-center ${isCompact ? 'gap-2 px-2.5 py-1.5' : 'gap-2.5 px-3 py-2.5'} w-full transition-all duration-200
      ${styles.wrapper} rounded-xl cursor-default ${className}
    `}>
      
      {/* Colored Indicator Strip (Right side) */}
      <div className={`absolute right-0 top-1.5 bottom-1.5 w-1 rounded-l-full ${styles.indicator} opacity-60`}></div>

      {/* Sun / Moon / Supervisor Icon Badge */}
      <div className={`
        ${isCompact ? 'w-7 h-7 min-w-[28px]' : 'w-8 h-8 min-w-[32px]'} rounded-lg flex items-center justify-center 
        shrink-0 ${styles.avatar}
      `}>
        <Icon size={isCompact ? 14 : 16} className={showIcon ? '' : ''} />
      </div>

      {/* Details */}
      <div className="flex flex-col items-start z-10 min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap w-full">
          <span className={`${isCompact ? 'text-xs' : 'text-[13px] sm:text-sm'} font-extrabold tracking-tight truncate text-right`}>
            {displayName}
          </span>
          {badgeLabel && (
            <span className="text-[9px] font-black bg-white/90 text-slate-700 px-1.5 py-0.2 rounded-full border border-slate-200 shadow-2xs whitespace-nowrap">
              {badgeLabel}
            </span>
          )}
        </div>
        
        {/* If swapped, show original name crossed out */}
        {displayOriginal && displayOriginal !== displayName && (
           <span className="text-[9px] text-red-500/85 line-through decoration-red-300 truncate w-full text-right" title={`تغییر یافته از: ${originalName}`}>
             {displayOriginal}
           </span>
        )}
      </div>
    </div>
  );
};

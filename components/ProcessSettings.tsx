/**
 * Process Settings Component
 * Allows managers to define, customize, and manage standard industrial bioprocesses:
 * - Define new processes for Cell Culture, Vessel Prep, Virus Inoculation, Inactivation, Formulation, etc.
 * - Manage custom parameters: Vessel, Media, Duration, Category, Color, Description.
 * - Custom processes dynamically appear in the dropdown/collapsible selector across the roster!
 */
import React, { useState } from 'react';
import { 
  Plus, Edit2, Trash2, FlaskConical, Sparkles, 
  RotateCcw, Search, Check, X, Filter, Info, ShieldAlert
} from 'lucide-react';
import { ProcessDefinition, ProcessCategory } from '../types';
import { 
  DEFAULT_PROCESS_DEFINITIONS, 
  CATEGORY_LABELS, 
  VESSEL_OPTIONS 
} from '../utils/bioprocessData';
import { toPersianDigits } from '../utils/persianDate';

interface ProcessSettingsProps {
  processDefinitions: ProcessDefinition[];
  onSaveDefinitions: (definitions: ProcessDefinition[]) => void;
  isUnlocked: boolean;
  onOpenUnlockModal: () => void;
}

export const ProcessSettings: React.FC<ProcessSettingsProps> = ({
  processDefinitions,
  onSaveDefinitions,
  isUnlocked,
  onOpenUnlockModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Form State
  const [formData, setFormData] = useState<Partial<ProcessDefinition>>({
    name: '',
    category: 'CellCulture',
    defaultVessel: 'Bioreactor 100L',
    defaultMedium: 'EMEM + Serum',
    durationDays: 2,
    color: '#10b981',
    description: '',
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleStartAdd = () => {
    if (!isUnlocked) {
      onOpenUnlockModal();
      return;
    }
    setFormData({
      name: '',
      category: 'CellCulture',
      defaultVessel: 'Bioreactor 100L',
      defaultMedium: 'EMEM + Serum',
      durationDays: 2,
      color: '#10b981',
      description: '',
      isCustom: true,
    });
    setEditingId(null);
    setIsAddingNew(true);
  };

  const handleStartEdit = (proc: ProcessDefinition) => {
    if (!isUnlocked) {
      onOpenUnlockModal();
      return;
    }
    setFormData({ ...proc });
    setEditingId(proc.id);
    setIsAddingNew(true);
  };

  const handleDelete = (id: string) => {
    if (!isUnlocked) {
      onOpenUnlockModal();
      return;
    }
    setPendingConfirm({
      message: 'آیا از حذف این پروسه از کتابخانه مطمئن هستید؟',
      onConfirm: () => {
        const updated = processDefinitions.filter(p => p.id !== id);
        onSaveDefinitions(updated);
        showToast('پروسه از کتابخانه حذف شد.');
      },
    });
  };

  const handleResetToDefault = () => {
    if (!isUnlocked) {
      onOpenUnlockModal();
      return;
    }
    setPendingConfirm({
      message: 'آیا می‌خواهید کتابخانه پروسه‌ها به تنظیمات استاندارد اولیه کارخانه تب برفکی (FMD) بازنشانی شود؟',
      onConfirm: () => {
        onSaveDefinitions(DEFAULT_PROCESS_DEFINITIONS);
        showToast('کتابخانه پروسه‌ها به حالت استاندارد بازنشانی شد.');
      },
    });
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      showToast('لطفاً نام پروسه را وارد کنید.');
      return;
    }

    let updated: ProcessDefinition[] = [];

    if (editingId) {
      updated = processDefinitions.map(p => {
        if (p.id === editingId) {
          return {
            ...p,
            ...formData,
            name: formData.name!.trim(),
          } as ProcessDefinition;
        }
        return p;
      });
      showToast('پروسه با موفقیت به‌روزرسانی شد.');
    } else {
      const newProc: ProcessDefinition = {
        id: `custom-proc-${Date.now()}`,
        name: formData.name!.trim(),
        category: formData.category || 'CellCulture',
        defaultVessel: formData.defaultVessel,
        defaultMedium: formData.defaultMedium,
        durationDays: Number(formData.durationDays) || 2,
        color: formData.color || '#10b981',
        description: formData.description,
        isCustom: true,
      };
      updated = [...processDefinitions, newProc];
      showToast('پروسه جدید به کتابخانه اضافه شد و در لیست کشویی فعال است.');
    }

    onSaveDefinitions(updated);
    setIsAddingNew(false);
    setEditingId(null);
  };

  // Filter definitions
  const filteredList = processDefinitions.filter(p => {
    if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchDesc = p.description?.toLowerCase().includes(q);
      const matchVessel = p.defaultVessel?.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchVessel) return false;
    }
    return true;
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden" dir="rtl">
      
      {/* Header Ribbon */}
      <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200/70">
            <FlaskConical size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-sm sm:text-base text-slate-900">
                تعریف و مدیریت پروسه‌های تولید و بیوراکتورها
              </h3>
              <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2.5 py-0.5 rounded-lg tabular-nums">
                {toPersianDigits(processDefinitions.length)} پروسه تعریف‌شده
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              تعریف پروسه‌های استاندارد کارخانه؛ این موارد به عنوان لیست کشویی هنگام ثبت کارهای روزانه ظاهر می‌شوند.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto shrink-0">
          <button
            type="button"
            onClick={handleResetToDefault}
            className="h-9 px-3.5 flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition cursor-pointer shadow-2xs whitespace-nowrap"
            title="بازنشانی تمام پروسه‌ها به مقادیر اولیه کارخانه"
          >
            <RotateCcw size={13} className="shrink-0" />
            <span>بازنشانی پیش‌فرض</span>
          </button>

          <button
            type="button"
            onClick={handleStartAdd}
            className="h-9 px-4 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-xs transition cursor-pointer active:scale-95 whitespace-nowrap"
          >
            <Plus size={15} className="shrink-0" />
            <span>تعریف پروسه جدید</span>
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        {/* Inline Confirmation Banner */}
        {pendingConfirm && (
          <div className="bg-amber-50 border border-amber-300 text-amber-950 px-4 py-3 rounded-xl text-xs font-bold flex flex-wrap items-center justify-between gap-2 shadow-xs">
            <span>{pendingConfirm.message}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="h-8 px-3 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center justify-center"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = pendingConfirm.onConfirm;
                  setPendingConfirm(null);
                  action();
                }}
                className="h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white cursor-pointer flex items-center justify-center"
              >
                تایید
              </button>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between shadow-sm">
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="text-emerald-200 hover:text-white cursor-pointer">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Form: Add / Edit Definition */}
        {isAddingNew && (
          <form onSubmit={handleSubmitForm} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h4 className="font-black text-sm text-slate-800 flex items-center gap-2">
                <Sparkles size={16} className="text-emerald-600 shrink-0" />
                <span>{editingId ? 'ویرایش مشخصات پروسه' : 'تعریف پروسه جدید برای لیست کشویی'}</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsAddingNew(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 text-xs">
              {/* Name */}
              <div className="sm:col-span-2 space-y-1">
                <label className="font-bold text-slate-700 block">نام کامل پروسه:</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="مثلاً: Cell Culture - Bioreactor 100L یا پایش زیست‌پذیری..."
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">دسته‌بندی:</label>
                <select
                  value={formData.category || 'CellCulture'}
                  onChange={e => setFormData(prev => ({ ...prev, category: e.target.value as ProcessCategory }))}
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Default Vessel */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">مخزن / وسل پیش‌فرض:</label>
                <select
                  value={formData.defaultVessel || ''}
                  onChange={e => setFormData(prev => ({ ...prev, defaultVessel: e.target.value }))}
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="">بدون وسل مشخص</option>
                  {VESSEL_OPTIONS.map(v => (
                    <option key={v.id} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Default Medium */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">محیط کشت پیش‌فرض:</label>
                <select
                  value={formData.defaultMedium || 'EMEM + Serum'}
                  onChange={e => setFormData(prev => ({ ...prev, defaultMedium: e.target.value }))}
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="EMEM + Serum">EMEM + Serum</option>
                  <option value="Earl">Earl's Medium</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Duration / Passage Days */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 block">دوره پاساژ یا مدت زمان (روز):</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={formData.durationDays || 2}
                  onChange={e => setFormData(prev => ({ ...prev, durationDays: Number(e.target.value) }))}
                  className="w-full h-9 px-3 bg-white border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 tabular-nums"
                />
              </div>

              {/* Description */}
              <div className="sm:col-span-2 md:col-span-3 space-y-1">
                <label className="font-bold text-slate-700 block">توضیحات و دستورالعمل اجرایی:</label>
                <textarea
                  rows={2}
                  value={formData.description || ''}
                  onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="توضیح مختصر در مورد نحوه اجرا، نکات ایمنی و استانداردهای این پروسه..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 resize-none text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsAddingNew(false)}
                className="h-9 px-4 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="submit"
                className="h-9 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-sm transition active:scale-95 cursor-pointer"
              >
                {editingId ? 'ذخیره تغییرات' : 'ثبت پروسه در کتابخانه'}
              </button>
            </div>
          </form>
        )}

        {/* Search & Balanced Category Filter Box */}
        <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
          {/* Row 1: Search Input + Result Count */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="جستجو در نام، مخزن یا توضیحات پروسه..."
                className="w-full h-9 pr-9 pl-8 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title="پاک کردن جستجو"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-2 px-3 h-9 bg-white border border-slate-200/90 rounded-xl text-[11px] font-bold text-slate-600 shrink-0 tabular-nums">
              <span>تعداد نمایش:</span>
              <span className="text-emerald-700 font-black">
                {toPersianDigits(filteredList.length)} از {toPersianDigits(processDefinitions.length)} پروسه
              </span>
            </div>
          </div>

          {/* Row 2: Balanced Category Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`h-8 px-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer truncate tabular-nums ${
                selectedCategory === 'ALL'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/90'
              }`}
            >
              <span className="truncate">همه دسته‌ها</span>
              <span className="shrink-0">({toPersianDigits(processDefinitions.length)})</span>
            </button>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => {
              const catCount = processDefinitions.filter(p => p.category === k).length;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelectedCategory(k)}
                  className={`h-8 px-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer truncate tabular-nums ${
                    selectedCategory === k
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/90'
                  }`}
                  title={`${v.label} (${toPersianDigits(catCount)})`}
                >
                  <span className="truncate">{v.label}</span>
                  <span className="shrink-0 opacity-85">({toPersianDigits(catCount)})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* List of Definitions */}
        {filteredList.length === 0 ? (
          <div className="py-10 text-center bg-slate-50/60 border border-dashed border-slate-200 rounded-2xl space-y-2">
            <FlaskConical size={28} className="mx-auto text-slate-300" />
            <p className="text-xs font-bold text-slate-500">
              هیچ پروسه‌ای در این دسته‌بندی یا عبارت جستجو یافت نشد.
            </p>
            {(searchQuery || selectedCategory !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                }}
                className="text-xs font-black text-emerald-600 hover:text-emerald-700 underline cursor-pointer"
              >
                نمایش همه پروسه‌ها
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch">
            {filteredList.map(proc => {
              const catInfo = CATEGORY_LABELS[proc.category] || { label: 'سایر', badgeBg: 'bg-slate-100 border-slate-300' };

              return (
                <div
                  key={proc.id}
                  className="h-full bg-white border border-slate-200 hover:border-emerald-300 rounded-2xl p-4 transition-all shadow-2xs flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center h-6 text-[10.5px] font-bold px-2.5 rounded-lg border ${catInfo.badgeBg}`}>
                        {catInfo.label}
                      </span>
                      
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(proc)}
                          className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-amber-700 hover:bg-amber-50 border border-transparent hover:border-amber-200 rounded-lg transition cursor-pointer"
                          title="ویرایش پروسه"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(proc.id)}
                          className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-lg transition cursor-pointer"
                          title="حذف پروسه"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                        style={{ backgroundColor: proc.color || '#10b981' }}
                      />
                      <h4 className="font-black text-sm text-slate-900 leading-snug">
                        {proc.name}
                      </h4>
                    </div>

                    <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed min-h-[2.25rem]">
                      {proc.description || 'بدون توضیحات تکمیلی'}
                    </p>
                  </div>

                  {/* Symmetrical 3-Column Metadata Footer */}
                  <div className="grid grid-cols-3 gap-1.5 pt-2.5 border-t border-slate-100 text-[10.5px] font-bold">
                    <div className="bg-slate-50 border border-slate-200/80 text-slate-700 px-2 py-1.5 rounded-lg flex flex-col items-center justify-center text-center min-w-0">
                      <span className="text-[9.5px] text-slate-400 font-medium">مخزن</span>
                      <span className="truncate w-full mt-0.5" dir="ltr" title={proc.defaultVessel || 'عمومی'}>
                        {proc.defaultVessel || 'عمومی'}
                      </span>
                    </div>

                    <div className="bg-teal-50/70 border border-teal-200/80 text-teal-900 px-2 py-1.5 rounded-lg flex flex-col items-center justify-center text-center min-w-0">
                      <span className="text-[9.5px] text-teal-600/80 font-medium">محیط</span>
                      <span className="truncate w-full mt-0.5" dir="ltr" title={proc.defaultMedium || '—'}>
                        {proc.defaultMedium || '—'}
                      </span>
                    </div>

                    <div className="bg-emerald-50/70 border border-emerald-200/80 text-emerald-900 px-2 py-1.5 rounded-lg flex flex-col items-center justify-center text-center min-w-0 tabular-nums">
                      <span className="text-[9.5px] text-emerald-600/80 font-medium">دوره زمان‌بندی</span>
                      <span className="truncate w-full mt-0.5">
                        {toPersianDigits(proc.durationDays || 1)} روز
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

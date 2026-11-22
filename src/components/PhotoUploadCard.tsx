import { useRef } from 'react';
import {
  Camera,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Maximize2,
  RotateCcw,
} from 'lucide-react';
import type { PhotoUploadState } from '../types/billing';

interface PhotoUploadCardProps {
  stepNumber: string;
  label: string;
  hint: string;
  state: PhotoUploadState;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  onZoom: (url: string, title: string) => void;
  onPickAlternate?: (value: number) => void;
}

export function PhotoUploadCard({
  stepNumber,
  label,
  hint,
  state,
  onFileSelected,
  onClear,
  onZoom,
  onPickAlternate,
}: PhotoUploadCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    e.target.value = '';
  };

  const isDone = state.status === 'done';

  return (
    <div
      className={`rounded-2xl border-2 p-4 sm:p-5 flex flex-col gap-3.5 transition-colors ${
        isDone
          ? 'border-[#16A34A] bg-[#F0FDF4]/60'
          : 'border-[#CBD5E1] bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg sm:text-xl font-extrabold text-[#111827] leading-snug">
            <span className="text-[#155EEF] mr-1.5">{stepNumber}</span>
            {label}
          </p>
          <p className="text-[15px] text-[#475569] mt-0.5 leading-snug">
            {hint}
          </p>
        </div>

        {state.previewUrl && (
          <button
            type="button"
            onClick={onClear}
            className="min-h-[44px] px-3 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-sm font-bold text-[#475569] inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>지우기</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        className="sr-only"
      />

      {state.previewUrl ? (
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A]/5">
            <img
              src={state.previewUrl}
              alt={`${label} 미리보기`}
              referrerPolicy="no-referrer"
              onClick={() => onZoom(state.previewUrl!, label)}
              className="w-full h-40 sm:h-44 object-cover cursor-zoom-in"
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onZoom(state.previewUrl!, label)}
              className="min-h-[48px] px-3 py-2.5 rounded-xl border-2 border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-[15px] font-bold text-[#111827] inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Maximize2 className="w-4 h-4 shrink-0" />
              <span>사진 크게 보기</span>
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="min-h-[48px] px-3 py-2.5 rounded-xl border-2 border-[#155EEF] bg-[#EEF4FF] hover:bg-[#DCE8FF] text-[15px] font-bold text-[#1048B8] inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>다시 찍기</span>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full min-h-[60px] rounded-xl bg-[#155EEF] hover:bg-[#1048B8] active:scale-[0.99] text-white text-lg font-extrabold inline-flex items-center justify-center gap-2.5 px-4 py-3.5 transition-all cursor-pointer"
        >
          <Camera className="w-6 h-6 shrink-0" />
          <span>{label} 찍기</span>
        </button>
      )}

      {state.status === 'processing' && (
        <div className="rounded-xl bg-[#EEF4FF] border border-[#BFDBFE] p-3.5 space-y-2">
          <div className="flex items-center justify-between text-[15px] font-bold text-[#1048B8]">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin shrink-0" />
              <span>사진에서 숫자를 읽고 있어요...</span>
            </span>
            <span className="font-mono tabular-nums">{state.progress}%</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-[#DBEAFE] overflow-hidden">
            <div
              className="h-full bg-[#155EEF] transition-all duration-150"
              style={{ width: `${Math.max(12, state.progress)}%` }}
            />
          </div>
        </div>
      )}

      {state.status === 'done' && (
        <div className="rounded-xl bg-[#ECFDF3] border border-[#A6F4C5] p-3.5 space-y-2.5">
          <div className="flex items-start gap-2.5 text-base font-bold text-[#047857] leading-snug">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p>{state.message}</p>
              {state.note && (
                <p className="text-sm font-semibold text-[#065F46]/90">
                  {state.note}
                </p>
              )}
            </div>
          </div>

          {state.alternateValue != null && onPickAlternate && (
            <button
              type="button"
              onClick={() => onPickAlternate(state.alternateValue!)}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#16A34A] bg-white hover:bg-[#DCFCE7] text-sm font-extrabold text-[#047857] transition-colors cursor-pointer"
            >
              끝자리가 넘어가는 중이라면 → {state.alternateValue}로 바꾸기
            </button>
          )}
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-xl bg-[#FFFAEB] border border-[#FEDF89] p-3.5 flex items-start gap-2.5 text-[15px] font-bold text-[#93370D] leading-snug">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}

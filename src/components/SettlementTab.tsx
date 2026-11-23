import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Images,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
} from 'lucide-react';
import {
  VALIDATION_LIMITS,
  type PhotoKind,
  type PhotoUploadState,
  type SavedSettlementSnapshot,
  type SettlementCalculation,
  type SettlementInputs,
  type UnitKey,
} from '../types/billing';
import {
  buildUnitMessages,
  formatKoreanReadableWon,
  formatUsage,
  formatWon,
  ymToKoreanLabel,
} from '../utils/billingMath';
import {
  detectSwappedMeterInputs,
  type MeterPhotoKind,
} from '../utils/meterMatcher';
import { PhotoUploadCard } from './PhotoUploadCard';

type WizardStep = 1 | 2 | 3;

interface SettlementTabProps {
  inputs: SettlementInputs;
  autoFilledFields: Record<string, boolean>;
  photos: Record<PhotoKind, PhotoUploadState>;
  calc: SettlementCalculation;
  kstDateInfo: {
    koreanDate: string;
    compactDateTime: string;
    fromPhoto: boolean;
  };
  saving: boolean;
  savedSnapshot: SavedSettlementSnapshot | null;
  bulkUploading: {
    active: boolean;
    total: number;
    completed: number;
  };
  isCloudSynced: boolean;
  priorBaselineCandidate: {
    ym: string;
    monthLabel: string;
    prevTotal: number;
    prev201: number;
    prev202: number;
  } | null;
  onInputChange: (field: keyof SettlementInputs, value: string) => void;
  onApplyPrevBaseline: (candidate: {
    monthLabel: string;
    prevTotal: number;
    prev201: number;
    prev202: number;
  }) => void;
  onToggleTotalMeterReplaced: (replaced: boolean) => void;
  onPhotoSelect: (kind: PhotoKind, file: File) => void;
  onBulkPhotoSelect: (files: File[]) => void;
  onFixSwappedMeters: (mapping: Record<MeterPhotoKind, MeterPhotoKind>) => void;
  onPhotoClear: (kind: PhotoKind) => void;
  onPhotoRotate: (kind: PhotoKind) => void;
  onPhotoZoom: (url: string, title: string) => void;
  onClearCurrentMonth: () => void;
  onSaveToDb: () => Promise<boolean>;
  onStartNewSettlement: () => void;
  onCopyFeedback: (label: string) => void;
}

const PHOTO_META: Array<{
  stepNumber: string;
  kind: PhotoKind;
  label: string;
  hint: string;
}> = [
  {
    stepNumber: '①',
    kind: 'meter201',
    label: '201호 계량기 사진',
    hint: '201호 계량기 숫자가 잘 보이게 찍어주세요',
  },
  {
    stepNumber: '②',
    kind: 'meter202',
    label: '202호 계량기 사진',
    hint: '202호 계량기 숫자가 잘 보이게 찍어주세요',
  },
  {
    stepNumber: '③',
    kind: 'meterTot',
    label: '건물 전체 계량기 사진',
    hint: '건물 전체 메인 계량기 숫자를 찍어주세요',
  },
  {
    stepNumber: '④',
    kind: 'bill',
    label: '수도세 고지서 사진',
    hint: '고지서 금액과 사용량이 나오게 찍어주세요',
  },
];

export function SettlementTab({
  inputs,
  autoFilledFields,
  photos,
  calc,
  kstDateInfo,
  saving,
  savedSnapshot,
  bulkUploading,
  isCloudSynced,
  priorBaselineCandidate,
  onInputChange,
  onApplyPrevBaseline,
  onToggleTotalMeterReplaced,
  onPhotoSelect,
  onBulkPhotoSelect,
  onFixSwappedMeters,
  onPhotoClear,
  onPhotoRotate,
  onPhotoZoom,
  onClearCurrentMonth,
  onSaveToDb,
  onStartNewSettlement,
  onCopyFeedback,
}: SettlementTabProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const bulkInputRef = useRef<HTMLInputElement | null>(null);
  const swappedSuggestion = detectSwappedMeterInputs(inputs);
  const [showExtraSettings, setShowExtraSettings] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitKey | null>(null);
  const [customMessages, setCustomMessages] = useState<
    Partial<Record<UnitKey, string>>
  >({});
  const [copiedUnit, setCopiedUnit] = useState<UnitKey | null>(null);
  const [doneUnits, setDoneUnits] = useState<Partial<Record<UnitKey, boolean>>>(
    {}
  );

  // Use locked savedSnapshot in Send step so saving NEVER wipes amounts or messages
  const activeCalc = savedSnapshot ? savedSnapshot.calc : calc;
  const activeMonthLabel = savedSnapshot
    ? savedSnapshot.monthLabel
    : inputs.monthLabel;
  const activeAccountInfo = savedSnapshot
    ? savedSnapshot.accountInfo
    : inputs.accountInfo;

  const autoMessages = buildUnitMessages(
    activeMonthLabel,
    activeAccountInfo,
    activeCalc
  );

  useEffect(() => {
    setCustomMessages({});
  }, [
    activeMonthLabel,
    activeAccountInfo,
    activeCalc.billedU201,
    activeCalc.billedU202,
    activeCalc.billedUShop,
    activeCalc.a201,
    activeCalc.a202,
    activeCalc.aShop,
  ]);

  const goToStep = (next: WizardStep) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveAndProceedToSend = async () => {
    if (savedSnapshot) {
      goToStep(3);
      return;
    }
    const ok = await onSaveToDb();
    if (ok) {
      goToStep(3);
    }
  };

  const getMessageValue = (unit: UnitKey) =>
    customMessages[unit] !== undefined
      ? customMessages[unit]!
      : autoMessages[unit];

  const handleCopy = async (unit: UnitKey) => {
    const text = getMessageValue(unit);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedUnit(unit);
    setDoneUnits((prev) => ({ ...prev, [unit]: true }));
    onCopyFeedback(`${unit} 문자를 복사했어요! 카톡이나 문자에 붙여넣기 하세요.`);
    window.setTimeout(() => {
      setCopiedUnit((prev) => (prev === unit ? null : prev));
    }, 2000);
  };

  const handleSmsClick = (unit: UnitKey) => {
    setDoneUnits((prev) => ({ ...prev, [unit]: true }));
  };

  const handleYmChange = (nextYm: string) => {
    onInputChange('ym', nextYm);
    if (VALIDATION_LIMITS.YM_PATTERN.test(nextYm)) {
      onInputChange('monthLabel', ymToKoreanLabel(nextYm));
    }
  };

  const nudgeNumber = (field: keyof SettlementInputs, delta: number) => {
    const raw = inputs[field];
    if (typeof raw !== 'string') return;
    const current = raw.trim() === '' ? 0 : Number(raw);
    if (!Number.isFinite(current)) return;
    const next = Math.max(0, Math.round((current + delta) * 10) / 10);
    onInputChange(field, String(next));
  };

  const takenPhotoCount = (Object.keys(photos) as PhotoKind[]).filter(
    (k) => photos[k].previewUrl !== null
  ).length;

  const missingInputs: string[] = [];
  if (!inputs.billAmount.trim() || Number(inputs.billAmount) <= 0)
    missingInputs.push('고지서 금액');
  if (!inputs.currTotal.trim()) missingInputs.push('건물 전체 계량기');
  if (!inputs.curr201.trim()) missingInputs.push('201호 계량기');
  if (!inputs.curr202.trim()) missingInputs.push('202호 계량기');

  const bigNumInputClass = (field: keyof SettlementInputs) =>
    `w-full min-h-[60px] px-4 py-3 rounded-xl border-2 font-mono tabular-nums text-[26px] sm:text-[28px] font-extrabold text-[#111827] placeholder:text-[#94A3B8] placeholder:font-sans placeholder:text-base placeholder:font-medium transition-colors focus:outline-none focus:border-[#155EEF] focus:bg-white ${
      autoFilledFields[field]
        ? 'border-[#155EEF] bg-[#EEF4FF]'
        : 'border-[#CBD5E1] bg-[#FAFBFD]'
    }`;

  const unitRows: Array<{
    unit: UnitKey;
    usage: number;
    measuredUsage: number;
    amount: number;
  }> = [
    {
      unit: '201호',
      usage: activeCalc.billedU201,
      measuredUsage: activeCalc.u201,
      amount: activeCalc.a201,
    },
    {
      unit: '202호',
      usage: activeCalc.billedU202,
      measuredUsage: activeCalc.u202,
      amount: activeCalc.a202,
    },
    {
      unit: '상가',
      usage: activeCalc.billedUShop,
      measuredUsage: activeCalc.uShop,
      amount: activeCalc.aShop,
    },
  ];

  const doneCount = (['201호', '202호', '상가'] as UnitKey[]).filter((u) =>
    Boolean(doneUnits[u])
  ).length;

  const renderInlinePhotoPreview = (kind: PhotoKind, label: string) => {
    const photo = photos[kind];
    if (!photo.previewUrl) return null;
    const displaySrc = photo.focusedPreviewUrl || photo.previewUrl;
    return (
      <div className="mb-3 rounded-xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A]">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#F1F5F9] border-b border-[#DCE3EC]">
          <span className="text-xs sm:text-sm font-bold text-[#334155]">
            {label} (숫자 비교용 · 자동 정렬)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onPhotoRotate(kind)}
              className="min-h-[34px] px-2.5 rounded-lg bg-white border border-[#CBD5E1] hover:bg-[#F8FAFC] text-xs font-bold text-[#334155] inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>돌리기</span>
            </button>
            <button
              type="button"
              onClick={() => onPhotoZoom(photo.previewUrl!, label)}
              className="min-h-[34px] px-2.5 rounded-lg bg-white border border-[#CBD5E1] hover:bg-[#EEF4FF] text-xs font-bold text-[#155EEF] inline-flex items-center gap-1 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>크게 보기</span>
            </button>
          </div>
        </div>
        <div className="w-full h-36 sm:h-44 flex items-center justify-center p-1.5 bg-[#0F172A]">
          <img
            src={displaySrc}
            alt={`${label} 확인 사진`}
            referrerPolicy="no-referrer"
            onClick={() => onPhotoZoom(photo.previewUrl!, label)}
            className="max-w-full max-h-full object-contain rounded cursor-zoom-in"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* 3-Step Big Clickable Progress Bar */}
      <div
        role="tablist"
        aria-label="정산 진행 단계"
        className="grid grid-cols-3 gap-2 p-1.5 bg-white border-2 border-[#DCE3EC] rounded-2xl"
      >
        {[
          { num: 1 as WizardStep, title: '1. 사진 찍기', sub: `${takenPhotoCount}/4장` },
          {
            num: 2 as WizardStep,
            title: '2. 확인·저장',
            sub: savedSnapshot
              ? '저장 완료'
              : calc.allZeroUsage
                ? '기준 확인'
                : calc.isReady
                  ? '저장 준비됨'
                  : `${4 - missingInputs.length}/4칸`,
          },
          {
            num: 3 as WizardStep,
            title: '3. 문자 보내기',
            sub: activeCalc.isReady
              ? doneCount > 0
                ? `${doneCount}/3 보냄`
                : formatWon(activeCalc.finalSum)
              : '대기 중',
          },
        ].map((item) => {
          const isActive = step === item.num;
          const isCompleted =
            (item.num === 1 && takenPhotoCount > 0 && step > 1) ||
            (item.num === 2 && Boolean(savedSnapshot) && step !== 2) ||
            (item.num === 3 && doneCount === 3 && step !== 3);

          return (
            <button
              key={item.num}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => goToStep(item.num)}
              className={`min-h-[62px] px-2 py-2.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#155EEF] text-white'
                  : isCompleted
                    ? 'bg-[#ECFDF3] text-[#047857] hover:bg-[#DCFCE7]'
                    : 'bg-transparent text-[#334155] hover:bg-[#F1F5F9]'
              }`}
            >
              <span className="text-[15px] sm:text-base font-extrabold whitespace-nowrap">
                {item.title}
              </span>
              <span
                className={`text-xs sm:text-[13px] font-bold font-mono tabular-nums whitespace-nowrap ${
                  isActive
                    ? 'text-white/90'
                    : isCompleted
                      ? 'text-[#047857]'
                      : 'text-[#64748B]'
                }`}
              >
                {item.sub}
              </span>
            </button>
          );
        })}
      </div>

      {/* STEP 1: Photo Capture */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-white border border-[#DCE3EC] rounded-2xl p-5 space-y-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#111827] leading-snug">
                계량기와 고지서 사진을 올려주세요
              </h2>
              <p className="text-base text-[#475569] mt-1.5 leading-relaxed">
                바로 찍거나 앨범에서 사진을 고르면 숫자와 날짜가 자동으로
                들어갑니다.
                <br />
                사진 없이 다음 단계에서 직접 적어도 괜찮습니다.
              </p>
            </div>
            <div
              className={`rounded-xl px-3.5 py-2.5 border flex flex-wrap items-center justify-between gap-2 text-sm sm:text-[15px] font-bold ${
                kstDateInfo.fromPhoto
                  ? 'bg-[#EEF4FF] border-[#BFDBFE] text-[#1048B8]'
                  : 'bg-[#F8FAFC] border-[#DCE3EC] text-[#334155]'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Calendar className="w-4 h-4 shrink-0" />
                <span>
                  한국시간 기준: {kstDateInfo.koreanDate} ({inputs.monthLabel}{' '}
                  정산)
                </span>
              </span>
              <span className="text-xs sm:text-sm font-mono tabular-nums opacity-90">
                {kstDateInfo.fromPhoto
                  ? `사진 촬영일시 자동 반영 (${kstDateInfo.compactDateTime})`
                  : '사진을 올리면 촬영일시로 자동 맞춤'}
              </span>
            </div>

            {/* 1-Tap Bulk Auto-Sort Upload */}
            <input
              ref={bulkInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length > 0) {
                  onBulkPhotoSelect(picked);
                }
                e.target.value = '';
              }}
              className="sr-only"
            />
            <div className="rounded-xl bg-[#EEF4FF] border-2 border-[#93C5FD] p-4 space-y-2.5">
              <button
                type="button"
                disabled={bulkUploading.active}
                onClick={() => bulkInputRef.current?.click()}
                className="w-full min-h-[58px] px-4 py-3 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] disabled:bg-[#94A3B8] active:scale-[0.99] text-white text-base sm:text-lg font-extrabold inline-flex items-center justify-center gap-2.5 transition-all cursor-pointer"
              >
                {bulkUploading.active ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                    <span>
                      사진 자동 분류 중 ({bulkUploading.completed}/
                      {bulkUploading.total}장)...
                    </span>
                  </>
                ) : (
                  <>
                    <Images className="w-5 h-5 shrink-0" />
                    <span>사진 한 번에 골라서 자동 정리하기 (최대 4장)</span>
                  </>
                )}
              </button>
              <p className="text-sm font-semibold text-[#1E3A8A] leading-snug text-center">
                순서 상관없이 고르면 201호 · 202호 · 건물 전체 · 고지서를 알아서
                제자리에 넣어드립니다. 아래 칸에 잘못 올려도 자동으로 옮겨집니다.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PHOTO_META.map((item) => (
              <PhotoUploadCard
                key={item.kind}
                stepNumber={item.stepNumber}
                label={item.label}
                hint={item.hint}
                state={photos[item.kind]}
                onFileSelected={(file) => onPhotoSelect(item.kind, file)}
                onClear={() => onPhotoClear(item.kind)}
                onRotate={() => onPhotoRotate(item.kind)}
                onZoom={onPhotoZoom}
              />
            ))}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => goToStep(2)}
              className="w-full min-h-[60px] px-6 py-4 rounded-2xl bg-[#111827] hover:bg-[#1E293B] active:scale-[0.99] text-white text-lg sm:text-xl font-extrabold inline-flex items-center justify-center gap-2.5 transition-all cursor-pointer"
            >
              <span>다음: 숫자 확인하고 저장하기</span>
              <ArrowRight className="w-6 h-6 shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Big-Type Visual Inspection & Easy Edit */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-white border border-[#DCE3EC] rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#111827]">
                숫자가 맞는지 확인해 주세요
              </h2>
              <p className="text-[15px] text-[#475569] mt-1">
                파란 칸은 사진에서 읽어온 숫자입니다. 틀리면 칸을 눌러 고치세요.
              </p>
              <p className="text-sm font-bold text-[#155EEF] mt-1.5 inline-flex items-center gap-1.5">
                <Calendar className="w-4 h-4 shrink-0" />
                <span>
                  정산 기준일 (한국시간): {kstDateInfo.koreanDate} ·{' '}
                  {inputs.monthLabel}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClearCurrentMonth}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-sm font-bold text-[#475569] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Eraser className="w-4 h-4" />
              <span>숫자 다시 쓰기</span>
            </button>
          </div>

          {swappedSuggestion && (
            <div
              role="alert"
              className="rounded-2xl bg-[#EEF4FF] border-2 border-[#155EEF] p-4 sm:p-5 space-y-3"
            >
              <div className="space-y-1">
                <p className="text-lg font-extrabold text-[#1048B8] leading-snug">
                  호실 계량기 사진·숫자가 서로 바뀐 것 같아요!
                </p>
                <p className="text-[15px] font-bold text-[#1E3A8A] leading-relaxed font-mono tabular-nums">
                  자동 유추 결과: {swappedSuggestion.summaryText}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onFixSwappedMeters(swappedSuggestion.mapping)}
                className="w-full min-h-[54px] px-4 py-3 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] active:scale-[0.99] text-white text-base sm:text-lg font-extrabold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <RefreshCw className="w-5 h-5 shrink-0" />
                <span>네, 사진과 숫자를 한 번에 제자리로 맞추기</span>
              </button>
            </div>
          )}

          {calc.allZeroUsage && (
            <div
              role="alert"
              className="rounded-2xl bg-[#EEF4FF] border-2 border-[#155EEF] p-4 sm:p-5 space-y-3"
            >
              <div className="space-y-1.5">
                <p className="text-lg font-extrabold text-[#1048B8] leading-snug">
                  이미 저장된 기준 숫자와 똑같아서 모든 호실 사용량이 0㎥로
                  나왔어요!
                </p>
                <p className="text-[15px] font-semibold text-[#1E3A8A] leading-relaxed">
                  이번 달 숫자(전체 {inputs.currTotal} · 201호 {inputs.curr201}{' '}
                  · 202호 {inputs.curr202})가 현재 지난달 기준 숫자와 같습니다.
                  한 호실에 요금 전체가 몰리지 않도록 정산을 잠시 멈췄어요.
                </p>
              </div>
              {priorBaselineCandidate && (
                <button
                  type="button"
                  onClick={() => onApplyPrevBaseline(priorBaselineCandidate)}
                  className="w-full min-h-[56px] px-4 py-3 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] active:scale-[0.99] text-white text-base sm:text-lg font-extrabold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-5 h-5 shrink-0" />
                  <span>
                    {priorBaselineCandidate.monthLabel} 기준(전체{' '}
                    {priorBaselineCandidate.prevTotal} · 201호{' '}
                    {priorBaselineCandidate.prev201} · 202호{' '}
                    {priorBaselineCandidate.prev202})으로 다시 계산하기
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowExtraSettings(true)}
                className="w-full min-h-[46px] px-4 py-2 rounded-xl border-2 border-[#93C5FD] bg-white hover:bg-[#F8FAFC] text-sm sm:text-base font-extrabold text-[#1048B8] cursor-pointer"
              >
                지난달 기준 숫자 직접 고치기
              </button>
            </div>
          )}

          {!calc.allZeroUsage && calc.warnings.length > 0 && (
            <div
              role="alert"
              className="rounded-2xl bg-[#FFFAEB] border-2 border-[#F59E0B] p-4 flex items-start gap-3 text-base text-[#93370D]"
            >
              <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5 text-[#D97706]" />
              <div className="space-y-1">
                {calc.warnings.map((w, idx) => (
                  <p key={idx} className="font-bold leading-snug">
                    {w}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* 1) Water Bill Amount & Usage */}
          <section className="bg-white border border-[#DCE3EC] rounded-2xl p-5 space-y-4">
            <h3 className="text-lg font-extrabold text-[#111827]">
              ① 수도세 고지서 숫자
            </h3>

            {renderInlinePhotoPreview('bill', '수도세 고지서 사진')}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="billAmount"
                    className="text-base font-extrabold text-[#111827]"
                  >
                    고지서 금액 (원)
                  </label>
                  {autoFilledFields.billAmount && (
                    <span className="text-sm font-bold text-[#155EEF]">
                      자동 입력됨
                    </span>
                  )}
                </div>
                <input
                  id="billAmount"
                  type="number"
                  inputMode="numeric"
                  value={inputs.billAmount}
                  onChange={(e) => onInputChange('billAmount', e.target.value)}
                  placeholder="예: 56060"
                  className={bigNumInputClass('billAmount')}
                />
                {Number(inputs.billAmount) > 0 && (
                  <p className="mt-1.5 text-base font-extrabold text-[#155EEF]">
                    읽기 확인: {formatKoreanReadableWon(Number(inputs.billAmount))}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="billUsage"
                    className="text-base font-extrabold text-[#111827]"
                  >
                    고지서 사용량 (㎥)
                  </label>
                  {autoFilledFields.billUsage && (
                    <span className="text-sm font-bold text-[#155EEF]">
                      자동 입력됨
                    </span>
                  )}
                </div>
                <input
                  id="billUsage"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={inputs.billUsage}
                  onChange={(e) => onInputChange('billUsage', e.target.value)}
                  placeholder="모르면 비워두세요"
                  className={bigNumInputClass('billUsage')}
                />
                <p className="mt-1.5 text-sm text-[#64748B]">
                  비워두면 건물 전체 계량기 사용량으로 자동 계산됩니다
                </p>
              </div>
            </div>
          </section>

          {/* 2) Unit 201 Meter */}
          <section className="bg-white border border-[#DCE3EC] rounded-2xl p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h3 className="text-lg font-extrabold text-[#111827]">
                ② 201호 계량기
              </h3>
              <span className="text-[15px] font-bold text-[#475569] font-mono tabular-nums">
                지난달 {inputs.prev201} → 이번 달 사용:{' '}
                <strong className="text-[#155EEF] text-lg">
                  {inputs.curr201 ? `${formatUsage(calc.u201)}㎥` : '—'}
                </strong>
              </span>
            </div>

            {renderInlinePhotoPreview('meter201', '201호 계량기 사진')}

            <label
              htmlFor="curr201"
              className="block text-sm font-bold text-[#475569] mb-1.5"
            >
              이번 달 201호 계량기 숫자
            </label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                aria-label="201호 숫자 1 줄이기"
                onClick={() => nudgeNumber('curr201', -1)}
                className="min-w-[54px] min-h-[60px] rounded-xl border-2 border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#111827] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                <Minus className="w-6 h-6" />
              </button>
              <input
                id="curr201"
                type="number"
                step="0.1"
                inputMode="decimal"
                value={inputs.curr201}
                onChange={(e) => onInputChange('curr201', e.target.value)}
                placeholder="숫자 입력"
                className={bigNumInputClass('curr201')}
              />
              <button
                type="button"
                aria-label="201호 숫자 1 늘리기"
                onClick={() => nudgeNumber('curr201', 1)}
                className="min-w-[54px] min-h-[60px] rounded-xl border-2 border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#111827] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
          </section>

          {/* 3) Unit 202 Meter */}
          <section className="bg-white border border-[#DCE3EC] rounded-2xl p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h3 className="text-lg font-extrabold text-[#111827]">
                ③ 202호 계량기
              </h3>
              <span className="text-[15px] font-bold text-[#475569] font-mono tabular-nums">
                지난달 {inputs.prev202} → 이번 달 사용:{' '}
                <strong className="text-[#155EEF] text-lg">
                  {inputs.curr202 ? `${formatUsage(calc.u202)}㎥` : '—'}
                </strong>
              </span>
            </div>

            {renderInlinePhotoPreview('meter202', '202호 계량기 사진')}

            <label
              htmlFor="curr202"
              className="block text-sm font-bold text-[#475569] mb-1.5"
            >
              이번 달 202호 계량기 숫자
            </label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                aria-label="202호 숫자 1 줄이기"
                onClick={() => nudgeNumber('curr202', -1)}
                className="min-w-[54px] min-h-[60px] rounded-xl border-2 border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#111827] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                <Minus className="w-6 h-6" />
              </button>
              <input
                id="curr202"
                type="number"
                step="0.1"
                inputMode="decimal"
                value={inputs.curr202}
                onChange={(e) => onInputChange('curr202', e.target.value)}
                placeholder="숫자 입력"
                className={bigNumInputClass('curr202')}
              />
              <button
                type="button"
                aria-label="202호 숫자 1 늘리기"
                onClick={() => nudgeNumber('curr202', 1)}
                className="min-w-[54px] min-h-[60px] rounded-xl border-2 border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#111827] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
          </section>

          {/* 4) Building Total Meter */}
          <section className="bg-white border border-[#DCE3EC] rounded-2xl p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h3 className="text-lg font-extrabold text-[#111827]">
                ④ 건물 전체 계량기
              </h3>
              <span className="text-[15px] font-bold text-[#475569] font-mono tabular-nums">
                지난달 {inputs.prevTotal} → 전체 사용:{' '}
                <strong className="text-[#155EEF] text-lg">
                  {inputs.currTotal ? `${formatUsage(calc.uTot)}㎥` : '—'}
                </strong>
              </span>
            </div>

            {renderInlinePhotoPreview('meterTot', '건물 전체 계량기 사진')}

            <label
              htmlFor="currTotal"
              className="block text-sm font-bold text-[#475569] mb-1.5"
            >
              이번 달 건물 전체 계량기 숫자
            </label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                aria-label="전체 계량기 숫자 1 줄이기"
                onClick={() => nudgeNumber('currTotal', -1)}
                className="min-w-[54px] min-h-[60px] rounded-xl border-2 border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#111827] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                <Minus className="w-6 h-6" />
              </button>
              <input
                id="currTotal"
                type="number"
                step="0.1"
                inputMode="decimal"
                value={inputs.currTotal}
                onChange={(e) => onInputChange('currTotal', e.target.value)}
                placeholder="숫자 입력"
                className={bigNumInputClass('currTotal')}
              />
              <button
                type="button"
                aria-label="전체 계량기 숫자 1 늘리기"
                onClick={() => nudgeNumber('currTotal', 1)}
                className="min-w-[54px] min-h-[60px] rounded-xl border-2 border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#111827] inline-flex items-center justify-center cursor-pointer shrink-0"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
            {/* Conditional Meter Replacement Helper (only appears when currTotal < prevTotal or active) */}
            {((inputs.currTotal.trim() !== '' &&
              Number(inputs.currTotal) < Number(inputs.prevTotal)) ||
              inputs.totalMeterReplaced) && (
              <div
                className={`mt-3 rounded-xl p-3.5 border-2 space-y-2.5 ${
                  inputs.totalMeterReplaced
                    ? 'bg-[#EEF4FF] border-[#93C5FD]'
                    : 'bg-[#FFFAEB] border-[#FCD34D]'
                }`}
              >
                {inputs.totalMeterReplaced ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm sm:text-[15px] font-bold text-[#1048B8] leading-snug">
                      새 계량기 교체 반영됨 · 고지서 사용량(
                      {inputs.billUsage ? `${inputs.billUsage}㎥` : '입력 필요'}
                      )으로 계산하고, 다음 달 기준은 새 지침(
                      {inputs.currTotal || '—'})으로 저장됩니다.
                    </p>
                    <button
                      type="button"
                      onClick={() => onToggleTotalMeterReplaced(false)}
                      className="min-h-[38px] px-3 rounded-lg border border-[#93C5FD] bg-white hover:bg-[#F8FAFC] text-sm font-bold text-[#334155] cursor-pointer shrink-0"
                    >
                      해제
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <p className="text-sm sm:text-[15px] font-bold text-[#93370D] leading-snug">
                      이번 달 숫자가 지난달({inputs.prevTotal})보다 작습니다.
                      건물 전체 계량기를 새것으로 교체하셨나요?
                    </p>
                    <button
                      type="button"
                      onClick={() => onToggleTotalMeterReplaced(true)}
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] text-white text-sm font-extrabold cursor-pointer shrink-0"
                    >
                      네, 새 계량기로 교체했어요
                    </button>
                  </div>
                )}
              </div>
            )}

            {inputs.currTotal && inputs.curr201 && inputs.curr202 && (
              <p className="mt-2.5 text-[15px] font-bold text-[#334155]">
                상가 사용량은 자동으로{' '}
                <span className="text-[#155EEF] font-mono tabular-nums text-lg">
                  {formatUsage(calc.uShop)}㎥
                </span>
                로 계산됩니다.
              </p>
            )}
          </section>

          {/* Collapsible Rarely-Changed Settings (Previous Baselines, Month, Bank Account) */}
          <section className="bg-white border border-[#DCE3EC] rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowExtraSettings((v) => !v)}
              className="w-full min-h-[56px] px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-[#F8FAFC] transition-colors cursor-pointer"
            >
              <div>
                <p className="text-base font-extrabold text-[#334155]">
                  지난달 기준 숫자 · 입금 계좌 · 청구 월 고치기
                </p>
                <p className="text-sm text-[#64748B] mt-0.5">
                  {inputs.monthLabel} · {inputs.accountInfo}
                </p>
              </div>
              {showExtraSettings ? (
                <ChevronUp className="w-5 h-5 text-[#475569] shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[#475569] shrink-0" />
              )}
            </button>

            {showExtraSettings && (
              <div className="p-5 pt-4 border-t border-[#E5EBF2] space-y-4 bg-[#FAFBFD]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="billingYm"
                      className="block text-sm font-bold text-[#334155] mb-1.5"
                    >
                      정산 연월
                    </label>
                    <input
                      id="billingYm"
                      type="month"
                      value={inputs.ym}
                      onChange={(e) => handleYmChange(e.target.value)}
                      className="w-full min-h-[52px] px-3.5 py-2.5 rounded-xl border-2 border-[#CBD5E1] bg-white font-mono tabular-nums text-lg font-bold text-[#111827] focus:outline-none focus:border-[#155EEF]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="monthLabel"
                      className="block text-sm font-bold text-[#334155] mb-1.5"
                    >
                      문자에 들어갈 월 이름
                    </label>
                    <input
                      id="monthLabel"
                      type="text"
                      maxLength={VALIDATION_LIMITS.MONTH_LABEL_MAX_LEN}
                      value={inputs.monthLabel}
                      onChange={(e) =>
                        onInputChange('monthLabel', e.target.value)
                      }
                      className="w-full min-h-[52px] px-3.5 py-2.5 rounded-xl border-2 border-[#CBD5E1] bg-white text-lg font-bold text-[#111827] focus:outline-none focus:border-[#155EEF]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="prevTotal"
                      className="block text-sm font-bold text-[#334155] mb-1.5"
                    >
                      전월 전체
                    </label>
                    <input
                      id="prevTotal"
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={inputs.prevTotal}
                      onChange={(e) => onInputChange('prevTotal', e.target.value)}
                      className="w-full min-h-[50px] px-3 py-2 rounded-xl border-2 border-[#CBD5E1] bg-white font-mono tabular-nums text-lg font-bold text-[#111827] focus:outline-none focus:border-[#155EEF]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="prev201"
                      className="block text-sm font-bold text-[#334155] mb-1.5"
                    >
                      전월 201호
                    </label>
                    <input
                      id="prev201"
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={inputs.prev201}
                      onChange={(e) => onInputChange('prev201', e.target.value)}
                      className="w-full min-h-[50px] px-3 py-2 rounded-xl border-2 border-[#CBD5E1] bg-white font-mono tabular-nums text-lg font-bold text-[#111827] focus:outline-none focus:border-[#155EEF]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="prev202"
                      className="block text-sm font-bold text-[#334155] mb-1.5"
                    >
                      전월 202호
                    </label>
                    <input
                      id="prev202"
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={inputs.prev202}
                      onChange={(e) => onInputChange('prev202', e.target.value)}
                      className="w-full min-h-[50px] px-3 py-2 rounded-xl border-2 border-[#CBD5E1] bg-white font-mono tabular-nums text-lg font-bold text-[#111827] focus:outline-none focus:border-[#155EEF]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="accountInfo"
                    className="block text-sm font-bold text-[#334155] mb-1.5"
                  >
                    입금 계좌 안내
                  </label>
                  <input
                    id="accountInfo"
                    type="text"
                    maxLength={VALIDATION_LIMITS.ACCOUNT_INFO_MAX_LEN}
                    value={inputs.accountInfo}
                    onChange={(e) =>
                      onInputChange('accountInfo', e.target.value)
                    }
                    className="w-full min-h-[52px] px-3.5 py-2.5 rounded-xl border-2 border-[#CBD5E1] bg-white text-base font-bold text-[#111827] focus:outline-none focus:border-[#155EEF]"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Live Settlement Preview & Save Section inside Step 2 */}
          {calc.isReady && (
            <section className="bg-[#ECFDF3] border-2 border-[#86EFAC] rounded-2xl p-5 space-y-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-extrabold text-[#047857]">
                  이번 달 정산 금액 확인
                </h3>
                <span className="font-mono tabular-nums text-[26px] sm:text-[28px] font-extrabold text-[#047857]">
                  합계 {formatWon(calc.finalSum)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { unit: '201호' as UnitKey, u: calc.billedU201, a: calc.a201 },
                  { unit: '202호' as UnitKey, u: calc.billedU202, a: calc.a202 },
                  { unit: '상가' as UnitKey, u: calc.billedUShop, a: calc.aShop },
                ].map((row) => (
                  <div
                    key={row.unit}
                    className="rounded-xl bg-white border border-[#BBF7D0] px-3 py-2.5 text-center"
                  >
                    <p className="text-sm font-extrabold text-[#334155]">
                      {row.unit}
                    </p>
                    <p className="font-mono tabular-nums text-lg sm:text-xl font-extrabold text-[#155EEF] mt-0.5">
                      {formatWon(row.a)}
                    </p>
                    <p className="text-xs font-bold font-mono tabular-nums text-[#64748B]">
                      {formatUsage(row.u)}㎥
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-sm font-semibold text-[#065F46] leading-snug tabular-nums">
                고지서 {formatWon(calc.billAmt)}
                {calc.added > 0
                  ? ` · 부족분 ${formatWon(calc.added)}${calc.addedUsage > 0 ? ` (+${formatUsage(calc.addedUsage)}㎥)` : ''} ${calc.widest} 자동 반영`
                  : ' · 추가 보정 없음'}
              </p>
            </section>
          )}

          {/* Bottom Step Navigation: Save & Move to Send Step */}
          <div className="pt-1 space-y-2.5">
            {calc.isReady ? (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveAndProceedToSend}
                className="w-full min-h-[64px] px-5 py-4 rounded-2xl bg-[#047857] hover:bg-[#065F46] disabled:bg-[#94A3B8] active:scale-[0.99] text-white text-lg sm:text-xl font-extrabold inline-flex items-center justify-center gap-2.5 transition-all cursor-pointer"
              >
                <Save className="w-6 h-6 shrink-0" />
                <span>
                  {saving
                    ? '저장하는 중...'
                    : savedSnapshot
                      ? '저장 완료 · 문자 보내러 가기'
                      : '정산 저장하고 문자 보내기'}
                </span>
                <ArrowRight className="w-6 h-6 shrink-0" />
              </button>
            ) : calc.allZeroUsage ? (
              <div className="rounded-2xl bg-[#FFFAEB] border-2 border-[#F59E0B] p-4 space-y-3">
                <p className="text-[15px] font-extrabold text-[#93370D] text-center leading-snug">
                  사용량이 모두 0㎥여서 저장을 잠시 막아두었어요.
                  <br />
                  이전 달 기준 숫자로 되돌리면 바로 정상 계산됩니다.
                </p>
                {priorBaselineCandidate && (
                  <button
                    type="button"
                    onClick={() => onApplyPrevBaseline(priorBaselineCandidate)}
                    className="w-full min-h-[54px] px-4 py-3 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] active:scale-[0.99] text-white text-base font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RotateCcw className="w-5 h-5 shrink-0" />
                    <span>
                      {priorBaselineCandidate.monthLabel} 기준으로 다시 계산하기
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-xl bg-[#F8FAFC] border border-[#DCE3EC] px-4 py-3 text-center text-[15px] font-bold text-[#475569]">
                남은 칸({missingInputs.join(', ')})을 입력하면 저장 버튼이 열립니다
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="min-h-[52px] px-4 py-3 rounded-xl border-2 border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#111827] text-base font-extrabold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5 shrink-0" />
                <span>이전: 사진</span>
              </button>
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="min-h-[52px] px-4 py-3 rounded-xl border-2 border-[#CBD5E1] bg-white hover:bg-[#EEF4FF] text-[#155EEF] text-base font-extrabold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <span>문자 먼저 보기</span>
                <ArrowRight className="w-5 h-5 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: Dedicated Post-Save Sending Stage (Data Never Disappears on Save!) */}
      {step === 3 && (
        <div className="space-y-4">
          {!activeCalc.isReady ? (
            <div className="bg-white border-2 border-[#F59E0B] rounded-2xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-xl font-extrabold text-[#111827]">
                    {activeCalc.allZeroUsage
                      ? '모든 호실 사용량이 0㎥로 나와서 잠시 멈췄어요'
                      : '아직 빠진 숫자가 있어요'}
                  </h2>
                  {activeCalc.allZeroUsage ? (
                    <p className="text-base text-[#475569] mt-1 leading-relaxed">
                      방금 올린 계량기 숫자가 이미 저장된 지난달 기준 숫자와
                      똑같습니다. 이전 달 기준으로 되돌린 뒤 다시 계산해 주세요.
                    </p>
                  ) : (
                    <>
                      <p className="text-base text-[#475569] mt-1 leading-relaxed">
                        아래 숫자를 입력해야 금액이 계산됩니다:
                      </p>
                      <p className="text-lg font-extrabold text-[#B45309] mt-2">
                        {missingInputs.join(' · ')}
                      </p>
                    </>
                  )}
                </div>
              </div>
              {activeCalc.allZeroUsage && priorBaselineCandidate && (
                <button
                  type="button"
                  onClick={() => {
                    onApplyPrevBaseline(priorBaselineCandidate);
                    goToStep(2);
                  }}
                  className="w-full min-h-[56px] px-4 py-3 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] text-white text-base sm:text-lg font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-5 h-5 shrink-0" />
                  <span>
                    {priorBaselineCandidate.monthLabel} 기준으로 다시 계산하기
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="w-full min-h-[56px] rounded-xl bg-[#111827] hover:bg-[#1E293B] text-white text-lg font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>숫자 확인하러 돌아가기</span>
              </button>
            </div>
          ) : (
            <>
              {/* Top Save Status Banner — keeps all tenant cards visible right below */}
              {savedSnapshot ? (
                <div className="rounded-2xl bg-[#ECFDF3] border-2 border-[#16A34A] p-4 sm:p-5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-6 h-6 text-[#047857] shrink-0" />
                      <h2 className="text-lg sm:text-xl font-extrabold text-[#047857]">
                        {activeMonthLabel} 정산 저장 완료!
                      </h2>
                    </div>
                    <span className="text-sm font-extrabold font-mono tabular-nums text-[#047857]">
                      {doneCount === 3
                        ? '3곳 모두 발송 완료!'
                        : `문자 발송 ${doneCount}/3곳`}
                    </span>
                  </div>
                  <p className="text-[15px] text-[#065F46] leading-relaxed">
                    장부에 안전하게 저장되었어요. 아래 버튼으로 201호 · 202호 ·
                    상가에 문자를 보내주세요.
                    {isCloudSynced
                      ? ' (구글 계정 자동 백업됨)'
                      : ' (이 핸드폰에 저장됨)'}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl bg-[#EEF4FF] border-2 border-[#93C5FD] p-4 sm:p-5 space-y-3">
                  <p className="text-base font-extrabold text-[#1048B8] leading-snug">
                    아직 저장 전이에요. 저장해도 아래 금액과 문자는 사라지지
                    않습니다.
                  </p>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      void onSaveToDb();
                    }}
                    className="w-full min-h-[56px] px-4 py-3 rounded-xl bg-[#047857] hover:bg-[#065F46] disabled:bg-[#94A3B8] text-white text-lg font-extrabold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Save className="w-5 h-5 shrink-0" />
                    <span>
                      {saving
                        ? '저장하는 중...'
                        : '이번 달 정산 기록 저장하기'}
                    </span>
                  </button>
                </div>
              )}

              {activeCalc.warnings.length > 0 && (
                <div
                  role="alert"
                  className="rounded-2xl bg-[#FFFAEB] border-2 border-[#F59E0B] p-4 flex items-start gap-3 text-base text-[#93370D]"
                >
                  <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5 text-[#D97706]" />
                  <div className="space-y-1">
                    {activeCalc.warnings.map((w, idx) => (
                      <p key={idx} className="font-bold leading-snug">
                        {w}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Total Summary Card */}
              <section className="bg-white border-2 border-[#DCE3EC] rounded-2xl p-5 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-extrabold text-[#111827]">
                    {activeMonthLabel} 최종 합계
                  </span>
                  <span className="font-mono tabular-nums text-[28px] sm:text-[30px] font-extrabold text-[#047857]">
                    {formatWon(activeCalc.finalSum)}
                  </span>
                </div>
                <p className="text-[15px] font-semibold text-[#475569] leading-relaxed tabular-nums">
                  고지서 {formatWon(activeCalc.billAmt)} · 기본 합계{' '}
                  {formatWon(activeCalc.baseSum)}
                  {activeCalc.added > 0
                    ? ` · 부족분 ${formatWon(activeCalc.added)}${activeCalc.addedUsage > 0 ? ` (+${formatUsage(activeCalc.addedUsage)}㎥)` : ''}은 ${activeCalc.widest}에 자동 반영됨`
                    : ' · 추가 보정 없음'}
                </p>
              </section>

              {/* Tenant Cards: 201호, 202호, 상가 */}
              <div className="space-y-4">
                {unitRows.map(({ unit, usage, measuredUsage, amount }) => {
                  const msg = getMessageValue(unit);
                  const isCopied = copiedUnit === unit;
                  const isDone = Boolean(doneUnits[unit]);
                  const isEditing = editingUnit === unit;
                  const isAdjusted =
                    activeCalc.added > 0 && activeCalc.widest === unit;
                  const adjustLabel =
                    activeCalc.added > 500 ? '부족분 보정' : '반올림 부족분';

                  return (
                    <section
                      key={unit}
                      className={`bg-white rounded-2xl border-2 p-5 space-y-4 transition-colors ${
                        isDone ? 'border-[#16A34A]' : 'border-[#DCE3EC]'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <div>
                          <div className="flex items-baseline gap-2.5 flex-wrap">
                            <h3 className="text-2xl font-extrabold text-[#111827]">
                              {unit}
                            </h3>
                            <span className="text-base font-bold font-mono tabular-nums text-[#475569]">
                              {formatUsage(usage)}㎥ 사용
                            </span>
                          </div>
                          {isAdjusted && (
                            <p className="text-sm font-bold text-[#155EEF] mt-0.5 tabular-nums">
                              {activeCalc.addedUsage > 0
                                ? `${adjustLabel} +${formatUsage(activeCalc.addedUsage)}㎥ (+${formatWon(activeCalc.added)}) 반영 · 실측 ${formatUsage(measuredUsage)}㎥`
                                : `${adjustLabel} +${formatWon(activeCalc.added)} 포함`}
                            </p>
                          )}
                          {isDone && (
                            <p className="text-sm font-bold text-[#047857] mt-0.5 inline-flex items-center gap-1">
                              <Check className="w-4 h-4" />
                              <span>복사/발송 확인됨</span>
                            </p>
                          )}
                        </div>
                        <span className="font-mono tabular-nums text-[28px] sm:text-[30px] font-extrabold text-[#155EEF] shrink-0">
                          {formatWon(amount)}
                        </span>
                      </div>

                      {/* Message Preview or Edit Box */}
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            rows={4}
                            value={msg}
                            onChange={(e) =>
                              setCustomMessages((prev) => ({
                                ...prev,
                                [unit]: e.target.value,
                              }))
                            }
                            className="w-full p-3.5 rounded-xl border-2 border-[#155EEF] bg-white text-[17px] leading-relaxed text-[#111827] focus:outline-none"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setCustomMessages((prev) => {
                                  const next = { ...prev };
                                  delete next[unit];
                                  return next;
                                })
                              }
                              className="min-h-[40px] px-3 rounded-lg text-sm font-bold text-[#475569] hover:bg-[#F1F5F9] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="w-4 h-4" />
                              <span>원래 문구로</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUnit(null)}
                              className="min-h-[40px] px-4 rounded-lg bg-[#111827] text-white text-sm font-bold cursor-pointer"
                            >
                              수정 완료
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-[#F1F5F9] border border-[#DCE3EC] p-4 space-y-2">
                          <p className="text-[17px] leading-relaxed text-[#111827] whitespace-pre-line font-medium">
                            {msg}
                          </p>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => setEditingUnit(unit)}
                              className="text-sm font-bold text-[#155EEF] hover:underline cursor-pointer"
                            >
                              문구 직접 고치기
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Two Clear Senior-Friendly Send Actions */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleCopy(unit)}
                          className={`w-full min-h-[56px] px-4 py-3 rounded-xl text-base sm:text-lg font-extrabold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                            isCopied
                              ? 'bg-[#047857] text-white'
                              : 'bg-[#111827] hover:bg-[#1E293B] text-white'
                          }`}
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-5 h-5 shrink-0" />
                              <span>복사 완료! (카톡 붙여넣기)</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-5 h-5 shrink-0" />
                              <span>{unit} 문자 복사 (카톡용)</span>
                            </>
                          )}
                        </button>

                        <a
                          href={`sms:?&body=${encodeURIComponent(msg)}`}
                          onClick={() => handleSmsClick(unit)}
                          className="w-full min-h-[56px] px-4 py-3 rounded-xl border-2 border-[#155EEF] bg-[#EEF4FF] hover:bg-[#DCE8FF] text-[#1048B8] text-base sm:text-lg font-extrabold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                        >
                          <MessageSquare className="w-5 h-5 shrink-0" />
                          <span>문자 앱 바로 열기</span>
                        </a>
                      </div>
                    </section>
                  );
                })}
              </div>

              {/* Bottom Actions: Back to Edit or Explicitly Start Fresh Next Month */}
              <div className="pt-2 space-y-2.5">
                {savedSnapshot && (
                  <button
                    type="button"
                    onClick={() => {
                      onStartNewSettlement();
                      setDoneUnits({});
                      setCustomMessages({});
                      goToStep(1);
                    }}
                    className="w-full min-h-[56px] px-5 py-3.5 rounded-2xl bg-[#111827] hover:bg-[#1E293B] text-white text-lg font-extrabold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-5 h-5 shrink-0" />
                    <span>다 보냈어요 · 새 정산 시작하기</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  className="w-full min-h-[52px] px-4 py-3 rounded-xl border-2 border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#334155] text-base font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                  <span>숫자 다시 확인하러 가기</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

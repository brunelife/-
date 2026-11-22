import { useEffect, useState } from 'react';
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
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
} from 'lucide-react';
import {
  VALIDATION_LIMITS,
  type PhotoKind,
  type PhotoUploadState,
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
  justSaved: boolean;
  isCloudSynced: boolean;
  onInputChange: (field: keyof SettlementInputs, value: string) => void;
  onPhotoSelect: (kind: PhotoKind, file: File) => void;
  onPhotoClear: (kind: PhotoKind) => void;
  onPhotoRotate: (kind: PhotoKind) => void;
  onPhotoZoom: (url: string, title: string) => void;
  onClearCurrentMonth: () => void;
  onSaveToDb: () => void;
  onResetSavedFlag: () => void;
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
  justSaved,
  isCloudSynced,
  onInputChange,
  onPhotoSelect,
  onPhotoClear,
  onPhotoRotate,
  onPhotoZoom,
  onClearCurrentMonth,
  onSaveToDb,
  onResetSavedFlag,
  onCopyFeedback,
}: SettlementTabProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [showExtraSettings, setShowExtraSettings] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitKey | null>(null);
  const [customMessages, setCustomMessages] = useState<
    Partial<Record<UnitKey, string>>
  >({});
  const [copiedUnit, setCopiedUnit] = useState<UnitKey | null>(null);
  const [doneUnits, setDoneUnits] = useState<Partial<Record<UnitKey, boolean>>>(
    {}
  );

  const autoMessages = buildUnitMessages(
    inputs.monthLabel,
    inputs.accountInfo,
    calc
  );

  useEffect(() => {
    setCustomMessages({});
  }, [
    inputs.monthLabel,
    inputs.accountInfo,
    calc.u201,
    calc.u202,
    calc.uShop,
    calc.a201,
    calc.a202,
    calc.aShop,
  ]);

  const goToStep = (next: WizardStep) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    amount: number;
  }> = [
    { unit: '201호', usage: calc.u201, amount: calc.a201 },
    { unit: '202호', usage: calc.u202, amount: calc.a202 },
    { unit: '상가', usage: calc.uShop, amount: calc.aShop },
  ];

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
            title: '2. 숫자 확인',
            sub: calc.isReady ? '입력 완료' : `${4 - missingInputs.length}/4칸`,
          },
          {
            num: 3 as WizardStep,
            title: '3. 문자·저장',
            sub: calc.isReady ? formatWon(calc.finalSum) : '대기 중',
          },
        ].map((item) => {
          const isActive = step === item.num;
          const isCompleted =
            (item.num === 1 && takenPhotoCount > 0 && step > 1) ||
            (item.num === 2 && calc.isReady && step > 2);

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
              <span>다음: 숫자 맞는지 확인하기</span>
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

          {calc.warnings.length > 0 && (
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

          {/* Bottom Step Navigation */}
          <div className="pt-2 grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="col-span-1 min-h-[60px] px-4 py-3.5 rounded-2xl border-2 border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#111827] text-base sm:text-lg font-extrabold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 shrink-0" />
              <span>이전</span>
            </button>
            <button
              type="button"
              onClick={() => goToStep(3)}
              className="col-span-2 min-h-[60px] px-5 py-3.5 rounded-2xl bg-[#155EEF] hover:bg-[#1048B8] active:scale-[0.99] text-white text-lg sm:text-xl font-extrabold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>다음: 금액 확인 · 문자 보내기</span>
              <ArrowRight className="w-6 h-6 shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Clear Amounts, Send SMS / Copy for KakaoTalk, and Save */}
      {step === 3 && (
        <div className="space-y-4">
          {justSaved && (
            <div className="rounded-2xl bg-[#ECFDF3] border-2 border-[#16A34A] p-5 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-7 h-7 text-[#047857] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-xl font-extrabold text-[#047857]">
                    이번 달 정산 저장이 끝났어요!
                  </h2>
                  <p className="text-base text-[#065F46] mt-1 leading-relaxed">
                    기록이 안전하게 보관되었고, 다음 달에 쓸 기준 숫자도 자동으로
                    바뀌었습니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetSavedFlag();
                  setDoneUnits({});
                  goToStep(1);
                }}
                className="w-full min-h-[52px] rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-base font-extrabold cursor-pointer"
              >
                처음 화면으로 돌아가기
              </button>
            </div>
          )}

          {!calc.isReady && !justSaved ? (
            <div className="bg-white border-2 border-[#F59E0B] rounded-2xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-7 h-7 text-[#D97706] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-xl font-extrabold text-[#111827]">
                    아직 빠진 숫자가 있어요
                  </h2>
                  <p className="text-base text-[#475569] mt-1 leading-relaxed">
                    아래 숫자를 입력해야 금액이 계산됩니다:
                  </p>
                  <p className="text-lg font-extrabold text-[#B45309] mt-2">
                    {missingInputs.join(' · ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="w-full min-h-[56px] rounded-xl bg-[#155EEF] hover:bg-[#1048B8] text-white text-lg font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>숫자 입력하러 돌아가기</span>
              </button>
            </div>
          ) : (
            calc.isReady && (
              <>
                {calc.warnings.length > 0 && (
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

                {/* Total Summary Card */}
                <section className="bg-[#ECFDF3] border-2 border-[#86EFAC] rounded-2xl p-5 space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-extrabold text-[#047857]">
                      이번 달 최종 합계
                    </span>
                    <span className="font-mono tabular-nums text-[30px] font-extrabold text-[#047857]">
                      {formatWon(calc.finalSum)}
                    </span>
                  </div>
                  <p className="text-[15px] font-semibold text-[#065F46] leading-relaxed tabular-nums">
                    고지서 {formatWon(calc.billAmt)} · 기본 합계{' '}
                    {formatWon(calc.baseSum)}
                    {calc.added > 0
                      ? ` · 부족분 ${formatWon(calc.added)}은 ${calc.widest}에 자동 포함됨`
                      : ' · 추가 보정 없음'}
                  </p>
                </section>

                {/* Tenant Cards: 201호, 202호, 상가 */}
                <div className="space-y-4">
                  {unitRows.map(({ unit, usage, amount }) => {
                    const msg = getMessageValue(unit);
                    const isCopied = copiedUnit === unit;
                    const isDone = Boolean(doneUnits[unit]);
                    const isEditing = editingUnit === unit;
                    const isAdjusted = calc.added > 0 && calc.widest === unit;

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
                                반올림 부족분 +{formatWon(calc.added)} 포함
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

                {/* Final Save Section */}
                <section className="bg-white border-2 border-[#047857] rounded-2xl p-5 space-y-3">
                  <p className="text-base font-bold text-[#111827] text-center">
                    문자를 다 보내셨으면 아래 초록 버튼을 꼭 눌러 저장하세요
                  </p>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={onSaveToDb}
                    className="w-full min-h-[62px] px-5 py-4 rounded-2xl bg-[#047857] hover:bg-[#065F46] disabled:bg-[#94A3B8] text-white text-xl font-extrabold inline-flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Save className="w-6 h-6 shrink-0" />
                    <span>
                      {saving
                        ? '저장하는 중...'
                        : '이번 달 정산 기록 저장하기'}
                    </span>
                  </button>
                  <p className="text-sm text-center text-[#475569] leading-snug">
                    저장하면 다음 달에 쓸 지난달 계량기 숫자가 자동으로 바뀝니다.
                    <br />
                    {isCloudSynced
                      ? '구글 계정에 안전하게 보관됩니다.'
                      : '지금은 이 핸드폰에만 저장됩니다 (위에서 로그인하면 자동 백업).'}
                  </p>
                </section>

                {/* Back Button */}
                <button
                  type="button"
                  onClick={() => goToStep(2)}
                  className="w-full min-h-[52px] px-4 py-3 rounded-xl border-2 border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#334155] text-base font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                  <span>숫자 다시 고치러 가기</span>
                </button>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}

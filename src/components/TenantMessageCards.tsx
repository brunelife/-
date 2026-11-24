import { useEffect, useState } from 'react';
import { Check, Copy, MessageSquare, RotateCcw } from 'lucide-react';
import type { SettlementCalculation, UnitKey } from '../types/billing';
import {
  buildUnitMessages,
  formatUsage,
  formatWon,
} from '../utils/billingMath';

interface TenantMessageCardsProps {
  monthLabel: string;
  accountInfo: string;
  calc: SettlementCalculation;
  doneUnits: Partial<Record<UnitKey, boolean>>;
  onMarkDone: (unit: UnitKey) => void;
  onCopyFeedback: (msg: string) => void;
}

export function TenantMessageCards({
  monthLabel,
  accountInfo,
  calc,
  doneUnits,
  onMarkDone,
  onCopyFeedback,
}: TenantMessageCardsProps) {
  const [editingUnit, setEditingUnit] = useState<UnitKey | null>(null);
  const [customMessages, setCustomMessages] = useState<
    Partial<Record<UnitKey, string>>
  >({});
  const [copiedUnit, setCopiedUnit] = useState<UnitKey | null>(null);

  const autoMessages = buildUnitMessages(monthLabel, accountInfo, calc);

  useEffect(() => {
    setCustomMessages({});
    setEditingUnit(null);
  }, [
    monthLabel,
    accountInfo,
    calc.billedU201,
    calc.billedU202,
    calc.billedUShop,
    calc.a201,
    calc.a202,
    calc.aShop,
  ]);

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
    onMarkDone(unit);
    onCopyFeedback(`${unit} 문자를 복사했어요! 카톡이나 문자에 붙여넣기 하세요.`);
    window.setTimeout(() => {
      setCopiedUnit((prev) => (prev === unit ? null : prev));
    }, 2000);
  };

  const unitRows: Array<{
    unit: UnitKey;
    usage: number;
    measuredUsage: number;
    amount: number;
  }> = [
    {
      unit: '201호',
      usage: calc.billedU201,
      measuredUsage: calc.u201,
      amount: calc.a201,
    },
    {
      unit: '202호',
      usage: calc.billedU202,
      measuredUsage: calc.u202,
      amount: calc.a202,
    },
    {
      unit: '상가',
      usage: calc.billedUShop,
      measuredUsage: calc.uShop,
      amount: calc.aShop,
    },
  ];

  return (
    <>
      {/* Total Summary Card */}
      <section className="bg-white border-2 border-[#DCE3EC] rounded-2xl p-5 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg font-extrabold text-[#111827]">
            {monthLabel} 최종 합계
          </span>
          <span className="font-mono tabular-nums text-[28px] sm:text-[30px] font-extrabold text-[#047857]">
            {formatWon(calc.finalSum)}
          </span>
        </div>
        <p className="text-[15px] font-semibold text-[#475569] leading-relaxed tabular-nums">
          고지서 {formatWon(calc.billAmt)} · 기본 합계 {formatWon(calc.baseSum)}
          {calc.added > 0
            ? ` · 부족분 ${formatWon(calc.added)}${calc.addedUsage > 0 ? ` (+${formatUsage(calc.addedUsage)}㎥)` : ''}은 ${calc.widest}에 자동 반영됨`
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
          const isAdjusted = calc.added > 0 && calc.widest === unit;
          const adjustLabel =
            calc.added > 500 ? '부족분 보정' : '반올림 부족분';

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
                      {calc.addedUsage > 0
                        ? `${adjustLabel} +${formatUsage(calc.addedUsage)}㎥ (+${formatWon(calc.added)}) 반영 · 실측 ${formatUsage(measuredUsage)}㎥`
                        : `${adjustLabel} +${formatWon(calc.added)} 포함`}
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
                  onClick={() => onMarkDone(unit)}
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
    </>
  );
}

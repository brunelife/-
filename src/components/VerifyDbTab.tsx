import { useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { BillingRecord, UnitKey } from '../types/billing';
import {
  computeStats,
  exportRecordsAsCsv,
  exportRecordsAsJson,
  formatUsage,
} from '../utils/billingMath';

interface VerifyDbTabProps {
  records: BillingRecord[];
  loading: boolean;
  onDeleteRecord: (record: BillingRecord) => void;
  onRequestReset: () => void;
}

const UNIT_ORDER: UnitKey[] = ['201호', '202호', '상가'];

export function VerifyDbTab({
  records,
  loading,
  onDeleteRecord,
  onRequestReset,
}: VerifyDbTabProps) {
  const [selectedYear, setSelectedYear] = useState<string>('전체');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortDesc, setSortDesc] = useState<boolean>(true);

  const { stats, widest } = useMemo(() => computeStats(records), [records]);

  const years = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      const y = r.ym.slice(0, 4);
      if (/^\d{4}$/.test(y)) set.add(y);
    });
    return ['전체', ...Array.from(set).sort((a, b) => b.localeCompare(a))];
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return records
      .filter((r) => r.finalAmtSum !== null)
      .filter((r) =>
        selectedYear === '전체' ? true : r.ym.startsWith(selectedYear)
      )
      .filter((r) => {
        if (!q) return true;
        return (
          r.ym.toLowerCase().includes(q) ||
          (r.adjustmentTarget && r.adjustmentTarget.toLowerCase().includes(q)) ||
          r.monthLabel.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        sortDesc ? b.ym.localeCompare(a.ym) : a.ym.localeCompare(b.ym)
      );
  }, [records, selectedYear, searchTerm, sortDesc]);

  const chartRecords = useMemo(() => {
    return records
      .filter((r) => r.usageTotal > 0)
      .slice()
      .sort((a, b) => a.ym.localeCompare(b.ym))
      .slice(-12);
  }, [records]);

  const maxChartUsage = useMemo(() => {
    let m = 10;
    for (const r of chartRecords) {
      m = Math.max(m, r.usage201, r.usage202, r.usageShop);
    }
    return Math.ceil(m / 5) * 5;
  }, [chartRecords]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Standard Deviation Audit Strip */}
      <section className="bg-white border border-[#DCE3EC] rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-[#111827] tracking-tight">
              부족분 보정 기준 (자동 계산)
            </h2>
            <p className="text-[15px] text-[#475569] mt-1 leading-relaxed">
              매달 사용량 변화 폭이 가장 큰 입주처에 500원 반올림 부족분을 자동으로 더합니다.
            </p>
          </div>
          <p className="text-base font-extrabold text-[#155EEF] whitespace-nowrap">
            현재 보정 대상: {widest}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#E5EBF2] border border-[#DCE3EC] rounded-xl bg-[#FAFBFD]">
          {UNIT_ORDER.map((unit) => {
            const s = stats[unit];
            const isWidest = unit === widest;
            return (
              <div
                key={unit}
                className={`p-4 sm:p-5 ${
                  isWidest ? 'bg-[#EEF4FF]/70' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-extrabold text-[#111827]">
                    {unit}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      isWidest ? 'text-[#155EEF]' : 'text-[#64748B]'
                    }`}
                  >
                    {isWidest ? '보정 대상' : `${s.n}개월 기록`}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className={`font-mono tabular-nums text-3xl font-extrabold ${
                      isWidest ? 'text-[#155EEF]' : 'text-[#111827]'
                    }`}
                  >
                    {s.std.toFixed(2)}
                  </span>
                  <span className="text-sm font-semibold text-[#475569]">
                    ㎥ (표준편차)
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-[#475569] font-mono tabular-nums">
                  월평균 {s.mean.toFixed(1)}㎥ · {s.n}개월 누적
                </p>
              </div>
            );
          })}
        </div>

        {/* Recent 12 Months Usage Comparison Bar Chart */}
        {chartRecords.length > 0 && (
          <div className="mt-6 pt-5 border-t border-[#E5EBF2]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-base font-bold text-[#111827]">
                최근 {chartRecords.length}개월 입주별 사용량 (㎥)
              </h3>
              <div className="flex items-center gap-4 text-sm font-semibold text-[#475569]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-[#155EEF]" />
                  <span>201호</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-[#0EA5E9]" />
                  <span>202호</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-[#1D2939]" />
                  <span>상가</span>
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <svg
                  viewBox={`0 0 ${chartRecords.length * 60 + 36} 170`}
                  className="w-full h-44"
                  role="img"
                  aria-label="최근 12개월 입주별 수도 사용량 막대 그래프"
                >
                  {[0, 0.5, 1].map((ratio) => {
                    const y = 132 - ratio * 112;
                    const labelVal = Math.round(maxChartUsage * ratio);
                    return (
                      <g key={ratio}>
                        <line
                          x1={32}
                          x2={chartRecords.length * 60 + 30}
                          y1={y}
                          y2={y}
                          stroke="#E5EBF2"
                          strokeWidth="1"
                        />
                        <text
                          x={26}
                          y={y + 4}
                          textAnchor="end"
                          fill="#64748B"
                          fontSize="11"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {labelVal}
                        </text>
                      </g>
                    );
                  })}

                  {chartRecords.map((r, i) => {
                    const gx = 42 + i * 60;
                    const h201 = Math.max(2, (r.usage201 / maxChartUsage) * 112);
                    const h202 = Math.max(2, (r.usage202 / maxChartUsage) * 112);
                    const hShop = Math.max(
                      2,
                      (Math.max(0, r.usageShop) / maxChartUsage) * 112
                    );
                    return (
                      <g key={r.id}>
                        <rect
                          x={gx}
                          y={132 - h201}
                          width={11}
                          height={h201}
                          rx={2}
                          fill="#155EEF"
                        >
                          <title>{`${r.ym} 201호: ${formatUsage(r.usage201)}㎥`}</title>
                        </rect>
                        <rect
                          x={gx + 13}
                          y={132 - h202}
                          width={11}
                          height={h202}
                          rx={2}
                          fill="#0EA5E9"
                        >
                          <title>{`${r.ym} 202호: ${formatUsage(r.usage202)}㎥`}</title>
                        </rect>
                        <rect
                          x={gx + 26}
                          y={132 - hShop}
                          width={11}
                          height={hShop}
                          rx={2}
                          fill="#1D2939"
                        >
                          <title>{`${r.ym} 상가: ${formatUsage(r.usageShop)}㎥`}</title>
                        </rect>
                        <text
                          x={gx + 18}
                          y={152}
                          textAnchor="middle"
                          fill="#475569"
                          fontSize="11"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {r.ym.slice(2)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Cumulative Ledger Table */}
      <section className="bg-white border border-[#DCE3EC] rounded-2xl overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-[#E5EBF2] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold text-[#111827] tracking-tight">
                지난 정산 장부 ({filteredRecords.length}건)
              </h2>
              <p className="text-[15px] text-[#475569] mt-0.5">
                2021년 5월부터 저장된 월별 수도세 정산 내역입니다
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => exportRecordsAsCsv(records)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#EEF4FF] hover:bg-[#DCE8FF] text-[#1048B8] text-sm font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>엑셀 파일 받기</span>
              </button>
              <button
                type="button"
                onClick={() => exportRecordsAsJson(records)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F5F7FA] text-[#334155] text-sm font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>백업 파일(JSON)</span>
              </button>
              <button
                type="button"
                onClick={onRequestReset}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#FEF2F2] hover:border-[#FECACA] hover:text-[#B91C1C] text-[#475569] text-sm font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>초기 장부 복원</span>
              </button>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-[#F1F5F9] rounded-xl overflow-x-auto">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setSelectedYear(y)}
                  className={`min-h-[42px] px-3.5 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedYear === y
                      ? 'bg-white text-[#111827] shadow-xs'
                      : 'text-[#475569] hover:text-[#111827]'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="연월 검색 (예: 2024-03)"
                className="w-full min-h-[46px] pl-10 pr-3.5 py-2 rounded-xl border border-[#CBD5E1] bg-[#FAFBFD] text-[15px] text-[#111827] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#155EEF] focus:bg-white"
              />
            </div>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-12 rounded-lg bg-[#F1F5F9] animate-pulse"
              />
            ))}
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-lg font-bold text-[#111827]">
              조건에 맞는 기록이 없습니다
            </p>
            <p className="text-base text-[#475569]">
              연도를 &lsquo;전체&rsquo;로 누르거나 검색어를 지워보세요.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[540px]">
            <table className="w-full border-collapse text-[15px]">
              <thead className="sticky top-0 z-10 bg-[#F5F7FA] border-b border-[#DCE3EC] text-[#334155]">
                <tr>
                  <th className="py-3.5 px-4 text-left font-extrabold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSortDesc((v) => !v)}
                      className="inline-flex items-center gap-1 hover:text-[#155EEF] cursor-pointer"
                    >
                      <span>연월</span>
                      <span className="text-xs text-[#64748B]">
                        {sortDesc ? '↓' : '↑'}
                      </span>
                    </button>
                  </th>
                  <th className="py-3.5 px-4 text-right font-extrabold whitespace-nowrap">
                    고지서 (원)
                  </th>
                  <th className="py-3.5 px-4 text-right font-extrabold whitespace-nowrap">
                    201 / 202 / 상가 (㎥)
                  </th>
                  <th className="py-3.5 px-4 text-right font-extrabold whitespace-nowrap">
                    보정대상
                  </th>
                  <th className="py-3.5 px-4 text-right font-extrabold whitespace-nowrap">
                    가산액 (원)
                  </th>
                  <th className="py-3.5 px-4 text-right font-extrabold whitespace-nowrap">
                    최종합계 (원)
                  </th>
                  <th className="py-3.5 px-3 text-right font-extrabold whitespace-nowrap">
                    삭제
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EBF2] font-mono tabular-nums">
                {filteredRecords.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-[#F8FAFC] transition-colors"
                  >
                    <td className="py-3.5 px-4 text-left font-bold text-[#111827] whitespace-nowrap">
                      <span>{r.ym}</span>
                      {!r.isBaseRecord && (
                        <span className="ml-2 font-sans text-xs font-extrabold text-[#155EEF]">
                          신규
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right text-[#334155] whitespace-nowrap">
                      {r.billAmount != null
                        ? r.billAmount.toLocaleString('ko-KR')
                        : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right text-[#334155] whitespace-nowrap">
                      {formatUsage(r.usage201)} / {formatUsage(r.usage202)} /{' '}
                      {formatUsage(r.usageShop)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-sans font-bold text-[#334155] whitespace-nowrap">
                      {r.adjustmentTarget ?? '—'}
                    </td>
                    <td
                      className={`py-3.5 px-4 text-right whitespace-nowrap ${
                        (r.addedAmount ?? 0) > 0
                          ? 'text-[#155EEF] font-bold'
                          : 'text-[#64748B]'
                      }`}
                    >
                      {r.addedAmount != null
                        ? r.addedAmount > 0
                          ? `+${r.addedAmount.toLocaleString('ko-KR')}`
                          : '0'
                        : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-extrabold text-[#111827] whitespace-nowrap">
                      {r.finalAmtSum != null
                        ? r.finalAmtSum.toLocaleString('ko-KR')
                        : '—'}
                    </td>
                    <td className="py-3.5 px-3 text-right whitespace-nowrap">
                      {!r.isBaseRecord ? (
                        <button
                          type="button"
                          onClick={() => onDeleteRecord(r)}
                          aria-label={`${r.ym} 기록 삭제`}
                          className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <span className="font-sans text-xs text-[#94A3B8]">
                          기본
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

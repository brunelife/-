import type {
  BillingRecord,
  SettlementCalculation,
  SettlementInputs,
  StatsSummary,
  UnitKey,
  UnitStat,
} from '../types/billing';

export function mround500(val: number): number {
  return Math.round(val / 500) * 500;
}

export function ceil500(val: number): number {
  return Math.ceil(val / 500) * 500;
}

export function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export function formatWon(val: number): string {
  return `${Math.round(val).toLocaleString('ko-KR')}원`;
}

export function formatKoreanReadableWon(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '';
  const rounded = Math.round(val);
  const man = Math.floor(rounded / 10000);
  const rest = rounded % 10000;
  if (man === 0) return `${rest.toLocaleString('ko-KR')}원`;
  if (rest === 0) return `${man.toLocaleString('ko-KR')}만 원`;
  return `${man.toLocaleString('ko-KR')}만 ${rest.toLocaleString('ko-KR')}원`;
}

export function formatUsage(val: number): string {
  if (!Number.isFinite(val)) return '0';
  const rounded = round1(val);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function getCurrentYm(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? String(new Date().getFullYear());
  const m = parts.find((p) => p.type === 'month')?.value ?? String(new Date().getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function ymToKoreanLabel(ym: string): string {
  const match = ym.match(/^(\d{4})-(\d{2})$/);
  if (!match) return '이번 달';
  return `${match[1]}년 ${Number(match[2])}월`;
}

export function computeStats(records: BillingRecord[]): StatsSummary {
  const pools: Record<UnitKey, number[]> = {
    '201호': [],
    '202호': [],
    '상가': [],
  };

  for (const r of records) {
    if (
      r.usage201 != null &&
      r.usage202 != null &&
      r.usageShop != null &&
      r.usageTotal > 0
    ) {
      pools['201호'].push(Number(r.usage201));
      pools['202호'].push(Number(r.usage202));
      pools['상가'].push(Number(r.usageShop));
    }
  }

  const stats = {} as Record<UnitKey, UnitStat>;
  (Object.keys(pools) as UnitKey[]).forEach((k) => {
    const arr = pools[k];
    const n = arr.length;
    const mean = n ? arr.reduce((a, b) => a + b, 0) / n : 0;
    const variance =
      n > 1
        ? arr.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1)
        : 0;
    stats[k] = { n, mean, std: Math.sqrt(variance) };
  });

  let widest: UnitKey = '상가';
  let maxStd = -1;
  (Object.keys(stats) as UnitKey[]).forEach((k) => {
    if (stats[k].std > maxStd) {
      maxStd = stats[k].std;
      widest = k;
    }
  });

  return { stats, widest };
}

export function calculateSettlement(
  inputs: SettlementInputs,
  records: BillingRecord[]
): SettlementCalculation {
  const billAmt = Number(inputs.billAmount);
  const billVol = Number(inputs.billUsage);
  const prevTot = Number(inputs.prevTotal);
  const currTot = Number(inputs.currTotal);
  const prev201 = Number(inputs.prev201);
  const curr201 = Number(inputs.curr201);
  const prev202 = Number(inputs.prev202);
  const curr202 = Number(inputs.curr202);

  const hasCurrTot = inputs.currTotal.trim() !== '' && Number.isFinite(currTot);
  const hasCurr201 = inputs.curr201.trim() !== '' && Number.isFinite(curr201);
  const hasCurr202 = inputs.curr202.trim() !== '' && Number.isFinite(curr202);

  const meterReplacedApplied = Boolean(
    inputs.totalMeterReplaced && hasCurrTot && Number.isFinite(billVol) && billVol > 0
  );

  const uTot = meterReplacedApplied
    ? round1(billVol)
    : hasCurrTot && Number.isFinite(prevTot)
      ? round1(currTot - prevTot)
      : 0;
  const u201 = hasCurr201 && Number.isFinite(prev201) ? round1(curr201 - prev201) : 0;
  const u202 = hasCurr202 && Number.isFinite(prev202) ? round1(curr202 - prev202) : 0;
  const uShop = hasCurrTot && hasCurr201 && hasCurr202 ? round1(uTot - (u201 + u202)) : 0;

  const priorRecords = inputs.ym
    ? records.filter((r) => r.ym < inputs.ym)
    : records;
  const { widest } = computeStats(
    priorRecords.length > 0 ? priorRecords : records
  );

  const allZeroUsage =
    hasCurrTot &&
    hasCurr201 &&
    hasCurr202 &&
    uTot === 0 &&
    u201 === 0 &&
    u202 === 0 &&
    Number.isFinite(billAmt) &&
    billAmt > 0;

  const baseVol = billVol > 0 ? billVol : uTot;
  const isReady =
    inputs.billAmount.trim() !== '' &&
    billAmt > 0 &&
    hasCurrTot &&
    hasCurr201 &&
    hasCurr202 &&
    baseVol > 0 &&
    !allZeroUsage &&
    Number.isFinite(u201) &&
    Number.isFinite(u202) &&
    Number.isFinite(uShop);

  const warnings: string[] = [];
  if (allZeroUsage) {
    warnings.push(
      '이번 달 계량기 숫자 3개가 지난달 기준 숫자와 모두 똑같아 사용량이 전부 0㎥로 계산되었습니다. 이미 저장된 기록이거나 지난달 기준 숫자가 바뀌었는지 확인해 주세요.'
    );
  }
  if (inputs.totalMeterReplaced && (!Number.isFinite(billVol) || billVol <= 0)) {
    warnings.push(
      '계량기 교체 정산은 고지서 사용량(㎥)이 필요합니다. 위 ①번 칸에 고지서 사용량을 입력해 주세요.'
    );
  }
  if (
    (!inputs.totalMeterReplaced && hasCurrTot && currTot < prevTot) ||
    (hasCurr201 && curr201 < prev201) ||
    (hasCurr202 && curr202 < prev202)
  ) {
    warnings.push(
      '당월 계량기 숫자가 전월 기준값보다 작습니다. 새 계량기로 교체된 경우 아래에서 「새 계량기 교체」를 선택하거나 숫자를 다시 확인해 주세요.'
    );
  }
  if (hasCurrTot && hasCurr201 && hasCurr202 && uShop < 0) {
    warnings.push(
      `상가 사용량이 음수(${formatUsage(uShop)}㎥)로 계산되었습니다. 전체·201호·202호 계량기 숫자를 확인해 주세요.`
    );
  }
  if (
    !allZeroUsage &&
    !meterReplacedApplied &&
    billVol > 0 &&
    hasCurrTot &&
    Math.abs(billVol - uTot) >= 5
  ) {
    warnings.push(
      `고지서 사용량(${formatUsage(billVol)}㎥)과 건물 전체 계량기 사용량(${formatUsage(uTot)}㎥)의 차이가 ${formatUsage(Math.abs(billVol - uTot))}㎥입니다.`
    );
  }

  if (!isReady) {
    return {
      isReady: false,
      allZeroUsage,
      uTot,
      u201,
      u202,
      uShop,
      billedU201: u201,
      billedU202: u202,
      billedUShop: uShop,
      addedUsage: 0,
      billAmt: Number.isFinite(billAmt) ? billAmt : 0,
      baseVol: Number.isFinite(baseVol) ? baseVol : 0,
      unitPrice: 0,
      base201: 0,
      base202: 0,
      baseShop: 0,
      a201: 0,
      a202: 0,
      aShop: 0,
      baseSum: 0,
      shortfall: 0,
      widest,
      added: 0,
      finalSum: 0,
      warnings,
      currTot: hasCurrTot ? currTot : 0,
      curr201: hasCurr201 ? curr201 : 0,
      curr202: hasCurr202 ? curr202 : 0,
      meterReplacedApplied,
    };
  }

  const unitPrice = billAmt / baseVol;
  const base201 = mround500(unitPrice * u201);
  const base202 = mround500(unitPrice * u202);
  const baseShop = mround500(unitPrice * uShop);

  let a201 = base201;
  let a202 = base202;
  let aShop = baseShop;

  const baseSum = base201 + base202 + baseShop;
  const shortfall = billAmt - baseSum;
  let added = 0;

  let billedU201 = u201;
  let billedU202 = u202;
  let billedUShop = uShop;
  let addedUsage = 0;

  if (shortfall > 0) {
    added = ceil500(shortfall);
    if (widest === '201호') {
      a201 += added;
      if (unitPrice > 0) {
        const targetU = Math.max(u201, round1(a201 / unitPrice));
        addedUsage = round1(targetU - u201);
        billedU201 = targetU;
      }
    } else if (widest === '202호') {
      a202 += added;
      if (unitPrice > 0) {
        const targetU = Math.max(u202, round1(a202 / unitPrice));
        addedUsage = round1(targetU - u202);
        billedU202 = targetU;
      }
    } else {
      aShop += added;
      if (unitPrice > 0) {
        const targetU = Math.max(uShop, round1(aShop / unitPrice));
        addedUsage = round1(targetU - uShop);
        billedUShop = targetU;
      }
    }
  }

  const finalSum = a201 + a202 + aShop;

  return {
    isReady: true,
    allZeroUsage: false,
    uTot,
    u201,
    u202,
    uShop,
    billedU201,
    billedU202,
    billedUShop,
    addedUsage,
    billAmt,
    baseVol,
    unitPrice,
    base201,
    base202,
    baseShop,
    a201,
    a202,
    aShop,
    baseSum,
    shortfall,
    widest,
    added,
    finalSum,
    warnings,
    currTot,
    curr201,
    curr202,
    meterReplacedApplied,
  };
}

export function buildCalculationFromRecord(
  record: BillingRecord
): SettlementCalculation {
  const billAmt = record.billAmount ?? 0;
  const uTot = record.usageTotal;
  const u201 = record.usage201;
  const u202 = record.usage202;
  const uShop = record.usageShop;
  const baseVol =
    record.billUsage != null && record.billUsage > 0 ? record.billUsage : uTot;

  const isReady = billAmt > 0 && baseVol > 0;
  const widest: UnitKey = record.adjustmentTarget ?? '상가';

  if (!isReady) {
    return {
      isReady: false,
      allZeroUsage: false,
      uTot,
      u201,
      u202,
      uShop,
      billedU201: u201,
      billedU202: u202,
      billedUShop: uShop,
      addedUsage: 0,
      billAmt,
      baseVol,
      unitPrice: 0,
      base201: 0,
      base202: 0,
      baseShop: 0,
      a201: 0,
      a202: 0,
      aShop: 0,
      baseSum: 0,
      shortfall: 0,
      widest,
      added: 0,
      finalSum: record.finalAmtSum ?? 0,
      warnings: [],
      currTot: record.currTotal ?? 0,
      curr201: record.curr201 ?? 0,
      curr202: record.curr202 ?? 0,
      meterReplacedApplied: false,
    };
  }

  const unitPrice = billAmt / baseVol;
  const base201 = mround500(unitPrice * u201);
  const base202 = mround500(unitPrice * u202);
  const baseShop = mround500(unitPrice * uShop);
  const baseSum = base201 + base202 + baseShop;
  const shortfall = billAmt - baseSum;

  const added =
    record.addedAmount !== null
      ? record.addedAmount
      : shortfall > 0
        ? ceil500(shortfall)
        : 0;

  let a201 = base201;
  let a202 = base202;
  let aShop = baseShop;
  let billedU201 = u201;
  let billedU202 = u202;
  let billedUShop = uShop;
  let addedUsage = 0;

  if (added > 0) {
    if (widest === '201호') {
      a201 += added;
      const targetU = Math.max(u201, round1(a201 / unitPrice));
      addedUsage = round1(targetU - u201);
      billedU201 = targetU;
    } else if (widest === '202호') {
      a202 += added;
      const targetU = Math.max(u202, round1(a202 / unitPrice));
      addedUsage = round1(targetU - u202);
      billedU202 = targetU;
    } else {
      aShop += added;
      const targetU = Math.max(uShop, round1(aShop / unitPrice));
      addedUsage = round1(targetU - uShop);
      billedUShop = targetU;
    }
  }

  const finalSum = a201 + a202 + aShop;

  return {
    isReady: true,
    allZeroUsage: false,
    uTot,
    u201,
    u202,
    uShop,
    billedU201,
    billedU202,
    billedUShop,
    addedUsage,
    billAmt,
    baseVol,
    unitPrice,
    base201,
    base202,
    baseShop,
    a201,
    a202,
    aShop,
    baseSum,
    shortfall,
    widest,
    added,
    finalSum,
    warnings: [],
    currTot: record.currTotal ?? 0,
    curr201: record.curr201 ?? 0,
    curr202: record.curr202 ?? 0,
    meterReplacedApplied: false,
  };
}

export function buildUnitMessages(
  monthLabel: string,
  accountInfo: string,
  calc: SettlementCalculation
): Record<UnitKey, string> {
  const label = monthLabel.trim() || '이번 달';
  const acct = accountInfo.trim();
  const acctLine = acct ? `\n입금 계좌: ${acct}` : '';

  return {
    '201호': `[${label} 수도세 안내]\n201호 사용량: ${formatUsage(calc.billedU201)}㎥ / 청구금액: ${formatWon(calc.a201)}${acctLine}`,
    '202호': `[${label} 수도세 안내]\n202호 사용량: ${formatUsage(calc.billedU202)}㎥ / 청구금액: ${formatWon(calc.a202)}${acctLine}`,
    '상가': `[${label} 상가 수도세 정산]\n상가 사용량: ${formatUsage(calc.billedUShop)}㎥ / 정산금액: ${formatWon(calc.aShop)}${acctLine}`,
  };
}

export function exportRecordsAsJson(records: BillingRecord[]): void {
  const payload = records
    .slice()
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map((r) => ({
      ym: r.ym,
      bill_amount: r.billAmount,
      bill_usage: r.billUsage,
      usage_total: r.usageTotal,
      usage_201: r.usage201,
      usage_202: r.usage202,
      usage_shop: r.usageShop,
      adjustment_target: r.adjustmentTarget,
      added_amount: r.addedAmount,
      final_amt_sum: r.finalAmtSum,
      curr_total: r.currTotal,
      curr_201: r.curr201,
      curr_202: r.curr202,
    }));

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `water_billing_records_${getCurrentYm()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportRecordsAsCsv(records: BillingRecord[]): void {
  const header = [
    '연월',
    '고지서금액(원)',
    '고지서사용량(m3)',
    '전체사용량(m3)',
    '201호(m3)',
    '202호(m3)',
    '상가(m3)',
    '보정대상',
    '가산액(원)',
    '최종합계(원)',
  ];
  const rows = records
    .slice()
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map((r) => [
      r.ym,
      r.billAmount ?? '',
      r.billUsage ?? '',
      r.usageTotal,
      r.usage201,
      r.usage202,
      r.usageShop,
      r.adjustmentTarget ?? '',
      r.addedAmount ?? '',
      r.finalAmtSum ?? '',
    ]);

  const csvContent =
    '\uFEFF' +
    [header, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `water_billing_records_${getCurrentYm()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

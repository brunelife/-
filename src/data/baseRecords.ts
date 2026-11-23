import type { BillingRecord, BillingSettings, UnitKey } from '../types/billing';

export const LEGACY_2024_SETTINGS = {
  prevTotal: 2276,
  prev201: 700,
  prev202: 1008,
} as const;

export const LEGACY_2026_VIRTUAL_SETTINGS = {
  prevTotal: 2893,
  prev201: 776,
  prev202: 1270,
} as const;

// 2026년 10월 고지서 기준: 건물 전체 계량기가 신규 교체됨 (전월 2,870 → 당월 9, 사용량 22㎥)
export const DEFAULT_SETTINGS: BillingSettings = {
  prevTotal: 9,
  prev201: 776,
  prev202: 1270,
  accountInfo: '538401-04-084962 국민 김영근',
  seededBase: true,
};

interface RawLedgerRow {
  ym: string;
  bill: number | null;
  bvol: number | null;
  mtot: number;
  m201: number;
  m202: number;
  mshop: number;
  utot: number;
  u201: number;
  u202: number;
  ushop: number;
}

const RAW_LEDGER_ROWS: RawLedgerRow[] = [
  { ym: '2021-05', bill: 77070, bvol: null, mtot: 1121.0, m201: 460.0, m202: 567.0, mshop: 94.0, utot: 29.0, u201: 14.0, u202: 1.0, ushop: 14.0 },
  { ym: '2021-06', bill: 71000, bvol: null, mtot: 1172.0, m201: 476.0, m202: 568.0, mshop: 128.0, utot: 51.0, u201: 16.0, u202: 1.0, ushop: 34.0 },
  { ym: '2021-07', bill: 84000, bvol: null, mtot: 1204.0, m201: 489.0, m202: 570.0, mshop: 145.0, utot: 32.0, u201: 13.0, u202: 2.0, ushop: 17.0 },
  { ym: '2021-08', bill: 96000, bvol: 33.0, mtot: 1238.0, m201: 506.0, m202: 571.0, mshop: 161.0, utot: 34.0, u201: 17.0, u202: 1.0, ushop: 16.0 },
  { ym: '2021-09', bill: 105000, bvol: null, mtot: 1275.0, m201: 520.0, m202: 578.0, mshop: 177.0, utot: 37.0, u201: 14.0, u202: 7.0, ushop: 16.0 },
  { ym: '2021-10', bill: 114000, bvol: 45.0, mtot: 1318.0, m201: 535.0, m202: 591.0, mshop: 192.0, utot: 43.0, u201: 15.0, u202: 13.0, ushop: 15.0 },
  { ym: '2021-11', bill: null, bvol: 22.0, mtot: 1337.0, m201: 539.0, m202: 596.0, mshop: 202.0, utot: 19.0, u201: 4.0, u202: 5.0, ushop: 10.0 },
  { ym: '2021-12', bill: 37290, bvol: 15.0, mtot: 1352.0, m201: 543.0, m202: 601.0, mshop: 208.0, utot: 15.0, u201: 4.0, u202: 5.0, ushop: 6.0 },
  { ym: '2022-01', bill: 29580, bvol: 12.0, mtot: 1364.0, m201: 547.0, m202: 602.0, mshop: 215.0, utot: 12.0, u201: 4.0, u202: 1.0, ushop: 7.0 },
  { ym: '2022-02', bill: 39899, bvol: 17.0, mtot: 1385.0, m201: 549.0, m202: 614.0, mshop: 222.0, utot: 21.0, u201: 2.0, u202: 12.0, ushop: 7.0 },
  { ym: '2022-03', bill: 56425, bvol: 25.0, mtot: 1408.0, m201: 551.0, m202: 627.0, mshop: 230.0, utot: 23.0, u201: 2.0, u202: 13.0, ushop: 8.0 },
  { ym: '2022-04', bill: 52279, bvol: 23.0, mtot: 1432.0, m201: 555.0, m202: 636.0, mshop: 241.0, utot: 24.0, u201: 4.0, u202: 9.0, ushop: 11.0 },
  { ym: '2022-05', bill: 39899, bvol: 17.0, mtot: 1449.0, m201: 558.0, m202: 643.0, mshop: 248.0, utot: 17.0, u201: 3.0, u202: 7.0, ushop: 7.0 },
  { ym: '2022-06', bill: 62620, bvol: 28.0, mtot: 1478.0, m201: 560.0, m202: 657.0, mshop: 261.0, utot: 29.0, u201: 2.0, u202: 14.0, ushop: 13.0 },
  { ym: '2022-07', bill: 71780, bvol: 35.0, mtot: 1512.0, m201: 563.0, m202: 678.0, mshop: 271.0, utot: 34.0, u201: 3.0, u202: 21.0, ushop: 10.0 },
  { ym: '2022-08', bill: 60290, bvol: 29.0, mtot: 1541.0, m201: 566.0, m202: 694.0, mshop: 281.0, utot: 29.0, u201: 3.0, u202: 16.0, ushop: 10.0 },
  { ym: '2022-09', bill: 58390, bvol: 28.0, mtot: 1570.0, m201: 569.0, m202: 709.0, mshop: 292.0, utot: 29.0, u201: 3.0, u202: 15.0, ushop: 11.0 },
  { ym: '2022-10', bill: 56470, bvol: 27.0, mtot: 1596.0, m201: 572.0, m202: 719.0, mshop: 305.0, utot: 26.0, u201: 3.0, u202: 10.0, ushop: 13.0 },
  { ym: '2022-11', bill: 62620, bvol: 28.0, mtot: 1621.0, m201: 576.0, m202: 729.0, mshop: 316.0, utot: 25.0, u201: 4.0, u202: 10.0, ushop: 11.0 },
  { ym: '2022-12', bill: 79140, bvol: 36.0, mtot: 1660.0, m201: 580.0, m202: 747.0, mshop: 333.0, utot: 39.0, u201: 4.0, u202: 18.0, ushop: 17.0 },
  { ym: '2023-01', bill: 70880, bvol: 32.0, mtot: 1693.0, m201: 583.0, m202: 765.0, mshop: 345.0, utot: 33.0, u201: 3.0, u202: 18.0, ushop: 12.0 },
  { ym: '2023-02', bill: 60550, bvol: 27.0, mtot: 1719.0, m201: 584.0, m202: 782.0, mshop: 353.0, utot: 26.0, u201: 1.0, u202: 17.0, ushop: 8.0 },
  { ym: '2023-03', bill: 62620, bvol: 28.0, mtot: 1748.0, m201: 587.0, m202: 800.0, mshop: 361.0, utot: 29.0, u201: 3.0, u202: 18.0, ushop: 8.0 },
  { ym: '2023-04', bill: 75010, bvol: 34.0, mtot: 1785.0, m201: 597.0, m202: 817.0, mshop: 371.0, utot: 37.0, u201: 10.0, u202: 17.0, ushop: 10.0 },
  { ym: '2023-05', bill: 83720, bvol: 38.0, mtot: 1820.0, m201: 607.0, m202: 833.0, mshop: 380.0, utot: 35.0, u201: 10.0, u202: 16.0, ushop: 9.0 },
  { ym: '2023-06', bill: 89460, bvol: 41.0, mtot: 1864.0, m201: 611.0, m202: 851.0, mshop: 402.0, utot: 44.0, u201: 4.0, u202: 18.0, ushop: 22.0 },
  { ym: '2023-07', bill: 97720, bvol: 45.0, mtot: 1907.0, m201: 617.0, m202: 868.0, mshop: 422.0, utot: 43.0, u201: 6.0, u202: 17.0, ushop: 20.0 },
  { ym: '2023-08', bill: 101850, bvol: 47.0, mtot: 1951.0, m201: 624.0, m202: 886.0, mshop: 441.0, utot: 44.0, u201: 7.0, u202: 18.0, ushop: 19.0 },
  { ym: '2023-09', bill: 83770, bvol: 40.0, mtot: 1993.0, m201: 632.0, m202: 906.0, mshop: 455.0, utot: 42.0, u201: 8.0, u202: 20.0, ushop: 14.0 },
  { ym: '2023-10', bill: 91530, bvol: 42.0, mtot: 2036.0, m201: 644.0, m202: 924.0, mshop: 468.0, utot: 43.0, u201: 12.0, u202: 18.0, ushop: 13.0 },
  { ym: '2023-11', bill: 95660, bvol: 44.0, mtot: 2075.0, m201: 656.0, m202: 938.0, mshop: 481.0, utot: 39.0, u201: 12.0, u202: 14.0, ushop: 13.0 },
  { ym: '2023-12', bill: 68810, bvol: 31.0, mtot: 2106.0, m201: 669.0, m202: 947.0, mshop: 490.0, utot: 31.0, u201: 13.0, u202: 9.0, ushop: 9.0 },
  { ym: '2024-01', bill: 93590, bvol: 43.0, mtot: 2151.0, m201: 685.0, m202: 961.0, mshop: 505.0, utot: 45.0, u201: 16.0, u202: 14.0, ushop: 15.0 },
  { ym: '2024-02', bill: 108050, bvol: 50.0, mtot: 2201.0, m201: 689.0, m202: 975.0, mshop: 537.0, utot: 50.0, u201: 4.0, u202: 14.0, ushop: 32.0 },
  { ym: '2024-03', bill: 89460, bvol: 41.0, mtot: 2244.0, m201: 692.0, m202: 992.0, mshop: 560.0, utot: 43.0, u201: 3.0, u202: 17.0, ushop: 23.0 },
  { ym: '2024-04', bill: 70880, bvol: 32.0, mtot: 2276.0, m201: 700.0, m202: 1008.0, mshop: 568.0, utot: 32.0, u201: 8.0, u202: 16.0, ushop: 8.0 },
  { ym: '2024-05', bill: 58490, bvol: 26.0, mtot: 2307.0, m201: 698.0, m202: 1020.0, mshop: 589.0, utot: 31.0, u201: 3.0, u202: 12.0, ushop: 21.0 },
  { ym: '2024-06', bill: 48160, bvol: 21.0, mtot: 2319.0, m201: 700.0, m202: 1032.0, mshop: 587.0, utot: 12.0, u201: 2.0, u202: 12.0, ushop: 5.0 },
  { ym: '2024-07', bill: 77070, bvol: 35.0, mtot: 2354.0, m201: 708.0, m202: 1045.0, mshop: 601.0, utot: 35.0, u201: 8.0, u202: 13.0, ushop: 14.0 },
  { ym: '2024-08', bill: 75010, bvol: 34.0, mtot: 2391.0, m201: 716.0, m202: 1055.0, mshop: 620.0, utot: 37.0, u201: 8.0, u202: 10.0, ushop: 19.0 },
  { ym: '2024-09', bill: 44030, bvol: 19.0, mtot: 2410.0, m201: 719.0, m202: 1064.0, mshop: 627.0, utot: 19.0, u201: 3.0, u202: 9.0, ushop: 7.0 },
  { ym: '2024-10', bill: 46100, bvol: 20.0, mtot: 2430.0, m201: 722.0, m202: 1074.0, mshop: 634.0, utot: 20.0, u201: 3.0, u202: 10.0, ushop: 7.0 },
  { ym: '2024-11', bill: 44030, bvol: 19.0, mtot: 2450.0, m201: 725.0, m202: 1084.0, mshop: 641.0, utot: 20.0, u201: 3.0, u202: 10.0, ushop: 7.0 },
  { ym: '2024-12', bill: 44030, bvol: 19.0, mtot: 2467.0, m201: 727.0, m202: 1092.0, mshop: 648.0, utot: 17.0, u201: 2.0, u202: 8.0, ushop: 7.0 },
  { ym: '2025-01', bill: 25450, bvol: 10.0, mtot: 2476.0, m201: 729.0, m202: 1092.0, mshop: 655.0, utot: 9.0, u201: 2.0, u202: 0.0, ushop: 7.0 },
  { ym: '2025-02', bill: 31640, bvol: 13.0, mtot: 2488.0, m201: 731.0, m202: 1102.0, mshop: 655.0, utot: 12.0, u201: 2.0, u202: 10.0, ushop: 0.0 },
  { ym: '2025-03', bill: 33710, bvol: 14.0, mtot: 2504.0, m201: 733.0, m202: 1106.0, mshop: 665.0, utot: 16.0, u201: 2.0, u202: 4.0, ushop: 10.0 },
  { ym: '2025-04', bill: 46100, bvol: 20.0, mtot: 2525.0, m201: 736.0, m202: 1113.0, mshop: 676.0, utot: 21.0, u201: 3.0, u202: 7.0, ushop: 11.0 },
  { ym: '2025-05', bill: 29580, bvol: 12.0, mtot: 2537.0, m201: 738.0, m202: 1115.0, mshop: 684.0, utot: 12.0, u201: 3.0, u202: 2.0, ushop: 8.0 },
  { ym: '2025-06', bill: 56420, bvol: 25.0, mtot: 2561.0, m201: 740.0, m202: 1126.0, mshop: 695.0, utot: 24.0, u201: 2.0, u202: 11.0, ushop: 5.0 },
  { ym: '2025-07', bill: 70880, bvol: 32.0, mtot: 2597.0, m201: 743.0, m202: 1160.0, mshop: 694.0, utot: 32.0, u201: 3.0, u202: 5.0, ushop: 24.0 },
  { ym: '2025-08', bill: 60550, bvol: 27.0, mtot: 2617.0, m201: 745.0, m202: 1168.0, mshop: 704.0, utot: 23.0, u201: 2.0, u202: 8.0, ushop: 13.0 },
  { ym: '2025-09', bill: 42640, bvol: 17.0, mtot: 2639.0, m201: 748.0, m202: 1178.0, mshop: 713.0, utot: 18.0, u201: 3.0, u202: 6.0, ushop: 9.0 },
  { ym: '2025-10', bill: 89380, bvol: 38.0, mtot: 2676.0, m201: 749.0, m202: 1189.0, mshop: 738.0, utot: 37.0, u201: 2.0, u202: 11.0, ushop: 25.0 },
  { ym: '2025-11', bill: 51540, bvol: 21.0, mtot: 2695.0, m201: 752.0, m202: 1198.0, mshop: 745.0, utot: 21.0, u201: 3.0, u202: 9.0, ushop: 9.0 },
  { ym: '2025-12', bill: 53770, bvol: 22.0, mtot: 2721.0, m201: 755.0, m202: 1208.0, mshop: 758.0, utot: 22.0, u201: 3.0, u202: 9.0, ushop: 10.0 },
  { ym: '2026-01', bill: 60720, bvol: 24.0, mtot: 2741.0, m201: 756.0, m202: 1221.0, mshop: 764.0, utot: 22.0, u201: 2.0, u202: 13.0, ushop: 7.0 },
  { ym: '2026-02', bill: 63050, bvol: 25.0, mtot: 2765.0, m201: 759.0, m202: 1232.0, mshop: 774.0, utot: 24.0, u201: 3.0, u202: 12.0, ushop: 10.0 },
  { ym: '2026-03', bill: 23440, bvol: 8.0, mtot: 2776.0, m201: 761.0, m202: 1233.0, mshop: 782.0, utot: 11.0, u201: 2.0, u202: 1.0, ushop: 5.0 },
  { ym: '2026-05', bill: 32760, bvol: 12.0, mtot: 2787.0, m201: 764.0, m202: 1233.0, mshop: 790.0, utot: 12.0, u201: 3.0, u202: 0.0, ushop: 9.0 },
  { ym: '2026-06', bill: 49070, bvol: 19.0, mtot: 2805.0, m201: 766.0, m202: 1239.0, mshop: 800.0, utot: 19.0, u201: 3.0, u202: 6.0, ushop: 10.0 },
  { ym: '2026-07', bill: 65380, bvol: 26.0, mtot: 2833.0, m201: 768.0, m202: 1251.0, mshop: 814.0, utot: 26.0, u201: 2.0, u202: 12.0, ushop: 13.0 },
  { ym: '2026-08', bill: 58390, bvol: 23.0, mtot: 2856.0, m201: 770.0, m202: 1261.0, mshop: 825.0, utot: 23.0, u201: 2.0, u202: 10.0, ushop: 11.0 },
  { ym: '2026-09', bill: 44410, bvol: 17.0, mtot: 2871.0, m201: 772.0, m202: 1264.0, mshop: 835.0, utot: 17.0, u201: 2.0, u202: 4.0, ushop: 11.0 },
  // 2026년 10월: 건물 전체 계량기 신규 교체 (고지서 전월지침 2,870 → 새 계량기 당월지침 9, 사용량 22㎥)
  { ym: '2026-10', bill: 56060, bvol: 22.0, mtot: 9.0, m201: 776.0, m202: 1270.0, mshop: 847.0, utot: 22.0, u201: 4.0, u202: 6.0, ushop: 12.0 },
];

function sampleStd(values: number[]): number {
  const n = values.length;
  if (n <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1);
  return Math.sqrt(variance);
}

function mround500(val: number): number {
  return Math.round(val / 500) * 500;
}

function ceil500(val: number): number {
  return Math.ceil(val / 500) * 500;
}

function buildBaseRecords(rows: RawLedgerRow[]): BillingRecord[] {
  const pools: Record<UnitKey, number[]> = {
    '201호': [],
    '202호': [],
    '상가': [],
  };

  return rows.map((r) => {
    pools['201호'].push(r.u201);
    pools['202호'].push(r.u202);
    pools['상가'].push(r.ushop);

    const s201 = sampleStd(pools['201호']);
    const s202 = sampleStd(pools['202호']);
    const sShop = sampleStd(pools['상가']);

    let widest: UnitKey = '201호';
    let maxStd = s201;
    if (s202 > maxStd) {
      maxStd = s202;
      widest = '202호';
    }
    if (sShop > maxStd) {
      widest = '상가';
    }

    const [y, m] = r.ym.split('-');
    let adjustmentTarget: UnitKey | null = null;
    let addedAmount: number | null = null;
    let finalAmtSum: number | null = null;

    if (r.bill !== null) {
      const baseVol = r.bvol !== null && r.bvol > 0 ? r.bvol : r.utot;
      if (baseVol > 0) {
        const unitPrice = r.bill / baseVol;
        const baseSum =
          mround500(unitPrice * r.u201) +
          mround500(unitPrice * r.u202) +
          mround500(unitPrice * r.ushop);
        const shortfall = r.bill - baseSum;
        addedAmount = shortfall > 0 ? ceil500(shortfall) : 0;
        finalAmtSum = baseSum + addedAmount;
        adjustmentTarget = widest;
      }
    }

    return {
      id: `base_${r.ym}`,
      ym: r.ym,
      monthLabel: `${y}년 ${Number(m)}월`,
      billAmount: r.bill,
      billUsage: r.bvol,
      usageTotal: r.utot,
      usage201: r.u201,
      usage202: r.u202,
      usageShop: r.ushop,
      adjustmentTarget,
      addedAmount,
      finalAmtSum,
      currTotal: r.mtot,
      curr201: r.m201,
      curr202: r.m202,
      isBaseRecord: true,
    };
  });
}

export const BASE_RECORDS: BillingRecord[] = buildBaseRecords(RAW_LEDGER_ROWS);

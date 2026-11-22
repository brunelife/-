import type { BillingRecord, BillingSettings, UnitKey } from '../types/billing';

export const DEFAULT_SETTINGS: BillingSettings = {
  prevTotal: 2276,
  prev201: 700,
  prev202: 1008,
  accountInfo: '538401-04-084962 국민 김영근',
  seededBase: true,
};

interface RawBaseRecord {
  ym: string;
  bill_amount: number | null;
  bill_usage: number | null;
  usage_total: number;
  usage_201: number;
  usage_202: number;
  usage_shop: number;
  adjustment_target: UnitKey | null;
  added_amount: number | null;
  final_amt_sum: number | null;
}

const RAW_BASE_RECORDS: RawBaseRecord[] = [
  { ym: '2021-05', bill_amount: 77070, bill_usage: null, usage_total: 29.0, usage_201: 14.0, usage_202: 1.0, usage_shop: 14.0, adjustment_target: '201호', added_amount: 1000, final_amt_sum: 77500 },
  { ym: '2021-06', bill_amount: 71000, bill_usage: null, usage_total: 51.0, usage_201: 16.0, usage_202: 1.0, usage_shop: 34.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 71500 },
  { ym: '2021-07', bill_amount: 84000, bill_usage: null, usage_total: 32.0, usage_201: 13.0, usage_202: 2.0, usage_shop: 17.0, adjustment_target: '상가', added_amount: 500, final_amt_sum: 84000 },
  { ym: '2021-08', bill_amount: 96000, bill_usage: 33.0, usage_total: 34.0, usage_201: 17.0, usage_202: 1.0, usage_shop: 16.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 99000 },
  { ym: '2021-09', bill_amount: 105000, bill_usage: null, usage_total: 37.0, usage_201: 14.0, usage_202: 7.0, usage_shop: 16.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 105000 },
  { ym: '2021-10', bill_amount: 114000, bill_usage: 45.0, usage_total: 43.0, usage_201: 15.0, usage_202: 13.0, usage_shop: 15.0, adjustment_target: '상가', added_amount: 5000, final_amt_sum: 114000 },
  { ym: '2021-11', bill_amount: null, bill_usage: 22.0, usage_total: 19.0, usage_201: 4.0, usage_202: 5.0, usage_shop: 10.0, adjustment_target: null, added_amount: null, final_amt_sum: null },
  { ym: '2021-12', bill_amount: 37290, bill_usage: 15.0, usage_total: 15.0, usage_201: 4.0, usage_202: 5.0, usage_shop: 6.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 37500 },
  { ym: '2022-01', bill_amount: 29580, bill_usage: 12.0, usage_total: 12.0, usage_201: 4.0, usage_202: 1.0, usage_shop: 7.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 30000 },
  { ym: '2022-02', bill_amount: 39899, bill_usage: 17.0, usage_total: 21.0, usage_201: 2.0, usage_202: 12.0, usage_shop: 7.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 49000 },
  { ym: '2022-03', bill_amount: 56425, bill_usage: 25.0, usage_total: 23.0, usage_201: 2.0, usage_202: 13.0, usage_shop: 8.0, adjustment_target: '상가', added_amount: 4500, final_amt_sum: 56500 },
  { ym: '2022-04', bill_amount: 52279, bill_usage: 23.0, usage_total: 24.0, usage_201: 4.0, usage_202: 9.0, usage_shop: 11.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 54500 },
  { ym: '2022-05', bill_amount: 39899, bill_usage: 17.0, usage_total: 17.0, usage_201: 3.0, usage_202: 7.0, usage_shop: 7.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 40000 },
  { ym: '2022-06', bill_amount: 62620, bill_usage: 28.0, usage_total: 29.0, usage_201: 2.0, usage_202: 14.0, usage_shop: 13.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 65000 },
  { ym: '2022-07', bill_amount: 71780, bill_usage: 35.0, usage_total: 34.0, usage_201: 3.0, usage_202: 21.0, usage_shop: 10.0, adjustment_target: '상가', added_amount: 2500, final_amt_sum: 72000 },
  { ym: '2022-08', bill_amount: 60290, bill_usage: 29.0, usage_total: 29.0, usage_201: 3.0, usage_202: 16.0, usage_shop: 10.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 60500 },
  { ym: '2022-09', bill_amount: 58390, bill_usage: 28.0, usage_total: 29.0, usage_201: 3.0, usage_202: 15.0, usage_shop: 11.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 61000 },
  { ym: '2022-10', bill_amount: 56470, bill_usage: 27.0, usage_total: 26.0, usage_201: 3.0, usage_202: 10.0, usage_shop: 13.0, adjustment_target: '상가', added_amount: 2000, final_amt_sum: 56500 },
  { ym: '2022-11', bill_amount: 62620, bill_usage: 28.0, usage_total: 25.0, usage_201: 4.0, usage_202: 10.0, usage_shop: 11.0, adjustment_target: '상가', added_amount: 7000, final_amt_sum: 63000 },
  { ym: '2022-12', bill_amount: 79140, bill_usage: 36.0, usage_total: 39.0, usage_201: 4.0, usage_202: 18.0, usage_shop: 17.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 86000 },
  { ym: '2023-01', bill_amount: 70880, bill_usage: 32.0, usage_total: 33.0, usage_201: 3.0, usage_202: 18.0, usage_shop: 12.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 73000 },
  { ym: '2023-02', bill_amount: 60550, bill_usage: 27.0, usage_total: 26.0, usage_201: 1.0, usage_202: 17.0, usage_shop: 8.0, adjustment_target: '202호', added_amount: 3000, final_amt_sum: 61000 },
  { ym: '2023-03', bill_amount: 62620, bill_usage: 28.0, usage_total: 29.0, usage_201: 3.0, usage_202: 18.0, usage_shop: 8.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 65000 },
  { ym: '2023-04', bill_amount: 75010, bill_usage: 34.0, usage_total: 37.0, usage_201: 10.0, usage_202: 17.0, usage_shop: 10.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 81500 },
  { ym: '2023-05', bill_amount: 83720, bill_usage: 38.0, usage_total: 35.0, usage_201: 10.0, usage_202: 16.0, usage_shop: 9.0, adjustment_target: '202호', added_amount: 6500, final_amt_sum: 84000 },
  { ym: '2023-06', bill_amount: 89460, bill_usage: 41.0, usage_total: 44.0, usage_201: 4.0, usage_202: 18.0, usage_shop: 22.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 96000 },
  { ym: '2023-07', bill_amount: 97720, bill_usage: 45.0, usage_total: 43.0, usage_201: 6.0, usage_202: 17.0, usage_shop: 20.0, adjustment_target: '202호', added_amount: 4500, final_amt_sum: 98000 },
  { ym: '2023-08', bill_amount: 101850, bill_usage: 47.0, usage_total: 44.0, usage_201: 7.0, usage_202: 18.0, usage_shop: 19.0, adjustment_target: '202호', added_amount: 7000, final_amt_sum: 102000 },
  { ym: '2023-09', bill_amount: 83770, bill_usage: 40.0, usage_total: 42.0, usage_201: 8.0, usage_202: 20.0, usage_shop: 14.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 88500 },
  { ym: '2023-10', bill_amount: 91530, bill_usage: 42.0, usage_total: 43.0, usage_201: 12.0, usage_202: 18.0, usage_shop: 13.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 93500 },
  { ym: '2023-11', bill_amount: 95660, bill_usage: 44.0, usage_total: 39.0, usage_201: 12.0, usage_202: 14.0, usage_shop: 13.0, adjustment_target: '202호', added_amount: 11000, final_amt_sum: 96000 },
  { ym: '2023-12', bill_amount: 68810, bill_usage: 31.0, usage_total: 31.0, usage_201: 13.0, usage_202: 9.0, usage_shop: 9.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 69000 },
  { ym: '2024-01', bill_amount: 93590, bill_usage: 43.0, usage_total: 45.0, usage_201: 16.0, usage_202: 14.0, usage_shop: 15.0, adjustment_target: '202호', added_amount: 0, final_amt_sum: 98000 },
  { ym: '2024-02', bill_amount: 108050, bill_usage: 50.0, usage_total: 50.0, usage_201: 4.0, usage_202: 14.0, usage_shop: 32.0, adjustment_target: '상가', added_amount: 500, final_amt_sum: 108500 },
  { ym: '2024-03', bill_amount: 89460, bill_usage: 41.0, usage_total: 43.0, usage_201: 3.0, usage_202: 17.0, usage_shop: 23.0, adjustment_target: '상가', added_amount: 0, final_amt_sum: 93500 },
  { ym: '2024-04', bill_amount: 70880, bill_usage: 32.0, usage_total: 32.0, usage_201: 8.0, usage_202: 16.0, usage_shop: 8.0, adjustment_target: '상가', added_amount: 500, final_amt_sum: 71000 },
];

export const BASE_RECORDS: BillingRecord[] = RAW_BASE_RECORDS.map((r) => {
  const [y, m] = r.ym.split('-');
  return {
    id: `base_${r.ym}`,
    ym: r.ym,
    monthLabel: `${y}년 ${Number(m)}월`,
    billAmount: r.bill_amount,
    billUsage: r.bill_usage,
    usageTotal: r.usage_total,
    usage201: r.usage_201,
    usage202: r.usage_202,
    usageShop: r.usage_shop,
    adjustmentTarget: r.adjustment_target,
    addedAmount: r.added_amount,
    finalAmtSum: r.final_amt_sum,
    currTotal: null,
    curr201: null,
    curr202: null,
    isBaseRecord: true,
  };
});

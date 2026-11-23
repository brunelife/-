export type UnitKey = '201호' | '202호' | '상가';

export type PhotoKind = 'meter201' | 'meter202' | 'meterTot' | 'bill';

export const VALIDATION_LIMITS = {
  OWNER_ID_MAX_LEN: 128,
  OWNER_ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  YM_PATTERN: /^[0-9]{4}-[0-9]{2}$/,
  MONTH_LABEL_MAX_LEN: 40,
  ACCOUNT_INFO_MAX_LEN: 120,
  METER_MIN: 0,
  METER_MAX: 999999,
  AMOUNT_MIN: 0,
  AMOUNT_MAX: 10000000,
  USAGE_MIN: -1000,
  USAGE_MAX: 100000,
  BILL_USAGE_MIN: 0,
  BILL_USAGE_MAX: 100000,
} as const;

export interface BillingRecord {
  id: string;
  ym: string;
  monthLabel: string;
  billAmount: number | null;
  billUsage: number | null;
  usageTotal: number;
  usage201: number;
  usage202: number;
  usageShop: number;
  adjustmentTarget: UnitKey | null;
  addedAmount: number | null;
  finalAmtSum: number | null;
  currTotal: number | null;
  curr201: number | null;
  curr202: number | null;
  isBaseRecord: boolean;
}

export interface BillingSettings {
  prevTotal: number;
  prev201: number;
  prev202: number;
  accountInfo: string;
  seededBase: boolean;
}

export interface UnitStat {
  n: number;
  mean: number;
  std: number;
}

export interface StatsSummary {
  stats: Record<UnitKey, UnitStat>;
  widest: UnitKey;
}

export interface SettlementInputs {
  ym: string;
  monthLabel: string;
  billAmount: string;
  billUsage: string;
  prevTotal: string;
  currTotal: string;
  prev201: string;
  curr201: string;
  prev202: string;
  curr202: string;
  accountInfo: string;
  totalMeterReplaced?: boolean;
}

export interface SettlementCalculation {
  isReady: boolean;
  allZeroUsage: boolean;
  uTot: number;
  u201: number;
  u202: number;
  uShop: number;
  billedU201: number;
  billedU202: number;
  billedUShop: number;
  addedUsage: number;
  billAmt: number;
  baseVol: number;
  unitPrice: number;
  base201: number;
  base202: number;
  baseShop: number;
  a201: number;
  a202: number;
  aShop: number;
  baseSum: number;
  shortfall: number;
  widest: UnitKey;
  added: number;
  finalSum: number;
  warnings: string[];
  currTot: number;
  curr201: number;
  curr202: number;
  meterReplacedApplied: boolean;
}

export interface SavedSettlementSnapshot {
  recordId: string;
  ym: string;
  monthLabel: string;
  accountInfo: string;
  calc: SettlementCalculation;
}

export interface PhotoUploadState {
  previewUrl: string | null;
  focusedPreviewUrl?: string | null;
  status: 'idle' | 'processing' | 'done' | 'error';
  message: string;
  progress: number;
  detectedSummary: string | null;
  alternateValue?: number | null;
  note?: string | null;
  capturedAtKst?: string | null;
}

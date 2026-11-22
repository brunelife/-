import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { BASE_RECORDS, DEFAULT_SETTINGS } from '../data/baseRecords';
import {
  VALIDATION_LIMITS,
  type BillingRecord,
  type BillingSettings,
  type UnitKey,
} from '../types/billing';
import { db, handleFirestoreError, OperationType } from './firebase';

const LOCAL_RECORDS_KEY = 'water_billing_records_v3';
const LOCAL_SETTINGS_KEY = 'water_billing_settings_v3';

function clampNumber(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function sanitizeNullableNumber(
  val: number | null,
  min: number,
  max: number
): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  return clampNumber(val, min, max);
}

function sanitizeAccountInfo(val: string): string {
  return val.trim().slice(0, VALIDATION_LIMITS.ACCOUNT_INFO_MAX_LEN);
}

function sanitizeMonthLabel(val: string): string {
  return val.trim().slice(0, VALIDATION_LIMITS.MONTH_LABEL_MAX_LEN) || '이번 달';
}

function sanitizeYm(val: string): string {
  if (VALIDATION_LIMITS.YM_PATTERN.test(val)) return val;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function sanitizeAdjustmentTarget(val: UnitKey | null): UnitKey | null {
  if (val === '201호' || val === '202호' || val === '상가') return val;
  return null;
}

export function loadLocalRecords(): BillingRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_RECORDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as BillingRecord[];
      }
    }
  } catch {
    // ignore malformed local storage
  }
  return [...BASE_RECORDS];
}

export function saveLocalRecords(records: BillingRecord[]): void {
  try {
    localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // ignore storage quota errors
  }
}

export function loadLocalSettings(): BillingSettings {
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BillingSettings>;
      return {
        prevTotal:
          typeof parsed.prevTotal === 'number'
            ? parsed.prevTotal
            : DEFAULT_SETTINGS.prevTotal,
        prev201:
          typeof parsed.prev201 === 'number'
            ? parsed.prev201
            : DEFAULT_SETTINGS.prev201,
        prev202:
          typeof parsed.prev202 === 'number'
            ? parsed.prev202
            : DEFAULT_SETTINGS.prev202,
        accountInfo:
          typeof parsed.accountInfo === 'string'
            ? parsed.accountInfo
            : DEFAULT_SETTINGS.accountInfo,
        seededBase: true,
      };
    }
  } catch {
    // ignore malformed local storage
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveLocalSettings(settings: BillingSettings): void {
  try {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage quota errors
  }
}

export function clearLocalStorage(): void {
  try {
    localStorage.removeItem(LOCAL_RECORDS_KEY);
    localStorage.removeItem(LOCAL_SETTINGS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Ensures /users/{uid}, /users/{uid}/settings/main, and initial 2021-2024 baseline records
 * exist atomically on first sign-in.
 */
export async function ensureUserWorkspace(uid: string): Promise<void> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  let userSnap;
  try {
    userSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (userSnap.exists()) {
    return;
  }

  const batch = writeBatch(db);
  const nowTs = serverTimestamp();

  batch.set(userRef, {
    ownerId: uid,
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  const settingsRef = doc(db, 'users', uid, 'settings', 'main');
  batch.set(settingsRef, {
    ownerId: uid,
    prevTotal: DEFAULT_SETTINGS.prevTotal,
    prev201: DEFAULT_SETTINGS.prev201,
    prev202: DEFAULT_SETTINGS.prev202,
    accountInfo: sanitizeAccountInfo(DEFAULT_SETTINGS.accountInfo),
    seededBase: true,
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  for (const r of BASE_RECORDS) {
    const recRef = doc(db, 'users', uid, 'records', r.id);
    batch.set(recRef, {
      ownerId: uid,
      ym: sanitizeYm(r.ym),
      monthLabel: sanitizeMonthLabel(r.monthLabel),
      billAmount: sanitizeNullableNumber(
        r.billAmount,
        VALIDATION_LIMITS.AMOUNT_MIN,
        VALIDATION_LIMITS.AMOUNT_MAX
      ),
      billUsage: sanitizeNullableNumber(
        r.billUsage,
        VALIDATION_LIMITS.BILL_USAGE_MIN,
        VALIDATION_LIMITS.BILL_USAGE_MAX
      ),
      usageTotal: clampNumber(
        r.usageTotal,
        VALIDATION_LIMITS.USAGE_MIN,
        VALIDATION_LIMITS.USAGE_MAX
      ),
      usage201: clampNumber(
        r.usage201,
        VALIDATION_LIMITS.USAGE_MIN,
        VALIDATION_LIMITS.USAGE_MAX
      ),
      usage202: clampNumber(
        r.usage202,
        VALIDATION_LIMITS.USAGE_MIN,
        VALIDATION_LIMITS.USAGE_MAX
      ),
      usageShop: clampNumber(
        r.usageShop,
        VALIDATION_LIMITS.USAGE_MIN,
        VALIDATION_LIMITS.USAGE_MAX
      ),
      adjustmentTarget: sanitizeAdjustmentTarget(r.adjustmentTarget),
      addedAmount: sanitizeNullableNumber(
        r.addedAmount,
        VALIDATION_LIMITS.AMOUNT_MIN,
        VALIDATION_LIMITS.AMOUNT_MAX
      ),
      finalAmtSum: sanitizeNullableNumber(
        r.finalAmtSum,
        VALIDATION_LIMITS.AMOUNT_MIN,
        VALIDATION_LIMITS.AMOUNT_MAX
      ),
      currTotal: null,
      curr201: null,
      curr202: null,
      isBaseRecord: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export function subscribeUserWorkspace(
  uid: string,
  onSettings: (settings: BillingSettings) => void,
  onRecords: (records: BillingRecord[]) => void,
  onFatalError: (err: Error) => void
): Unsubscribe {
  const settingsPath = `users/${uid}/settings/main`;
  const recordsPath = `users/${uid}/records`;

  const unsubSettings = onSnapshot(
    doc(db, 'users', uid, 'settings', 'main'),
    (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        onSettings({
          prevTotal: Number(d.prevTotal ?? DEFAULT_SETTINGS.prevTotal),
          prev201: Number(d.prev201 ?? DEFAULT_SETTINGS.prev201),
          prev202: Number(d.prev202 ?? DEFAULT_SETTINGS.prev202),
          accountInfo: String(d.accountInfo ?? DEFAULT_SETTINGS.accountInfo),
          seededBase: Boolean(d.seededBase),
        });
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, settingsPath);
      } catch (e) {
        onFatalError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const recordsQuery = query(
    collection(db, 'users', uid, 'records'),
    where('ownerId', '==', uid)
  );

  const unsubRecords = onSnapshot(
    recordsQuery,
    (snap) => {
      const list: BillingRecord[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          ym: String(d.ym),
          monthLabel: String(d.monthLabel ?? d.ym),
          billAmount: d.billAmount === null ? null : Number(d.billAmount),
          billUsage: d.billUsage === null ? null : Number(d.billUsage),
          usageTotal: Number(d.usageTotal ?? 0),
          usage201: Number(d.usage201 ?? 0),
          usage202: Number(d.usage202 ?? 0),
          usageShop: Number(d.usageShop ?? 0),
          adjustmentTarget: sanitizeAdjustmentTarget(d.adjustmentTarget ?? null),
          addedAmount: d.addedAmount === null ? null : Number(d.addedAmount),
          finalAmtSum: d.finalAmtSum === null ? null : Number(d.finalAmtSum),
          currTotal: d.currTotal === null ? null : Number(d.currTotal),
          curr201: d.curr201 === null ? null : Number(d.curr201),
          curr202: d.curr202 === null ? null : Number(d.curr202),
          isBaseRecord: Boolean(d.isBaseRecord),
        };
      });
      list.sort((a, b) => a.ym.localeCompare(b.ym));
      onRecords(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, recordsPath);
      } catch (e) {
        onFatalError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  return () => {
    unsubSettings();
    unsubRecords();
  };
}

export async function saveSettlementCloud(
  uid: string,
  record: BillingRecord,
  nextSettings: Pick<BillingSettings, 'prevTotal' | 'prev201' | 'prev202' | 'accountInfo'>
): Promise<void> {
  const safeId = record.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const recordPath = `users/${uid}/records/${safeId}`;
  const settingsPath = `users/${uid}/settings/main`;

  const batch = writeBatch(db);
  const nowTs = serverTimestamp();

  batch.set(doc(db, 'users', uid, 'records', safeId), {
    ownerId: uid,
    ym: sanitizeYm(record.ym),
    monthLabel: sanitizeMonthLabel(record.monthLabel),
    billAmount: sanitizeNullableNumber(
      record.billAmount,
      VALIDATION_LIMITS.AMOUNT_MIN,
      VALIDATION_LIMITS.AMOUNT_MAX
    ),
    billUsage: sanitizeNullableNumber(
      record.billUsage,
      VALIDATION_LIMITS.BILL_USAGE_MIN,
      VALIDATION_LIMITS.BILL_USAGE_MAX
    ),
    usageTotal: clampNumber(
      record.usageTotal,
      VALIDATION_LIMITS.USAGE_MIN,
      VALIDATION_LIMITS.USAGE_MAX
    ),
    usage201: clampNumber(
      record.usage201,
      VALIDATION_LIMITS.USAGE_MIN,
      VALIDATION_LIMITS.USAGE_MAX
    ),
    usage202: clampNumber(
      record.usage202,
      VALIDATION_LIMITS.USAGE_MIN,
      VALIDATION_LIMITS.USAGE_MAX
    ),
    usageShop: clampNumber(
      record.usageShop,
      VALIDATION_LIMITS.USAGE_MIN,
      VALIDATION_LIMITS.USAGE_MAX
    ),
    adjustmentTarget: sanitizeAdjustmentTarget(record.adjustmentTarget),
    addedAmount: sanitizeNullableNumber(
      record.addedAmount,
      VALIDATION_LIMITS.AMOUNT_MIN,
      VALIDATION_LIMITS.AMOUNT_MAX
    ),
    finalAmtSum: sanitizeNullableNumber(
      record.finalAmtSum,
      VALIDATION_LIMITS.AMOUNT_MIN,
      VALIDATION_LIMITS.AMOUNT_MAX
    ),
    currTotal: sanitizeNullableNumber(
      record.currTotal,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    curr201: sanitizeNullableNumber(
      record.curr201,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    curr202: sanitizeNullableNumber(
      record.curr202,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    isBaseRecord: false,
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  batch.update(doc(db, 'users', uid, 'settings', 'main'), {
    prevTotal: clampNumber(
      nextSettings.prevTotal,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    prev201: clampNumber(
      nextSettings.prev201,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    prev202: clampNumber(
      nextSettings.prev202,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    accountInfo: sanitizeAccountInfo(nextSettings.accountInfo),
    updatedAt: nowTs,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${recordPath} & ${settingsPath}`);
  }
}

export async function updateAccountInfoCloud(
  uid: string,
  accountInfo: string
): Promise<void> {
  const settingsPath = `users/${uid}/settings/main`;
  try {
    await updateDoc(doc(db, 'users', uid, 'settings', 'main'), {
      accountInfo: sanitizeAccountInfo(accountInfo),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, settingsPath);
  }
}

export async function deleteBillingRecordCloud(
  uid: string,
  recordId: string
): Promise<void> {
  const recordPath = `users/${uid}/records/${recordId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'records', recordId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, recordPath);
  }
}

export async function resetLedgerToBaseCloud(uid: string): Promise<void> {
  const recordsPath = `users/${uid}/records`;
  let snap;
  try {
    snap = await getDocs(
      query(collection(db, 'users', uid, 'records'), where('ownerId', '==', uid))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, recordsPath);
  }

  const batch = writeBatch(db);
  const nowTs = serverTimestamp();

  const existingIds = new Set<string>();
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.isBaseRecord === true) {
      existingIds.add(docSnap.id);
    } else {
      batch.delete(docSnap.ref);
    }
  });

  // Re-seed any missing baseline records
  for (const r of BASE_RECORDS) {
    if (existingIds.has(r.id)) continue;
    const recRef = doc(db, 'users', uid, 'records', r.id);
    batch.set(recRef, {
      ownerId: uid,
      ym: r.ym,
      monthLabel: r.monthLabel,
      billAmount: r.billAmount,
      billUsage: r.billUsage,
      usageTotal: r.usageTotal,
      usage201: r.usage201,
      usage202: r.usage202,
      usageShop: r.usageShop,
      adjustmentTarget: r.adjustmentTarget,
      addedAmount: r.addedAmount,
      finalAmtSum: r.finalAmtSum,
      currTotal: null,
      curr201: null,
      curr202: null,
      isBaseRecord: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    });
  }

  batch.update(doc(db, 'users', uid, 'settings', 'main'), {
    prevTotal: DEFAULT_SETTINGS.prevTotal,
    prev201: DEFAULT_SETTINGS.prev201,
    prev202: DEFAULT_SETTINGS.prev202,
    accountInfo: sanitizeAccountInfo(DEFAULT_SETTINGS.accountInfo),
    updatedAt: nowTs,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, recordsPath);
  }
}

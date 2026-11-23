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
import {
  BASE_RECORDS,
  DEFAULT_SETTINGS,
  LEGACY_2024_SETTINGS,
  LEGACY_2026_VIRTUAL_SETTINGS,
} from '../data/baseRecords';
import {
  VALIDATION_LIMITS,
  type BillingRecord,
  type BillingSettings,
  type UnitKey,
} from '../types/billing';
import { db, handleFirestoreError, OperationType } from './firebase';

const LOCAL_RECORDS_KEY = 'water_billing_records_v5';
const LOCAL_SETTINGS_KEY = 'water_billing_settings_v5';
const LEGACY_LOCAL_RECORDS_KEYS = [
  'water_billing_records_v4',
  'water_billing_records_v3',
];
const LEGACY_LOCAL_SETTINGS_KEYS = [
  'water_billing_settings_v4',
  'water_billing_settings_v3',
];

function isLegacyBaselineSettings(
  prevTotal: number | undefined,
  prev201: number | undefined,
  prev202: number | undefined
): boolean {
  return (
    (prevTotal === LEGACY_2024_SETTINGS.prevTotal &&
      prev201 === LEGACY_2024_SETTINGS.prev201 &&
      prev202 === LEGACY_2024_SETTINGS.prev202) ||
    (prevTotal === LEGACY_2026_VIRTUAL_SETTINGS.prevTotal &&
      prev201 === LEGACY_2026_VIRTUAL_SETTINGS.prev201 &&
      prev202 === LEGACY_2026_VIRTUAL_SETTINGS.prev202)
  );
}

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
    // Seamless one-time migration from v4/v3: preserve user-saved records after 2026-10
    for (const legacyKey of LEGACY_LOCAL_RECORDS_KEYS) {
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        if (Array.isArray(legacyParsed)) {
          const extraUserRecords = (legacyParsed as BillingRecord[]).filter(
            (r) => !r.isBaseRecord && typeof r.ym === 'string' && r.ym > '2026-10'
          );
          const merged = [...BASE_RECORDS, ...extraUserRecords].sort((a, b) =>
            a.ym.localeCompare(b.ym)
          );
          saveLocalRecords(merged);
          return merged;
        }
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
    // Seamless one-time migration from v4/v3: keep custom accountInfo, upgrade legacy 2276 or virtual 2893 baseline to real replaced meter 9
    for (const legacyKey of LEGACY_LOCAL_SETTINGS_KEYS) {
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw) as Partial<BillingSettings>;
        const isLegacyBaseline = isLegacyBaselineSettings(
          parsed.prevTotal,
          parsed.prev201,
          parsed.prev202
        );
        const migrated: BillingSettings = {
          prevTotal:
            !isLegacyBaseline && typeof parsed.prevTotal === 'number'
              ? parsed.prevTotal
              : DEFAULT_SETTINGS.prevTotal,
          prev201:
            !isLegacyBaseline && typeof parsed.prev201 === 'number'
              ? parsed.prev201
              : DEFAULT_SETTINGS.prev201,
          prev202:
            !isLegacyBaseline && typeof parsed.prev202 === 'number'
              ? parsed.prev202
              : DEFAULT_SETTINGS.prev202,
          accountInfo:
            typeof parsed.accountInfo === 'string' && parsed.accountInfo.trim()
              ? parsed.accountInfo
              : DEFAULT_SETTINGS.accountInfo,
          seededBase: true,
        };
        saveLocalSettings(migrated);
        return migrated;
      }
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
    for (const k of LEGACY_LOCAL_RECORDS_KEYS) localStorage.removeItem(k);
    for (const k of LEGACY_LOCAL_SETTINGS_KEYS) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

function buildFirestoreBaseRecordPayload(
  uid: string,
  r: BillingRecord,
  nowTs: ReturnType<typeof serverTimestamp>
) {
  return {
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
    currTotal: sanitizeNullableNumber(
      r.currTotal,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    curr201: sanitizeNullableNumber(
      r.curr201,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    curr202: sanitizeNullableNumber(
      r.curr202,
      VALIDATION_LIMITS.METER_MIN,
      VALIDATION_LIMITS.METER_MAX
    ),
    isBaseRecord: true,
    createdAt: nowTs,
    updatedAt: nowTs,
  };
}

/**
 * Ensures /users/{uid}, /users/{uid}/settings/main, and full 2021-2026 baseline records
 * exist atomically, and seamlessly upgrades existing 2021-2024 workspaces without touching
 * newer user-saved settlements.
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
    const recordsPath = `users/${uid}/records`;
    const settingsRef = doc(db, 'users', uid, 'settings', 'main');
    let existingRecordsSnap;
    let settingsSnap;
    try {
      [existingRecordsSnap, settingsSnap] = await Promise.all([
        getDocs(
          query(collection(db, 'users', uid, 'records'), where('ownerId', '==', uid))
        ),
        getDoc(settingsRef),
      ]);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, recordsPath);
    }

    const existingById = new Map<string, Record<string, unknown>>();
    existingRecordsSnap.docs.forEach((d) => {
      existingById.set(d.id, d.data());
    });

    const upgradeBatch = writeBatch(db);
    const nowTs = serverTimestamp();
    let pendingWrites = 0;

    for (const r of BASE_RECORDS) {
      const existingDoc = existingById.get(r.id);
      const recRef = doc(db, 'users', uid, 'records', r.id);
      if (!existingDoc) {
        upgradeBatch.set(recRef, buildFirestoreBaseRecordPayload(uid, r, nowTs));
        pendingWrites += 1;
      } else if (
        existingDoc.isBaseRecord === true &&
        r.currTotal != null &&
        (existingDoc.currTotal == null ||
          Number(existingDoc.currTotal) !== r.currTotal)
      ) {
        upgradeBatch.update(recRef, {
          currTotal: sanitizeNullableNumber(
            r.currTotal,
            VALIDATION_LIMITS.METER_MIN,
            VALIDATION_LIMITS.METER_MAX
          ),
          curr201: sanitizeNullableNumber(
            r.curr201,
            VALIDATION_LIMITS.METER_MIN,
            VALIDATION_LIMITS.METER_MAX
          ),
          curr202: sanitizeNullableNumber(
            r.curr202,
            VALIDATION_LIMITS.METER_MIN,
            VALIDATION_LIMITS.METER_MAX
          ),
          updatedAt: nowTs,
        });
        pendingWrites += 1;
      }
    }

    if (settingsSnap.exists()) {
      const s = settingsSnap.data();
      if (
        isLegacyBaselineSettings(
          Number(s.prevTotal),
          Number(s.prev201),
          Number(s.prev202)
        )
      ) {
        upgradeBatch.update(settingsRef, {
          prevTotal: DEFAULT_SETTINGS.prevTotal,
          prev201: DEFAULT_SETTINGS.prev201,
          prev202: DEFAULT_SETTINGS.prev202,
          updatedAt: nowTs,
        });
        pendingWrites += 1;
      }
    }

    if (pendingWrites > 0) {
      try {
        await upgradeBatch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, recordsPath);
      }
    }
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
    batch.set(recRef, buildFirestoreBaseRecordPayload(uid, r, nowTs));
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

export async function updatePrevBaselinesCloud(
  uid: string,
  prevBaselines: Pick<BillingSettings, 'prevTotal' | 'prev201' | 'prev202'>
): Promise<void> {
  const settingsPath = `users/${uid}/settings/main`;
  try {
    await updateDoc(doc(db, 'users', uid, 'settings', 'main'), {
      prevTotal: clampNumber(
        prevBaselines.prevTotal,
        VALIDATION_LIMITS.METER_MIN,
        VALIDATION_LIMITS.METER_MAX
      ),
      prev201: clampNumber(
        prevBaselines.prev201,
        VALIDATION_LIMITS.METER_MIN,
        VALIDATION_LIMITS.METER_MAX
      ),
      prev202: clampNumber(
        prevBaselines.prev202,
        VALIDATION_LIMITS.METER_MIN,
        VALIDATION_LIMITS.METER_MAX
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, settingsPath);
  }
}

export async function deleteBillingRecordCloud(
  uid: string,
  recordId: string,
  fallbackPrev?: Pick<BillingSettings, 'prevTotal' | 'prev201' | 'prev202'> | null
): Promise<void> {
  const recordPath = `users/${uid}/records/${recordId}`;
  const settingsPath = `users/${uid}/settings/main`;
  try {
    if (fallbackPrev) {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'users', uid, 'records', recordId));
      batch.update(doc(db, 'users', uid, 'settings', 'main'), {
        prevTotal: clampNumber(
          fallbackPrev.prevTotal,
          VALIDATION_LIMITS.METER_MIN,
          VALIDATION_LIMITS.METER_MAX
        ),
        prev201: clampNumber(
          fallbackPrev.prev201,
          VALIDATION_LIMITS.METER_MIN,
          VALIDATION_LIMITS.METER_MAX
        ),
        prev202: clampNumber(
          fallbackPrev.prev202,
          VALIDATION_LIMITS.METER_MIN,
          VALIDATION_LIMITS.METER_MAX
        ),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } else {
      await deleteDoc(doc(db, 'users', uid, 'records', recordId));
    }
  } catch (error) {
    handleFirestoreError(
      error,
      fallbackPrev ? OperationType.WRITE : OperationType.DELETE,
      fallbackPrev ? `${recordPath} & ${settingsPath}` : recordPath
    );
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

  // Re-seed any missing baseline records and sync meter readings
  for (const r of BASE_RECORDS) {
    const recRef = doc(db, 'users', uid, 'records', r.id);
    if (existingIds.has(r.id)) {
      batch.update(recRef, {
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
        usageTotal: r.usageTotal,
        usage201: r.usage201,
        usage202: r.usage202,
        usageShop: r.usageShop,
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
        currTotal: sanitizeNullableNumber(
          r.currTotal,
          VALIDATION_LIMITS.METER_MIN,
          VALIDATION_LIMITS.METER_MAX
        ),
        curr201: sanitizeNullableNumber(
          r.curr201,
          VALIDATION_LIMITS.METER_MIN,
          VALIDATION_LIMITS.METER_MAX
        ),
        curr202: sanitizeNullableNumber(
          r.curr202,
          VALIDATION_LIMITS.METER_MIN,
          VALIDATION_LIMITS.METER_MAX
        ),
        updatedAt: nowTs,
      });
      continue;
    }
    batch.set(recRef, buildFirestoreBaseRecordPayload(uid, r, nowTs));
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

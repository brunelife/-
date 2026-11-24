import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  Calculator,
  CheckCircle2,
  BookOpen,
  LogIn,
  LogOut,
  AlertCircle,
} from 'lucide-react';
import { BASE_RECORDS, DEFAULT_SETTINGS } from './data/baseRecords';
import {
  clearLocalStorage,
  deleteBillingRecordCloud,
  ensureUserWorkspace,
  loadLocalRecords,
  loadLocalSettings,
  resetLedgerToBaseCloud,
  saveLocalRecords,
  saveLocalSettings,
  saveSettlementCloud,
  subscribeUserWorkspace,
  updatePrevBaselinesCloud,
} from './firebase/billingStore';
import { auth, googleProvider } from './firebase/firebase';
import {
  type BillingRecord,
  type BillingSettings,
  type PhotoKind,
  type PhotoUploadState,
  type SavedSettlementSnapshot,
  type SettlementInputs,
} from './types/billing';
import {
  calculateSettlement,
  formatWon,
  getCurrentYm,
  ymToKoreanLabel,
} from './utils/billingMath';
import {
  createAlignedPhotoPreviews,
  normalizePhotoFileToUrl,
  rotatePhotoUrlCw90,
  runPhotoOcr,
  type OcrParseResult,
} from './utils/ocrEngine';
import {
  assignBulkPhotosToSlots,
  inferBestPhotoSlot,
  PHOTO_KIND_KOREAN_LABEL,
  type MeterPhotoKind,
  type PrevBaselines,
} from './utils/meterMatcher';
import {
  extractPhotoTimestampKst,
  getNowKstTimestamp,
} from './utils/photoTimestamp';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PhotoZoomModal } from './components/PhotoZoomModal';
import { SettlementTab } from './components/SettlementTab';
import { VerifyDbTab } from './components/VerifyDbTab';

type ActiveTab = 'simple' | 'verify';

const INITIAL_PHOTO_STATE: PhotoUploadState = {
  previewUrl: null,
  focusedPreviewUrl: null,
  status: 'idle',
  message: '',
  progress: 0,
  detectedSummary: null,
  alternateValue: null,
  note: null,
  capturedAtKst: null,
};

function createInitialPhotos(): Record<PhotoKind, PhotoUploadState> {
  return {
    meter201: { ...INITIAL_PHOTO_STATE },
    meter202: { ...INITIAL_PHOTO_STATE },
    meterTot: { ...INITIAL_PHOTO_STATE },
    bill: { ...INITIAL_PHOTO_STATE },
  };
}

function WaterBillingApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('simple');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  if (fatalError) {
    throw fatalError;
  }

  const [records, setRecords] = useState<BillingRecord[]>(() =>
    loadLocalRecords()
  );
  const [settings, setSettings] = useState<BillingSettings>(() =>
    loadLocalSettings()
  );

  const defaultYm = useMemo(() => getCurrentYm(), []);
  const [inputs, setInputs] = useState<SettlementInputs>(() => {
    const initialSettings = loadLocalSettings();
    return {
      ym: defaultYm,
      monthLabel: ymToKoreanLabel(defaultYm),
      billAmount: '',
      billUsage: '',
      prevTotal: String(initialSettings.prevTotal),
      currTotal: '',
      prev201: String(initialSettings.prev201),
      curr201: '',
      prev202: String(initialSettings.prev202),
      curr202: '',
      accountInfo: initialSettings.accountInfo,
      totalMeterReplaced: false,
    };
  });

  const [autoFilledFields, setAutoFilledFields] = useState<
    Record<string, boolean>
  >({});
  const [photos, setPhotos] = useState<Record<PhotoKind, PhotoUploadState>>(
    createInitialPhotos
  );
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  const [bulkUploading, setBulkUploading] = useState<{
    active: boolean;
    total: number;
    completed: number;
  }>({ active: false, total: 0, completed: 0 });
  const [kstDateInfo, setKstDateInfo] = useState<{
    koreanDate: string;
    compactDateTime: string;
    fromPhoto: boolean;
  }>(() => {
    const nowKst = getNowKstTimestamp();
    return {
      koreanDate: nowKst.koreanDate,
      compactDateTime: nowKst.compactDateTime,
      fromPhoto: false,
    };
  });
  const [zoomPhoto, setZoomPhoto] = useState<{
    url: string;
    title: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] =
    useState<SavedSettlementSnapshot | null>(null);
  const savedSnapshotRef = useRef<SavedSettlementSnapshot | null>(null);
  useEffect(() => {
    savedSnapshotRef.current = savedSnapshot;
  }, [savedSnapshot]);
  const [authBusy, setAuthBusy] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BillingRecord | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (message: string, tone: 'success' | 'error' = 'success') => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      setToast({ message, tone });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 3600);
    },
    []
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      const localRecs = loadLocalRecords();
      const localSet = loadLocalSettings();
      setRecords(localRecs);
      setSettings(localSet);
      setInputs((prev) => ({
        ...prev,
        prevTotal: String(localSet.prevTotal),
        prev201: String(localSet.prev201),
        prev202: String(localSet.prev202),
        accountInfo: localSet.accountInfo,
      }));
      setCloudLoading(false);
      return;
    }

    let active = true;
    let unsubWorkspace: (() => void) | null = null;
    setCloudLoading(true);

    ensureUserWorkspace(user.uid)
      .then(() => {
        if (!active) return;
        unsubWorkspace = subscribeUserWorkspace(
          user.uid,
          (cloudSettings) => {
            setSettings(cloudSettings);
            if (!savedSnapshotRef.current) {
              setInputs((prev) => ({
                ...prev,
                prevTotal: String(cloudSettings.prevTotal),
                prev201: String(cloudSettings.prev201),
                prev202: String(cloudSettings.prev202),
                accountInfo: cloudSettings.accountInfo,
              }));
            }
          },
          (cloudRecords) => {
            setRecords(cloudRecords);
            setCloudLoading(false);
          },
          (err) => {
            setCloudLoading(false);
            setFatalError(err);
          }
        );
      })
      .catch((err) => {
        if (!active) return;
        setCloudLoading(false);
        setFatalError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      active = false;
      unsubWorkspace?.();
    };
  }, [authReady, user]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const calc = useMemo(
    () => calculateSettlement(inputs, records),
    [inputs, records]
  );

  const priorBaselineCandidate = useMemo(() => {
    if (!calc.allZeroUsage) return null;
    const curPrevTot = Number(inputs.prevTotal);
    const curPrev201 = Number(inputs.prev201);
    const curPrev202 = Number(inputs.prev202);
    const withMeters = records
      .filter(
        (r) =>
          r.currTotal !== null &&
          r.curr201 !== null &&
          r.curr202 !== null &&
          !(
            r.currTotal === curPrevTot &&
            r.curr201 === curPrev201 &&
            r.curr202 === curPrev202
          )
      )
      .sort((a, b) => b.ym.localeCompare(a.ym));
    const earlier = inputs.ym
      ? withMeters.find((r) => r.ym < inputs.ym)
      : undefined;
    const picked = earlier ?? withMeters[0];
    if (!picked) return null;
    return {
      ym: picked.ym,
      monthLabel: picked.monthLabel || ymToKoreanLabel(picked.ym),
      prevTotal: picked.currTotal!,
      prev201: picked.curr201!,
      prev202: picked.curr202!,
    };
  }, [
    calc.allZeroUsage,
    inputs.prevTotal,
    inputs.prev201,
    inputs.prev202,
    inputs.ym,
    records,
  ]);

  const handleApplyPrevBaseline = useCallback(
    async (candidate: {
      monthLabel: string;
      prevTotal: number;
      prev201: number;
      prev202: number;
    }) => {
      setSavedSnapshot(null);
      setInputs((prev) => ({
        ...prev,
        prevTotal: String(candidate.prevTotal),
        prev201: String(candidate.prev201),
        prev202: String(candidate.prev202),
      }));

      // If stored settings no longer match any record (e.g., deleted before rollback fix),
      // sync the restored baseline back so refreshing never snaps back to the stale baseline.
      const hasRecordMatchingSettings = records.some(
        (r) =>
          r.currTotal === settings.prevTotal &&
          r.curr201 === settings.prev201 &&
          r.curr202 === settings.prev202
      );
      if (!hasRecordMatchingSettings) {
        const restoredSettings: BillingSettings = {
          ...settings,
          prevTotal: candidate.prevTotal,
          prev201: candidate.prev201,
          prev202: candidate.prev202,
        };
        if (user) {
          try {
            await updatePrevBaselinesCloud(user.uid, restoredSettings);
          } catch {
            // Keep local input update even if cloud sync fails
          }
        } else {
          setSettings(restoredSettings);
          saveLocalSettings(restoredSettings);
        }
      }

      showToast(
        `${candidate.monthLabel} 기준(전체 ${candidate.prevTotal} · 201호 ${candidate.prev201} · 202호 ${candidate.prev202})으로 다시 계산했어요!`
      );
    },
    [records, settings, showToast, user]
  );

  const handleInputChange = useCallback(
    (field: keyof SettlementInputs, value: string) => {
      setSavedSnapshot(null);
      setInputs((prev) => ({ ...prev, [field]: value }));
      setAutoFilledFields((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    []
  );

  const handleToggleTotalMeterReplaced = useCallback((replaced: boolean) => {
    setSavedSnapshot(null);
    setInputs((prev) => ({ ...prev, totalMeterReplaced: replaced }));
  }, []);

  const handlePhotoClear = useCallback((kind: PhotoKind) => {
    setPhotos((prev) => {
      const oldUrl = prev[kind].previewUrl;
      const oldFocused = prev[kind].focusedPreviewUrl;
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      if (oldFocused && oldFocused !== oldUrl) URL.revokeObjectURL(oldFocused);
      return {
        ...prev,
        [kind]: { ...INITIAL_PHOTO_STATE },
      };
    });
  }, []);

  const handlePhotoRotate = useCallback(async (kind: PhotoKind) => {
    const current = photos[kind];
    if (!current.previewUrl) return;
    try {
      const nextFull = await rotatePhotoUrlCw90(current.previewUrl);
      const nextFocused = current.focusedPreviewUrl
        ? await rotatePhotoUrlCw90(current.focusedPreviewUrl)
        : null;
      setPhotos((prev) => {
        const oldFull = prev[kind].previewUrl;
        const oldFocused = prev[kind].focusedPreviewUrl;
        if (oldFull) URL.revokeObjectURL(oldFull);
        if (oldFocused && oldFocused !== oldFull) URL.revokeObjectURL(oldFocused);
        return {
          ...prev,
          [kind]: {
            ...prev[kind],
            previewUrl: nextFull,
            focusedPreviewUrl: nextFocused,
          },
        };
      });
    } catch {
      // Ignore transient canvas rotate errors
    }
  }, [photos]);

  const applyAnalyzedPhotoToSlot = useCallback(
    async (
      targetKind: PhotoKind,
      sourcePreviewUrl: string,
      res: OcrParseResult,
      capturedAtKst: string,
      reroutedNotePrefix: string | null,
      restoreSlot?: { kind: PhotoKind; previous: PhotoUploadState } | null
    ) => {
      let alignedFullUrl = sourcePreviewUrl;
      let alignedFocusedUrl: string | null = null;
      if (res.uprightRotateCw !== 0 || res.counterBox) {
        try {
          const aligned = await createAlignedPhotoPreviews(
            sourcePreviewUrl,
            res.uprightRotateCw,
            res.counterBox,
            targetKind
          );
          alignedFullUrl = aligned.uprightUrl;
          alignedFocusedUrl = aligned.focusedUrl;
          if (alignedFullUrl !== sourcePreviewUrl) {
            URL.revokeObjectURL(sourcePreviewUrl);
          }
        } catch {
          // Keep sourcePreviewUrl if alignment fails
        }
      }

      const mergeNote = (baseNote: string | null): string | null => {
        if (reroutedNotePrefix && baseNote) {
          return `${reroutedNotePrefix} · ${baseNote}`;
        }
        return reroutedNotePrefix || baseNote;
      };

      const commitPhotoState = (nextSlotState: PhotoUploadState) => {
        setPhotos((prev) => {
          const next = { ...prev };
          const oldTargetFull = prev[targetKind].previewUrl;
          const oldTargetFocused = prev[targetKind].focusedPreviewUrl;
          const restoredFull = restoreSlot?.previous.previewUrl ?? null;
          const restoredFocused =
            restoreSlot?.previous.focusedPreviewUrl ?? null;

          if (
            oldTargetFull &&
            oldTargetFull !== alignedFullUrl &&
            oldTargetFull !== restoredFull
          ) {
            URL.revokeObjectURL(oldTargetFull);
          }
          if (
            oldTargetFocused &&
            oldTargetFocused !== oldTargetFull &&
            oldTargetFocused !== alignedFocusedUrl &&
            oldTargetFocused !== restoredFocused
          ) {
            URL.revokeObjectURL(oldTargetFocused);
          }

          if (restoreSlot && restoreSlot.kind !== targetKind) {
            next[restoreSlot.kind] = restoreSlot.previous;
          }
          next[targetKind] = nextSlotState;
          return next;
        });
      };

      if (targetKind === 'bill') {
        const foundParts: string[] = [];
        if (res.amount != null) {
          setInputs((prev) => ({ ...prev, billAmount: String(res.amount) }));
          setAutoFilledFields((prev) => ({ ...prev, billAmount: true }));
          foundParts.push(`금액 ${formatWon(res.amount)}`);
        }
        if (res.usage != null) {
          setInputs((prev) => ({ ...prev, billUsage: String(res.usage) }));
          setAutoFilledFields((prev) => ({ ...prev, billUsage: true }));
          foundParts.push(`사용량 ${res.usage}㎥`);
        }

        const billShowsReplacement =
          res.billPrevReading != null &&
          res.billCurrReading != null &&
          res.billCurrReading < res.billPrevReading;
        let billNote = res.note || null;
        if (billShowsReplacement) {
          billNote = `계량기 교체 확인 (전월 ${res.billPrevReading} → 새 지침 ${res.billCurrReading})`;
          const currentPrevTot = Number(inputs.prevTotal) || 0;
          if (currentPrevTot > res.billCurrReading!) {
            setInputs((prev) => ({
              ...prev,
              totalMeterReplaced: true,
              currTotal: prev.currTotal.trim()
                ? prev.currTotal
                : String(res.billCurrReading),
            }));
          }
        }

        commitPhotoState({
          previewUrl: alignedFullUrl,
          focusedPreviewUrl: alignedFocusedUrl,
          status: foundParts.length > 0 ? 'done' : 'error',
          progress: 100,
          detectedSummary: foundParts.length > 0 ? foundParts.join(', ') : null,
          alternateValue: null,
          note: mergeNote(billNote),
          capturedAtKst,
          message:
            foundParts.length > 0
              ? `읽기 완료: ${foundParts.join(', ')}`
              : '숫자가 잘 안 보여요. 다음 화면에서 직접 적어주세요.',
        });
        return;
      }

      const fieldMap: Record<MeterPhotoKind, keyof SettlementInputs> = {
        meter201: 'curr201',
        meter202: 'curr202',
        meterTot: 'currTotal',
      };
      const targetField = fieldMap[targetKind];

      if (res.meterValue != null) {
        setInputs((prev) => ({
          ...prev,
          [targetField]: String(res.meterValue),
        }));
        setAutoFilledFields((prev) => ({ ...prev, [targetField]: true }));
        commitPhotoState({
          previewUrl: alignedFullUrl,
          focusedPreviewUrl: alignedFocusedUrl,
          status: 'done',
          progress: 100,
          detectedSummary: String(res.meterValue),
          alternateValue: null,
          note: mergeNote(res.note || null),
          capturedAtKst,
          message: `읽은 숫자: ${res.meterValue}`,
        });
      } else {
        commitPhotoState({
          previewUrl: alignedFullUrl,
          focusedPreviewUrl: alignedFocusedUrl,
          status: 'error',
          progress: 100,
          detectedSummary: null,
          alternateValue: null,
          note: mergeNote(res.note || null),
          capturedAtKst,
          message: '숫자가 잘 안 보여요. 다음 화면에서 직접 적어주세요.',
        });
      }
    },
    [inputs.prevTotal]
  );

  const handlePhotoSelect = useCallback(
    async (kind: PhotoKind, file: File) => {
      setSavedSnapshot(null);
      const previousSlotState: PhotoUploadState = { ...photosRef.current[kind] };

      // Extract capture timestamp in KST before canvas normalization strips EXIF
      const kstTs = await extractPhotoTimestampKst(file);
      let previewUrl: string;
      try {
        previewUrl = await normalizePhotoFileToUrl(file);
      } catch {
        previewUrl = URL.createObjectURL(file);
      }
      setKstDateInfo({
        koreanDate: kstTs.koreanDate,
        compactDateTime: kstTs.compactDateTime,
        fromPhoto: true,
      });
      setInputs((prev) => ({
        ...prev,
        ym: kstTs.ym,
        monthLabel: ymToKoreanLabel(kstTs.ym),
      }));

      // Keep previousSlotState URLs alive until OCR confirms whether this photo stays in `kind`
      setPhotos((prev) => ({
        ...prev,
        [kind]: {
          previewUrl,
          focusedPreviewUrl: null,
          status: 'processing',
          message: '사진에서 숫자를 읽고 있어요...',
          progress: 12,
          detectedSummary: null,
          alternateValue: null,
          note: null,
          capturedAtKst: kstTs.compactDateTime,
        },
      }));

      const prevBaselines: PrevBaselines = {
        prevTotal: Number(inputs.prevTotal) || 0,
        prev201: Number(inputs.prev201) || 0,
        prev202: Number(inputs.prev202) || 0,
      };
      const prevRefMap: Record<PhotoKind, number> = {
        meter201: prevBaselines.prev201,
        meter202: prevBaselines.prev202,
        meterTot: prevBaselines.prevTotal,
        bill: 0,
      };

      try {
        const res = await runPhotoOcr(
          file,
          kind,
          prevRefMap[kind],
          (progress) => {
            setPhotos((prev) => ({
              ...prev,
              [kind]: {
                ...prev[kind],
                progress,
              },
            }));
          }
        );

        const inferred = inferBestPhotoSlot(
          res.detectedType,
          res.meterValue ?? null,
          res.meterDigitCount ?? null,
          kind,
          prevBaselines
        );

        const targetKind = inferred.targetKind;
        const wasRerouted = inferred.wasRerouted && targetKind !== kind;

        if (!wasRerouted) {
          // Safe to revoke previous URLs of `kind` now that new photo stays here
          if (
            previousSlotState.previewUrl &&
            previousSlotState.previewUrl !== previewUrl
          ) {
            URL.revokeObjectURL(previousSlotState.previewUrl);
          }
          if (
            previousSlotState.focusedPreviewUrl &&
            previousSlotState.focusedPreviewUrl !== previousSlotState.previewUrl
          ) {
            URL.revokeObjectURL(previousSlotState.focusedPreviewUrl);
          }
        }

        await applyAnalyzedPhotoToSlot(
          targetKind,
          previewUrl,
          res,
          kstTs.compactDateTime,
          wasRerouted ? '자동 분류됨' : null,
          wasRerouted
            ? {
                kind,
                previous:
                  previousSlotState.status === 'done'
                    ? previousSlotState
                    : { ...INITIAL_PHOTO_STATE },
              }
            : null
        );

        if (wasRerouted) {
          const valSuffix =
            targetKind === 'bill'
              ? res.amount != null
                ? `(${formatWon(res.amount)})`
                : ''
              : res.meterValue != null
                ? `(${res.meterValue})`
                : '';
          showToast(
            `${PHOTO_KIND_KOREAN_LABEL[targetKind]}${valSuffix} 사진이라 자동으로 제자리에 넣었어요!`
          );
        }
      } catch (err) {
        const errMsg =
          err instanceof Error && err.message.trim().length > 0
            ? err.message.trim()
            : '사진을 읽지 못했어요. 다음 화면에서 직접 적어주세요.';
        setPhotos((prev) => ({
          ...prev,
          [kind]: {
            ...prev[kind],
            status: 'error',
            progress: 100,
            alternateValue: null,
            note: null,
            message: errMsg,
          },
        }));
      }
    },
    [
      applyAnalyzedPhotoToSlot,
      inputs.prev201,
      inputs.prev202,
      inputs.prevTotal,
      showToast,
    ]
  );

  const handleBulkPhotoSelect = useCallback(
    async (fileList: File[]) => {
      const files = fileList.slice(0, 4);
      if (files.length === 0) return;

      setSavedSnapshot(null);
      setBulkUploading({ active: true, total: files.length, completed: 0 });

      const prevBaselines: PrevBaselines = {
        prevTotal: Number(inputs.prevTotal) || 0,
        prev201: Number(inputs.prev201) || 0,
        prev202: Number(inputs.prev202) || 0,
      };

      try {
        let completedCount = 0;
        const analyzed = await Promise.all(
          files.map(async (file) => {
            const kstTs = await extractPhotoTimestampKst(file);
            let previewUrl: string;
            try {
              previewUrl = await normalizePhotoFileToUrl(file);
            } catch {
              previewUrl = URL.createObjectURL(file);
            }
            try {
              const res = await runPhotoOcr(file, 'auto', 0);
              completedCount += 1;
              setBulkUploading({
                active: true,
                total: files.length,
                completed: completedCount,
              });
              return { ok: true as const, kstTs, previewUrl, res };
            } catch {
              completedCount += 1;
              setBulkUploading({
                active: true,
                total: files.length,
                completed: completedCount,
              });
              URL.revokeObjectURL(previewUrl);
              return { ok: false as const };
            }
          })
        );

        const successes = analyzed.filter((a) => a.ok);
        if (successes.length === 0) {
          showToast(
            '사진을 읽지 못했어요. 한 장씩 다시 올리거나 숫자를 직접 입력해 주세요.',
            'error'
          );
          return;
        }

        // Update KST date info from the first successfully read photo
        const firstTs = successes[0].kstTs;
        setKstDateInfo({
          koreanDate: firstTs.koreanDate,
          compactDateTime: firstTs.compactDateTime,
          fromPhoto: true,
        });
        setInputs((prev) => ({
          ...prev,
          ym: firstTs.ym,
          monthLabel: ymToKoreanLabel(firstTs.ym),
        }));

        const assignments = assignBulkPhotosToSlots(
          successes.map((s) => ({
            detectedType: s.res.detectedType,
            meterValue: s.res.meterValue ?? null,
            meterDigitCount: s.res.meterDigitCount ?? null,
            payload: s,
          })),
          prevBaselines
        );

        for (const { item, targetKind } of assignments) {
          await applyAnalyzedPhotoToSlot(
            targetKind,
            item.payload.previewUrl,
            item.payload.res,
            item.payload.kstTs.compactDateTime,
            '자동 분류됨',
            null
          );
        }

        showToast(
          `${assignments.length}장 사진을 호실별로 자동 정리해서 채워 넣었어요!`
        );
      } finally {
        setBulkUploading({ active: false, total: 0, completed: 0 });
      }
    },
    [
      applyAnalyzedPhotoToSlot,
      inputs.prev201,
      inputs.prev202,
      inputs.prevTotal,
      showToast,
    ]
  );

  const handleFixSwappedMeters = useCallback(
    (mapping: Record<MeterPhotoKind, MeterPhotoKind>) => {
      setSavedSnapshot(null);
      const currBySlot: Record<MeterPhotoKind, string> = {
        meter201: inputs.curr201,
        meter202: inputs.curr202,
        meterTot: inputs.currTotal,
      };
      setInputs((prev) => ({
        ...prev,
        curr201: currBySlot[mapping.meter201],
        curr202: currBySlot[mapping.meter202],
        currTotal: currBySlot[mapping.meterTot],
      }));
      setPhotos((prev) => ({
        ...prev,
        meter201: prev[mapping.meter201],
        meter202: prev[mapping.meter202],
        meterTot: prev[mapping.meterTot],
      }));
      showToast('201호 · 202호 · 건물 전체 사진과 숫자를 제자리로 맞췄어요!');
    },
    [inputs.curr201, inputs.curr202, inputs.currTotal, showToast]
  );

  const handleClearCurrentMonth = useCallback(() => {
    setSavedSnapshot(null);
    setInputs((prev) => ({
      ...prev,
      billAmount: '',
      billUsage: '',
      currTotal: '',
      curr201: '',
      curr202: '',
      totalMeterReplaced: false,
    }));
    setAutoFilledFields({});
    showToast('이번 달 입력한 숫자를 모두 비웠어요.');
  }, [showToast]);

  const handleStartNewSettlement = useCallback(() => {
    setSavedSnapshot(null);
    setPhotos((prev) => {
      (Object.keys(prev) as PhotoKind[]).forEach((k) => {
        const u = prev[k].previewUrl;
        const f = prev[k].focusedPreviewUrl;
        if (u) URL.revokeObjectURL(u);
        if (f && f !== u) URL.revokeObjectURL(f);
      });
      return createInitialPhotos();
    });
    setInputs((prev) => ({
      ...prev,
      prevTotal: String(settings.prevTotal),
      prev201: String(settings.prev201),
      prev202: String(settings.prev202),
      accountInfo: settings.accountInfo,
      billAmount: '',
      billUsage: '',
      currTotal: '',
      curr201: '',
      curr202: '',
      totalMeterReplaced: false,
    }));
    setAutoFilledFields({});
    showToast('새 정산을 시작할 수 있게 화면을 비웠어요.');
  }, [settings, showToast]);

  const handleSaveToDb = useCallback(async (): Promise<boolean> => {
    if (!calc.isReady) {
      showToast('먼저 고지서 금액과 계량기 숫자를 모두 입력해 주세요.', 'error');
      return false;
    }

    const ym = inputs.ym || getCurrentYm();
    const monthLabel = inputs.monthLabel.trim() || ymToKoreanLabel(ym);
    const accountInfo = inputs.accountInfo.trim() || DEFAULT_SETTINGS.accountInfo;
    const recordId = `rec_${ym}_${Date.now()}`;
    const newRecord: BillingRecord = {
      id: recordId,
      ym,
      monthLabel,
      billAmount: calc.billAmt,
      billUsage: Number(inputs.billUsage) > 0 ? Number(inputs.billUsage) : calc.uTot,
      usageTotal: calc.uTot,
      usage201: calc.u201,
      usage202: calc.u202,
      usageShop: calc.uShop,
      adjustmentTarget: calc.widest,
      addedAmount: calc.added,
      finalAmtSum: calc.finalSum,
      currTotal: calc.currTot,
      curr201: calc.curr201,
      curr202: calc.curr202,
      isBaseRecord: false,
    };

    const nextSettings: BillingSettings = {
      prevTotal: calc.currTot,
      prev201: calc.curr201,
      prev202: calc.curr202,
      accountInfo,
      seededBase: true,
    };

    const snapshot: SavedSettlementSnapshot = {
      recordId,
      ym,
      monthLabel,
      accountInfo,
      calc: { ...calc },
    };

    setSaving(true);
    // Lock snapshot before cloud write so onSnapshot settings update never overwrites current inputs
    savedSnapshotRef.current = snapshot;
    try {
      if (user) {
        await saveSettlementCloud(user.uid, newRecord, nextSettings);
      } else {
        const updatedRecords = [...records, newRecord].sort((a, b) =>
          a.ym.localeCompare(b.ym)
        );
        setRecords(updatedRecords);
        setSettings(nextSettings);
        saveLocalRecords(updatedRecords);
        saveLocalSettings(nextSettings);
      }

      setSavedSnapshot(snapshot);
      showToast('정산을 저장했어요! 이제 아래에서 문자를 보내주세요.');
      return true;
    } catch (err) {
      savedSnapshotRef.current = null;
      setFatalError(err instanceof Error ? err : new Error(String(err)));
      return false;
    } finally {
      setSaving(false);
    }
  }, [calc, inputs, records, showToast, user]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDialogBusy(true);
    try {
      const remaining = records.filter((r) => r.id !== deleteTarget.id);
      const latestRemainingWithMeters = remaining
        .filter(
          (r) =>
            r.currTotal !== null &&
            r.curr201 !== null &&
            r.curr202 !== null
        )
        .sort((a, b) => b.ym.localeCompare(a.ym))[0];

      const latestBeforeDelete = records
        .filter(
          (r) =>
            r.currTotal !== null &&
            r.curr201 !== null &&
            r.curr202 !== null
        )
        .sort((a, b) => b.ym.localeCompare(a.ym))[0];

      const matchesCurrentSettings =
        deleteTarget.currTotal === settings.prevTotal &&
        deleteTarget.curr201 === settings.prev201 &&
        deleteTarget.curr202 === settings.prev202;
      const isLatestMeterRecord = latestBeforeDelete?.id === deleteTarget.id;
      const shouldRollbackPrev = matchesCurrentSettings || isLatestMeterRecord;

      const nextPrev = latestRemainingWithMeters
        ? {
            prevTotal: latestRemainingWithMeters.currTotal!,
            prev201: latestRemainingWithMeters.curr201!,
            prev202: latestRemainingWithMeters.curr202!,
          }
        : {
            prevTotal: DEFAULT_SETTINGS.prevTotal,
            prev201: DEFAULT_SETTINGS.prev201,
            prev202: DEFAULT_SETTINGS.prev202,
          };

      if (savedSnapshotRef.current?.recordId === deleteTarget.id) {
        savedSnapshotRef.current = null;
        setSavedSnapshot(null);
      }

      if (user) {
        await deleteBillingRecordCloud(
          user.uid,
          deleteTarget.id,
          shouldRollbackPrev ? nextPrev : null
        );
      } else {
        setRecords(remaining);
        saveLocalRecords(remaining);
        if (shouldRollbackPrev) {
          const nextSettings: BillingSettings = {
            ...settings,
            ...nextPrev,
          };
          setSettings(nextSettings);
          saveLocalSettings(nextSettings);
        }
      }

      if (shouldRollbackPrev) {
        setInputs((prev) => ({
          ...prev,
          prevTotal: String(nextPrev.prevTotal),
          prev201: String(nextPrev.prev201),
          prev202: String(nextPrev.prev202),
        }));
        showToast(
          `${deleteTarget.ym} 기록을 지우고 지난달 기준을 전체 ${nextPrev.prevTotal} · 201호 ${nextPrev.prev201} · 202호 ${nextPrev.prev202}로 되돌렸어요.`
        );
      } else {
        showToast(`${deleteTarget.ym} 기록을 지웠습니다.`);
      }
      setDeleteTarget(null);
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setDialogBusy(false);
    }
  }, [deleteTarget, records, settings, showToast, user]);

  const handleConfirmReset = useCallback(async () => {
    setDialogBusy(true);
    try {
      if (user) {
        await resetLedgerToBaseCloud(user.uid);
      } else {
        clearLocalStorage();
        setRecords([...BASE_RECORDS]);
        setSettings({ ...DEFAULT_SETTINGS });
        setInputs((prev) => ({
          ...prev,
          prevTotal: String(DEFAULT_SETTINGS.prevTotal),
          prev201: String(DEFAULT_SETTINGS.prev201),
          prev202: String(DEFAULT_SETTINGS.prev202),
          accountInfo: DEFAULT_SETTINGS.accountInfo,
        }));
      }
      showToast('처음 장부(2021~2026) 상태로 되돌렸습니다.');
      setResetDialogOpen(false);
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setDialogBusy(false);
    }
  }, [showToast, user]);

  const handleGoogleLogin = async () => {
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('구글 계정으로 안전하게 연결되었습니다.');
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';
      let msg = '로그인 중 문제가 생겼습니다. 잠시 후 다시 눌러주세요.';
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        msg = '로그인이 취소되었습니다.';
      } else if (code === 'auth/unauthorized-domain') {
        msg = `현재 주소(${window.location.hostname})가 Firebase 승인 도메인에 등록되지 않았습니다. 로그인 없이도 이 기기에서 바로 저장됩니다.`;
      } else if (code === 'auth/popup-blocked') {
        msg = '브라우저에서 로그인 창이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러주세요.';
      } else if (code) {
        msg = `로그인 오류(${code})가 발생했습니다. 로그인 없이도 이 기기에서 바로 사용할 수 있습니다.`;
      }
      showToast(msg, 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    try {
      await signOut(auth);
      showToast('로그아웃되었습니다.');
    } catch {
      showToast('로그아웃 중 문제가 생겼습니다.', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const switchMainTab = (next: ActiveTab) => {
    setActiveTab(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA] text-[#111827] pb-24 md:pb-10">
      {/* Top Bar Contract: 3 clean single-line zones */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-[#DCE3EC]">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark */}
          <button
            type="button"
            onClick={() => switchMainTab('simple')}
            className="text-lg font-extrabold tracking-tight text-[#111827] whitespace-nowrap shrink-0 cursor-pointer"
          >
            수도세 간편 정산
          </button>

          {/* Zone 2: Clean single-line text nav links (Desktop) */}
          <nav
            aria-label="주요 메뉴"
            className="hidden md:flex items-center gap-7 h-full"
          >
            <button
              type="button"
              onClick={() => switchMainTab('simple')}
              className={`h-full inline-flex items-center text-[15px] font-bold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'simple'
                  ? 'border-[#155EEF] text-[#155EEF]'
                  : 'border-transparent text-[#475569] hover:text-[#111827]'
              }`}
            >
              이번 달 정산
            </button>
            <button
              type="button"
              onClick={() => switchMainTab('verify')}
              className={`h-full inline-flex items-center text-[15px] font-bold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'verify'
                  ? 'border-[#155EEF] text-[#155EEF]'
                  : 'border-transparent text-[#475569] hover:text-[#111827]'
              }`}
            >
              지난 기록 보기 ({records.filter((r) => r.finalAmtSum !== null).length})
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            {!authReady ? (
              <div className="w-24 h-10 rounded-xl bg-[#F1F5F9] animate-pulse" />
            ) : user ? (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleSignOut}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F5F7FA] text-sm font-bold text-[#334155] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>로그아웃</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleLogin}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] text-white text-sm font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>{authBusy ? '연결 중...' : '구글 로그인'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-7">
        {activeTab === 'simple' ? (
          <SettlementTab
            inputs={inputs}
            autoFilledFields={autoFilledFields}
            photos={photos}
            calc={calc}
            kstDateInfo={kstDateInfo}
            saving={saving}
            savedSnapshot={savedSnapshot}
            bulkUploading={bulkUploading}
            isCloudSynced={Boolean(user)}
            priorBaselineCandidate={priorBaselineCandidate}
            onInputChange={handleInputChange}
            onApplyPrevBaseline={handleApplyPrevBaseline}
            onToggleTotalMeterReplaced={handleToggleTotalMeterReplaced}
            onPhotoSelect={handlePhotoSelect}
            onBulkPhotoSelect={handleBulkPhotoSelect}
            onFixSwappedMeters={handleFixSwappedMeters}
            onPhotoClear={handlePhotoClear}
            onPhotoRotate={handlePhotoRotate}
            onPhotoZoom={(url, title) => setZoomPhoto({ url, title })}
            onClearCurrentMonth={handleClearCurrentMonth}
            onSaveToDb={handleSaveToDb}
            onStartNewSettlement={handleStartNewSettlement}
            onCopyFeedback={(msg) => showToast(msg, 'success')}
          />
        ) : (
          <div className="space-y-5">
            <div className="max-w-5xl mx-auto">
              <h1 className="text-2xl font-extrabold text-[#111827] tracking-tight">
                지난 수도세 정산 기록
              </h1>
              <p className="text-[15px] text-[#475569] mt-1">
                현재 지난달 기준 숫자: 전체 {settings.prevTotal} · 201호{' '}
                {settings.prev201} · 202호 {settings.prev202}
              </p>
            </div>
            <VerifyDbTab
              records={records}
              accountInfo={settings.accountInfo}
              loading={cloudLoading}
              onDeleteRecord={(rec) => setDeleteTarget(rec)}
              onRequestReset={() => setResetDialogOpen(true)}
              onCopyFeedback={(msg) => showToast(msg, 'success')}
            />
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (58px height; combined with 56px top bar <= 15% cap) */}
      <nav
        aria-label="하단 메뉴"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-[58px] bg-white/95 backdrop-blur-md border-t-2 border-[#DCE3EC] grid grid-cols-2"
      >
        <button
          type="button"
          onClick={() => switchMainTab('simple')}
          className={`flex flex-col items-center justify-center gap-0.5 text-sm font-extrabold transition-colors cursor-pointer ${
            activeTab === 'simple'
              ? 'text-[#155EEF] bg-[#EEF4FF]/60'
              : 'text-[#475569]'
          }`}
        >
          <Calculator className="w-5 h-5" />
          <span>이번 달 정산</span>
        </button>
        <button
          type="button"
          onClick={() => switchMainTab('verify')}
          className={`flex flex-col items-center justify-center gap-0.5 text-sm font-extrabold transition-colors cursor-pointer ${
            activeTab === 'verify'
              ? 'text-[#155EEF] bg-[#EEF4FF]/60'
              : 'text-[#475569]'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span>지난 기록 보기</span>
        </button>
      </nav>

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[92vw] sm:max-w-md px-5 py-3.5 rounded-2xl shadow-xl border text-base font-bold inline-flex items-center gap-2.5 ${
            toast.tone === 'error'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
              : 'bg-[#111827] border-[#1F2937] text-white'
          }`}
        >
          {toast.tone === 'error' ? (
            <AlertCircle className="w-5 h-5 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-[#34D399]" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Photo Zoom Inspection Modal */}
      <PhotoZoomModal
        imageUrl={zoomPhoto?.url ?? null}
        title={zoomPhoto?.title ?? ''}
        subtitle="숫자를 크게 확인한 뒤 닫기(X)를 누르세요"
        onClose={() => setZoomPhoto(null)}
      />

      {/* Delete Single Record Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="정산 기록 지우기"
        description={
          deleteTarget
            ? `${deleteTarget.ym} (${deleteTarget.monthLabel}) 정산 기록을 지울까요? 지우면 다시 되돌릴 수 없습니다.`
            : ''
        }
        confirmLabel="지우기"
        danger
        busy={dialogBusy}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Reset Ledger Confirmation */}
      <ConfirmDialog
        open={resetDialogOpen}
        title="초기 장부로 되돌리기"
        description="새로 저장한 정산 내역을 지우고 2021~2026년 기본 장부와 최근 전월 기준 숫자(전체 9 [교체 계량기] · 201호 776 · 202호 1270)로 되돌릴까요?"
        confirmLabel="초기 장부로 복원"
        danger
        busy={dialogBusy}
        onConfirm={handleConfirmReset}
        onCancel={() => setResetDialogOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WaterBillingApp />
    </ErrorBoundary>
  );
}

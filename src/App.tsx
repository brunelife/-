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
} from './firebase/billingStore';
import { auth, googleProvider } from './firebase/firebase';
import {
  type BillingRecord,
  type BillingSettings,
  type PhotoKind,
  type PhotoUploadState,
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
  rotatePhotoUrlCw90,
  runPhotoOcr,
} from './utils/ocrEngine';
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
    };
  });

  const [autoFilledFields, setAutoFilledFields] = useState<
    Record<string, boolean>
  >({});
  const [photos, setPhotos] = useState<Record<PhotoKind, PhotoUploadState>>(
    createInitialPhotos
  );
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
  const [justSaved, setJustSaved] = useState(false);
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
            setInputs((prev) => ({
              ...prev,
              prevTotal: String(cloudSettings.prevTotal),
              prev201: String(cloudSettings.prev201),
              prev202: String(cloudSettings.prev202),
              accountInfo: cloudSettings.accountInfo,
            }));
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

  const handleInputChange = useCallback(
    (field: keyof SettlementInputs, value: string) => {
      setJustSaved(false);
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

  const handlePhotoSelect = useCallback(
    async (kind: PhotoKind, file: File) => {
      setJustSaved(false);
      const previewUrl = URL.createObjectURL(file);

      // Extract capture timestamp in KST (EXIF DateTimeOriginal -> file.lastModified -> now)
      const kstTs = await extractPhotoTimestampKst(file);
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

      setPhotos((prev) => {
        if (prev[kind].previewUrl) {
          URL.revokeObjectURL(prev[kind].previewUrl!);
        }
        if (
          prev[kind].focusedPreviewUrl &&
          prev[kind].focusedPreviewUrl !== prev[kind].previewUrl
        ) {
          URL.revokeObjectURL(prev[kind].focusedPreviewUrl!);
        }
        return {
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
        };
      });

      const prevRefMap: Record<PhotoKind, number> = {
        meter201: Number(inputs.prev201) || 0,
        meter202: Number(inputs.prev202) || 0,
        meterTot: Number(inputs.prevTotal) || 0,
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

        // Automatically rotate upright and create focused comparison preview
        let alignedFullUrl = previewUrl;
        let alignedFocusedUrl: string | null = null;
        if (res.uprightRotateCw !== 0 || res.counterBox) {
          try {
            const aligned = await createAlignedPhotoPreviews(
              previewUrl,
              res.uprightRotateCw,
              res.counterBox,
              kind
            );
            alignedFullUrl = aligned.uprightUrl;
            alignedFocusedUrl = aligned.focusedUrl;
            if (alignedFullUrl !== previewUrl) {
              URL.revokeObjectURL(previewUrl);
            }
          } catch {
            // Keep original previewUrl if alignment fails
          }
        }

        if (kind === 'bill') {
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

          setPhotos((prev) => ({
            ...prev,
            [kind]: {
              ...prev[kind],
              previewUrl: alignedFullUrl,
              focusedPreviewUrl: alignedFocusedUrl,
              status: foundParts.length > 0 ? 'done' : 'error',
              progress: 100,
              detectedSummary:
                foundParts.length > 0 ? foundParts.join(', ') : null,
              alternateValue: null,
              note: res.note || null,
              message:
                foundParts.length > 0
                  ? `읽기 완료: ${foundParts.join(', ')}`
                  : '숫자가 잘 안 보여요. 다음 화면에서 직접 적어주세요.',
            },
          }));
        } else {
          const fieldMap: Record<
            Exclude<PhotoKind, 'bill'>,
            keyof SettlementInputs
          > = {
            meter201: 'curr201',
            meter202: 'curr202',
            meterTot: 'currTotal',
          };
          const targetField = fieldMap[kind];

          if (res.meterValue != null) {
            setInputs((prev) => ({
              ...prev,
              [targetField]: String(res.meterValue),
            }));
            setAutoFilledFields((prev) => ({ ...prev, [targetField]: true }));
            setPhotos((prev) => ({
              ...prev,
              [kind]: {
                ...prev[kind],
                previewUrl: alignedFullUrl,
                focusedPreviewUrl: alignedFocusedUrl,
                status: 'done',
                progress: 100,
                detectedSummary: String(res.meterValue),
                alternateValue: null,
                note: res.note || null,
                message: `읽은 숫자: ${res.meterValue}`,
              },
            }));
          } else {
            setPhotos((prev) => ({
              ...prev,
              [kind]: {
                ...prev[kind],
                previewUrl: alignedFullUrl,
                focusedPreviewUrl: alignedFocusedUrl,
                status: 'error',
                progress: 100,
                detectedSummary: null,
                alternateValue: null,
                note: res.note || null,
                message: '숫자가 잘 안 보여요. 다음 화면에서 직접 적어주세요.',
              },
            }));
          }
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
    [inputs.prev201, inputs.prev202, inputs.prevTotal]
  );

  const handleClearCurrentMonth = useCallback(() => {
    setJustSaved(false);
    setInputs((prev) => ({
      ...prev,
      billAmount: '',
      billUsage: '',
      currTotal: '',
      curr201: '',
      curr202: '',
    }));
    setAutoFilledFields({});
    showToast('이번 달 입력한 숫자를 모두 비웠어요.');
  }, [showToast]);

  const handleSaveToDb = useCallback(async () => {
    if (!calc.isReady) {
      showToast('먼저 고지서 금액과 계량기 숫자를 모두 입력해 주세요.', 'error');
      return;
    }

    const ym = inputs.ym || getCurrentYm();
    const recordId = `rec_${ym}_${Date.now()}`;
    const newRecord: BillingRecord = {
      id: recordId,
      ym,
      monthLabel: inputs.monthLabel.trim() || ymToKoreanLabel(ym),
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
      accountInfo: inputs.accountInfo.trim() || DEFAULT_SETTINGS.accountInfo,
      seededBase: true,
    };

    setSaving(true);
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

      setInputs((prev) => ({
        ...prev,
        prevTotal: String(nextSettings.prevTotal),
        prev201: String(nextSettings.prev201),
        prev202: String(nextSettings.prev202),
        currTotal: '',
        curr201: '',
        curr202: '',
        billAmount: '',
        billUsage: '',
      }));
      setAutoFilledFields({});
      setJustSaved(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('이번 달 정산 기록을 안전하게 저장했어요!');
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSaving(false);
    }
  }, [calc, inputs, records, showToast, user]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDialogBusy(true);
    try {
      if (user) {
        await deleteBillingRecordCloud(user.uid, deleteTarget.id);
      } else {
        const updated = records.filter((r) => r.id !== deleteTarget.id);
        setRecords(updated);
        saveLocalRecords(updated);
      }
      showToast(`${deleteTarget.ym} 기록을 지웠습니다.`);
      setDeleteTarget(null);
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setDialogBusy(false);
    }
  }, [deleteTarget, records, showToast, user]);

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
      showToast('처음 장부(2021~2024) 상태로 되돌렸습니다.');
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
            justSaved={justSaved}
            isCloudSynced={Boolean(user)}
            onInputChange={handleInputChange}
            onPhotoSelect={handlePhotoSelect}
            onPhotoClear={handlePhotoClear}
            onPhotoRotate={handlePhotoRotate}
            onPhotoZoom={(url, title) => setZoomPhoto({ url, title })}
            onClearCurrentMonth={handleClearCurrentMonth}
            onSaveToDb={handleSaveToDb}
            onResetSavedFlag={() => setJustSaved(false)}
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
              loading={cloudLoading}
              onDeleteRecord={(rec) => setDeleteTarget(rec)}
              onRequestReset={() => setResetDialogOpen(true)}
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
        description="새로 저장한 정산 내역을 지우고 2021~2024년 처음 장부와 초기 기준 숫자(전체 2276 · 201호 700 · 202호 1008)로 되돌릴까요?"
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

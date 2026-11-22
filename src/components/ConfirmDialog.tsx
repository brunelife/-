import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '취소',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111827]/45 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-md bg-white border border-[#DCE3EC] rounded-2xl p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-bold text-[#111827]"
          >
            {title}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="닫기"
            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-lg text-[#526071] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-[15px] text-[#526071] leading-relaxed mb-6">
          {description}
        </p>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-[#DCE3EC] bg-white hover:bg-[#F5F7FA] text-sm font-semibold text-[#334155] transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-[44px] px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
              danger
                ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
                : 'bg-[#155EEF] hover:bg-[#1048B8]'
            }`}
          >
            {busy ? '처리 중...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

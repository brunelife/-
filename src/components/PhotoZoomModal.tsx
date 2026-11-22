import { useEffect } from 'react';
import { X } from 'lucide-react';

interface PhotoZoomModalProps {
  imageUrl: string | null;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

export function PhotoZoomModal({
  imageUrl,
  title,
  subtitle,
  onClose,
}: PhotoZoomModalProps) {
  useEffect(() => {
    if (!imageUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F172A]/80 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-white rounded-2xl overflow-hidden shadow-2xl border border-[#DCE3EC]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[#E5EBF2]">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#111827] truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-[#526071] truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl text-[#526071] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="bg-[#0F172A] flex items-center justify-center max-h-[75vh] overflow-auto p-3">
          <img
            src={imageUrl}
            alt={title}
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[70vh] object-contain rounded-lg"
          />
        </div>
      </div>
    </div>
  );
}

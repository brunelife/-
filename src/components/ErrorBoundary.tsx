import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  isQuotaError: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      isQuotaError: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || '예기치 않은 오류가 발생했습니다.';
    let isQuotaError = false;

    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        readable = parsed.error;
        if (readable.toLowerCase().includes('quota exceeded')) {
          isQuotaError = true;
        }
      }
    } catch {
      if (readable.toLowerCase().includes('quota exceeded')) {
        isQuotaError = true;
      }
    }

    return {
      hasError: true,
      message: readable,
      isQuotaError,
    };
  }

  componentDidCatch(error: Error): void {
    console.error('Application ErrorBoundary caught:', error);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-[#DCE3EC] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#B54708]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold text-[#111827]">
                {this.state.isQuotaError
                  ? '일일 데이터베이스 할당량 초과'
                  : '화면 처리 중 오류가 발생했습니다'}
              </h1>
            </div>
            <p className="text-sm text-[#526071] leading-relaxed break-words">
              {this.state.isQuotaError
                ? '무료 일일 데이터베이스 읽기/쓰기 한도를 초과했습니다. 내일 한도가 초기화되거나 Firebase 콘솔에서 요금제를 업그레이드한 후 다시 이용할 수 있습니다.'
                : this.state.message}
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#155EEF] hover:bg-[#1048B8] text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>새로고침하여 다시 시작</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

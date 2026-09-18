declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: unknown;
        platform?: string;
        version?: string;
        colorScheme?: string;
        isExpanded?: boolean;
        ready?: () => void;
        expand?: () => void;
        close?: () => void;
        HapticFeedback?: {
          impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged?: () => void;
        };
      };
    };
  }
}

export type TelegramRuntime = {
  inTelegram: boolean;
  platform: string;
  initData: string;
};

export function initTelegram(): TelegramRuntime {
  const webApp = window.Telegram?.WebApp;

  if (webApp) {
    webApp.ready?.();
    webApp.expand?.();
  }

  return {
    inTelegram: Boolean(webApp),
    platform: webApp?.platform ?? 'browser',
    initData: webApp?.initData ?? ''
  };
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
}

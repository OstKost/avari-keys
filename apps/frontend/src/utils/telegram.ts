import { TelegramWebAppInstance } from '../types';

export function getTelegramWebApp(): TelegramWebAppInstance | null {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    return window.Telegram.WebApp;
  }
  return null;
}

export function isTelegramWebAppAvailable(): boolean {
  const tg = getTelegramWebApp();
  return Boolean(tg && tg.initData);
}

export function getTelegramInitData(): string {
  const tg = getTelegramWebApp();
  if (tg && tg.initData) {
    return tg.initData;
  }
  // Fallback: check query parameter ?tgWebAppData= or ?init_data=
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const urlInitData = params.get('tgWebAppData') || params.get('init_data');
    if (urlInitData) return urlInitData;

    // Telegram sometimes passes initData in hash: #tgWebAppData=...
    if (hash.includes('tgWebAppData=')) {
      const hashParams = new URLSearchParams(hash.replace(/^#\/?/, ''));
      return hashParams.get('tgWebAppData') || '';
    }
  }
  return '';
}

export function initTelegramWebApp(): void {
  const tg = getTelegramWebApp();
  if (!tg) return;

  try {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) {
      tg.setHeaderColor('#06141B'); // Match dark cyberpunk theme
    }
    if (tg.setBackgroundColor) {
      tg.setBackgroundColor('#040B0F');
    }
  } catch (err) {
    console.warn('[Telegram WebApp] Failed to initialize WebApp window:', err);
  }
}

export function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  try {
    const tg = getTelegramWebApp();
    if (tg?.HapticFeedback?.impactOccurred) {
      tg.HapticFeedback.impactOccurred(style);
    }
  } catch {
    // Ignore in unsupported environments
  }
}

export function triggerNotificationHaptic(type: 'success' | 'warning' | 'error'): void {
  try {
    const tg = getTelegramWebApp();
    if (tg?.HapticFeedback?.notificationOccurred) {
      tg.HapticFeedback.notificationOccurred(type);
    }
  } catch {
    // Ignore
  }
}

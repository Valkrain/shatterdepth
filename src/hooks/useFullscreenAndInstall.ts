import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function enterImmersiveFullscreen(): void {
  if (typeof document === 'undefined') return;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return;

  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };

  const lockLandscape = () => {
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      orientation?.lock?.('landscape')?.catch(() => {});
    } catch {
      // Ignore unsupported orientation lock
    }
  };

  if (el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(lockLandscape)
      .catch(() => {
        lockLandscape();
      });
  } else if (el.webkitRequestFullscreen) {
    try {
      el.webkitRequestFullscreen();
      lockLandscape();
    } catch {
      lockLandscape();
    }
  } else {
    lockLandscape();
  }
}

export function exitImmersiveFullscreen(): void {
  if (typeof document === 'undefined') return;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void>;
  };
  if (doc.fullscreenElement && doc.exitFullscreen) {
    doc.exitFullscreen().catch(() => {});
  } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
    try {
      doc.webkitExitFullscreen();
    } catch {
      // Ignore
    }
  }
}

export function useFullscreenAndInstall() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalone(standalone);
    };

    checkStandalone();
    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const onFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    };

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitImmersiveFullscreen();
    } else {
      enterImmersiveFullscreen();
    }
  }, [isFullscreen]);

  const installApp = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsStandalone(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  return {
    isFullscreen,
    isStandalone,
    isIOS,
    isInstallable: !!deferredPrompt,
    toggleFullscreen,
    installApp,
  };
}

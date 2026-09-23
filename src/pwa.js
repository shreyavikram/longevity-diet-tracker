export function setupPwa({ navigatorRef = globalThis.navigator, windowRef = globalThis.window,
  onStatus = () => {}, onInstall = () => {}, onUpdate = () => {} } = {}) {
  let registration = null;
  let installEvent = null;
  let reloadOnChange = false;
  let didReload = false;

  windowRef?.addEventListener?.('beforeinstallprompt', event => {
    event.preventDefault();
    installEvent = event;
    onInstall(true);
  });
  windowRef?.addEventListener?.('appinstalled', () => {
    installEvent = null;
    onInstall(false);
    onStatus('App installed. Offline access is ready after the shell finishes saving.');
  });

  // Ask the browser not to evict local history under storage pressure; the answer is advisory.
  Promise.resolve(navigatorRef?.storage?.persist?.()).catch(() => {});

  const serviceWorker = navigatorRef?.serviceWorker;
  if (serviceWorker) {
    serviceWorker.addEventListener('controllerchange', () => {
      if (reloadOnChange && !didReload) {
        didReload = true;
        windowRef.location.reload();
      }
    });
  }
  const ready = (async () => {
    if (!serviceWorker) {
      onStatus('Offline installation is unavailable in this browser. Saved data remains on this device.');
      return;
    }
    try {
      registration = await serviceWorker.register('./sw.js');
      if (registration.waiting && serviceWorker.controller) onUpdate(true);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && serviceWorker.controller) onUpdate(true);
        });
      });
      await serviceWorker.ready;
      onStatus('Offline access is ready on this device.');
    } catch {
      onStatus('Offline access could not be prepared. Check your connection and reload.');
    }
  })();

  return {
    ready,
    install() {
      if (!installEvent) return false;
      const event = installEvent;
      installEvent = null;
      onInstall(false);
      return Promise.resolve(event.prompt()).then(() => event.userChoice);
    },
    applyUpdate() {
      if (!registration?.waiting) return false;
      reloadOnChange = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    }
  };
}

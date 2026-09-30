export function detectInstalled(windowObject, navigatorObject) {
  return Boolean(windowObject?.matchMedia?.('(display-mode: standalone)').matches
    || windowObject?.matchMedia?.('(display-mode: fullscreen)').matches || navigatorObject?.standalone === true);
}

export function installPresentation({ installed, promptAvailable, navigatorObject = {} }) {
  if (installed) return { status: 'Installed', canInstall: false, guidance: '' };
  if (promptAvailable) return { status: 'Available to install', canInstall: true, guidance: 'Keep Screw Fall with your apps. You can also play in this browser.' };
  const ios = 'standalone' in navigatorObject || (navigatorObject.platform === 'MacIntel' && navigatorObject.maxTouchPoints > 1)
    || /iPad|iPhone|iPod/.test(navigatorObject.userAgent || '');
  return { status: 'Play in your browser or install', canInstall: false, guidance: ios
    ? 'Open the Share menu, choose Add to Home Screen, then open Screw Fall from the new icon.'
    : 'Use your browser’s install option, if available. Installation is optional.' };
}

/** Saves a browser-provided prompt; never opens it without an Install click. */
export class InstallManager {
  constructor({ windowObject = window, navigatorObject = navigator, onChange = () => {} } = {}) {
    Object.assign(this, { windowObject, navigatorObject, onChange });
    this.listeners = []; this.promptEvent = null; this.prompting = false; this.installedEvent = false;
    this.listen(windowObject, 'beforeinstallprompt', event => { event.preventDefault(); this.promptEvent = event; this.emit(); });
    this.listen(windowObject, 'appinstalled', () => { this.promptEvent = null; this.installedEvent = true; this.emit(); });
    const media = windowObject.matchMedia?.('(display-mode: standalone)');
    if (media?.addEventListener) this.listen(media, 'change', () => this.emit());
  }
  listen(target, type, listener) { target.addEventListener(type, listener); this.listeners.push({ target, type, listener }); }
  get snapshot() { return installPresentation({ installed: this.installedEvent || detectInstalled(this.windowObject, this.navigatorObject),
    promptAvailable: Boolean(this.promptEvent), navigatorObject: this.navigatorObject }); }
  emit() { this.onChange(this.snapshot); }
  async installFromGesture(event) {
    if (!event?.isTrusted || this.navigatorObject.userActivation?.isActive === false || !this.promptEvent || this.prompting) return false;
    const prompt = this.promptEvent; this.promptEvent = null; this.prompting = true;
    try { await prompt.prompt(); const choice = await prompt.userChoice; return choice?.outcome === 'accepted'; }
    catch { return false; }
    finally { this.prompting = false; this.emit(); }
  }
  dispose() { for (const { target, type, listener } of this.listeners) target.removeEventListener(type, listener); this.listeners.length = 0; this.promptEvent = null; }
}

export async function shareApp({ url, navigatorObject = navigator, copyFallback = () => false }) {
  if (!url) return 'Public sharing is available after deployment.';
  const data = { title: 'Screw Fall', text: 'A smooth endless falling-tower arcade game.', url };
  if (navigatorObject.share && (!navigatorObject.canShare || navigatorObject.canShare(data))) {
    try { await navigatorObject.share(data); return 'Shared.'; }
    catch (error) { if (error?.name === 'AbortError') return ''; }
  }
  try {
    if (navigatorObject.clipboard?.writeText) await navigatorObject.clipboard.writeText(url);
    else if (!copyFallback(url)) return `Copy this link: ${url}`;
    return 'Link copied.';
  } catch { return copyFallback(url) ? 'Link copied.' : `Copy this link: ${url}`; }
}

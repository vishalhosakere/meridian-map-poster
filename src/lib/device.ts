// Capability checks that shape the export flow on phones and tablets.

/** WebKit on iPhone/iPad refuses canvases above 16,777,216 px (4096 × 4096). */
export const IOS_CANVAS_PIXELS = 4096 * 4096

/** Above this area, a phone without a hard cap may still run out of memory, so we warn. */
export const HANDHELD_WARN_PIXELS = IOS_CANVAS_PIXELS

export function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Largest canvas area this browser can allocate, or null when it is large enough not to matter. */
export function canvasPixelBudget(): number | null {
  return isIOS() ? IOS_CANVAS_PIXELS : null
}

export function canShareFiles(): boolean {
  if (typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([], 'poster.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

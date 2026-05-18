/**
 * Copies text to the clipboard with a fallback for non-secure contexts.
 *
 * The Async Clipboard API (`navigator.clipboard`) requires:
 *  - a secure context (HTTPS or localhost)
 *  - the document to be focused
 *  - clipboard-write permission
 *
 * When any of those fail, we fall back to creating a hidden textarea and
 * using the legacy `document.execCommand('copy')`, which works in HTTP dev
 * setups and inside iframes that block the modern API.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // Try modern API first, but only when it can actually work.
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function' &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to textarea fallback
    }
  }

  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)

  // Preserve the existing selection so we can restore it after.
  const selection = document.getSelection()
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  ta.select()
  ta.setSelectionRange(0, ta.value.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(ta)

  if (selection && previousRange) {
    selection.removeAllRanges()
    selection.addRange(previousRange)
  }
  return ok
}

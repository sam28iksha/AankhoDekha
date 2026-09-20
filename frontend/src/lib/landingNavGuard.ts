// Tiny shared flag so an explicit in-page jump (nav link, hero scroll-down
// chevron) doesn't get misread by Landing.tsx's "scrolled past the hero"
// auto-enter listener as organic scrolling — without this, clicking "The
// Problem" would smooth-scroll through the hero boundary and immediately
// bounce the visitor into login before they ever see the section.
let suppressed = false
let timer: ReturnType<typeof setTimeout> | null = null

export function suppressAutoEnter(durationMs = 1200) {
  suppressed = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    suppressed = false
  }, durationMs)
}

export function isAutoEnterSuppressed() {
  return suppressed
}

// pdfjs-dist (used for screenplay PDF parsing, see parseScreenplay.ts) calls
// the very-new Promise.try internally. It's unsupported in older browser/
// WebView versions still found on some school-issued devices, where it
// throws "Promise.try is not a function" as an unhandled rejection and
// silently breaks screenplay upload. Standard polyfill per the TC39 proposal.
if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function (fn, ...args) {
      return new Promise(resolve => resolve(fn(...args)))
    }
}

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'NeonSpace · Network Observatory' }, { name: 'description', content: 'Explore your network in a live, interactive neon graph.' }] }),
  component: StandalonePreview,
})

function StandalonePreview() {
  const [frameLoaded, setFrameLoaded] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const revealWhenReady = () => {
      if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.querySelector('#mesh')) {
        setFrameLoaded(true)
      }
    }
    frame.addEventListener('load', revealWhenReady)
    revealWhenReady()
    return () => frame.removeEventListener('load', revealWhenReady)
  }, [])

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background" aria-label="NeonSpace standalone network observatory">
      <h1 className="sr-only">NeonSpace Network Observatory</h1>
      {!frameLoaded && (
        <div className="absolute inset-0 z-10 flex flex-col bg-background px-5 py-4 text-foreground sm:px-8 sm:py-6" role="status" aria-live="polite">
          <header className="flex items-center gap-3 border-b border-border pb-4">
            <span className="grid size-10 place-items-center rounded-xl border border-primary/30 bg-primary/10 font-mono text-lg text-primary" aria-hidden="true">◉</span>
            <div>
              <p className="m-0 text-sm font-bold tracking-wide">NEONSPACE</p>
              <p className="m-0 font-mono text-[9px] tracking-[0.22em] text-muted-foreground">NETWORK OBSERVATORY</p>
            </div>
            <span className="ml-auto hidden items-center gap-2 rounded-full border border-border px-3 py-2 font-mono text-[9px] tracking-[0.12em] text-muted-foreground sm:flex">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" /> CALIBRATING
            </span>
          </header>
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-6 py-8">
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Live topology</p>
              <h2 className="m-0 text-3xl font-medium tracking-tight sm:text-5xl">Your network, <span className="text-muted-foreground">in orbit.</span></h2>
              <p className="mt-3 text-sm text-muted-foreground">Calibrating the live network field…</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-hidden="true">
              {['KNOWN HOSTS', 'MEDIAN PING', 'LAST SUBNET SWEEP'].map((label) => (
                <div key={label} className="rounded-xl border border-border bg-card p-4">
                  <p className="m-0 font-mono text-[9px] tracking-[0.14em] text-muted-foreground">{label}</p>
                  <div className="mt-3 h-5 w-16 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-2 w-28 max-w-full animate-pulse rounded bg-muted/70" />
                </div>
              ))}
            </div>
            <div className="relative min-h-[clamp(14rem,38vh,24rem)] overflow-hidden rounded-2xl border border-border bg-card" aria-hidden="true">
              <div className="absolute left-1/2 top-1/2 size-72 max-w-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/70" />
              <div className="absolute left-1/2 top-1/2 size-52 max-w-[60vw] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-primary/25" />
              <div className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-primary/15 ring-1 ring-primary/40" />
              <span className="absolute left-[22%] top-[34%] size-2 animate-pulse rounded-full bg-primary shadow-[0_0_18px_var(--primary)]" />
              <span className="absolute right-[22%] top-[62%] size-2 animate-pulse rounded-full bg-accent-foreground shadow-[0_0_18px_var(--accent-foreground)]" />
              <div className="absolute bottom-4 left-4 font-mono text-[9px] tracking-[0.14em] text-muted-foreground">CONNECTING TO NETWORK FIELD</div>
            </div>
          </div>
        </div>
      )}
      <iframe ref={frameRef} title="NeonSpace live network observatory" src="/standalone.html" onLoad={() => setFrameLoaded(true)} className="h-full w-full border-0" />
    </main>
  )
}


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
        <div className="absolute inset-0 z-10 grid place-content-center gap-4 bg-background text-center" role="status" aria-live="polite">
          <span className="mx-auto block size-7 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" />
          <p className="m-0 font-mono text-xs tracking-[0.18em] text-muted-foreground">CALIBRATING NETWORK FIELD</p>
        </div>
      )}
      <iframe ref={frameRef} title="NeonSpace live network observatory" src="/standalone.html" onLoad={() => setFrameLoaded(true)} className="h-full w-full border-0" />
    </main>
  )
}


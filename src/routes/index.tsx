import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'NeonSpace · Network Observatory' }, { name: 'description', content: 'Explore your network in a live, interactive neon graph.' }] }),
  component: StandalonePreview,
})

function StandalonePreview() {
  return <main className="h-dvh w-full overflow-hidden bg-background" aria-label="NeonSpace standalone network observatory"><iframe title="NeonSpace live network observatory" src="/standalone.html" className="h-full w-full border-0" /></main>
}


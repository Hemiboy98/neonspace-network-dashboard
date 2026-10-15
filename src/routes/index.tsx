import { createFileRoute } from '@tanstack/react-router'
import { Activity, ArrowDown, ArrowUp, ChevronRight, CircleDot, CircleCheck, CircleX, Cpu, Gauge, HardDrive, Laptop, Monitor, Orbit, Radio, Router, ScanLine, Shield, Smartphone, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type LinkData = { source: string; destination: string; color: string }
type HealthStatus = 'healthy' | 'degraded' | 'offline'
type FleetScan = { checked: number; counts: Record<HealthStatus, number>; at: string }
type NodeData = { id: string; x: number; y: number; vx: number; vy: number; anchorX: number; anchorY: number; color: string; radius: number; kind: string; health: HealthStatus }

const links: LinkData[] = [
  { source: 'T-Mobile Main Router', destination: 'T-Mobile Mesh Router', color: '#FF007F' },
  { source: 'T-Mobile Main Router', destination: 'Node pve', color: '#FF007F' },
  { source: 'T-Mobile Main Router', destination: 'Wife iMac', color: '#ffffff' },
  { source: 'T-Mobile Main Router', destination: 'Wife Laptop 1', color: '#ffffff' },
  { source: 'T-Mobile Main Router', destination: 'Wife Laptop 2', color: '#ffffff' },
  { source: 'T-Mobile Main Router', destination: 'Main TV 1 (LG OLED 55)', color: '#39FF14' },
  { source: 'T-Mobile Main Router', destination: 'Main TV 2 (TCL 65 inch)', color: '#39FF14' },
  { source: 'T-Mobile Mesh Router', destination: 'Wife iPhone 16 Pro Max', color: '#A0A0A0' },
  { source: 'T-Mobile Mesh Router', destination: 'My iPad', color: '#A0A0A0' },
  { source: 'T-Mobile Mesh Router', destination: 'ROG Ally X', color: '#00FF00' },
  { source: 'T-Mobile Mesh Router', destination: 'Legion Go S', color: '#00FF00' },
  { source: 'T-Mobile Mesh Router', destination: 'Mesh TV 3 (65 Onn TV)', color: '#39FF14' },
  { source: 'Node pve', destination: 'Tailscale Virtual Network', color: '#4A90E2' },
  { source: 'Tailscale Virtual Network', destination: '100 (plex)', color: '#0000FF' },
  { source: 'Tailscale Virtual Network', destination: '101 (docker)', color: '#00FF00' },
  { source: 'Tailscale Virtual Network', destination: '102 (homarr)', color: '#FF00FF' },
  { source: 'Tailscale Virtual Network', destination: '103 (cloudflared)', color: '#FFA500' },
  { source: 'Tailscale Virtual Network', destination: '9800X3D Gaming PC', color: '#FFFF00' },
  { source: 'Tailscale Virtual Network', destination: 'My Laptop', color: '#ffffff' },
  { source: 'Tailscale Virtual Network', destination: 'S25 Ultra Phone', color: '#A0A0A0' },
  { source: 'Node pve', destination: 'Storage Vault Z Drive', color: '#00FFFF' },
]
const names = [...new Set(links.flatMap(link => [link.source, link.destination]))]
const healthOverrides: Record<string, HealthStatus> = { 'Node pve': 'degraded', '101 (docker)': 'degraded', 'Storage Vault Z Drive': 'offline' }
const healthFor = (name: string): HealthStatus => healthOverrides[name] ?? 'healthy'
const healthCounts = names.reduce<Record<HealthStatus, number>>((counts, name) => { counts[healthFor(name)] += 1; return counts }, { healthy: 0, degraded: 0, offline: 0 })
const healthStyles: Record<HealthStatus, { label: string; text: string; dot: string; border: string; surface: string }> = {
  healthy: { label: 'Healthy', text: 'text-emerald-300', dot: '#39FF88', border: 'border-emerald-400/25', surface: 'bg-emerald-400/[0.07]' },
  degraded: { label: 'Degraded', text: 'text-amber-200', dot: '#FFC857', border: 'border-amber-300/25', surface: 'bg-amber-300/[0.07]' },
  offline: { label: 'Offline', text: 'text-rose-300', dot: '#FF526D', border: 'border-rose-400/25', surface: 'bg-rose-400/[0.07]' },
}
const getKind = (name: string) => /router/i.test(name) ? 'Router' : /tv|oled/i.test(name) ? 'Display' : /phone|iphone/i.test(name) ? 'Mobile device' : /laptop|imac|ipad|pc|ally|legion/i.test(name) ? 'Personal device' : /network/i.test(name) ? 'Virtual network' : /vault|storage/i.test(name) ? 'Storage' : /plex|docker|homarr|cloudflared/i.test(name) ? 'Service' : 'Compute node'
const iconFor = (kind: string): React.ReactNode => kind === 'Router' ? <Router /> : kind === 'Display' ? <Monitor /> : kind === 'Mobile device' ? <Smartphone /> : kind === 'Storage' ? <HardDrive /> : kind === 'Service' || kind === 'Compute node' ? <Cpu /> : <Laptop />
const getStats = (name: string) => {
  const seed = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return { down: (82 + seed % 780).toFixed(1), up: (18 + seed % 184).toFixed(1), uptime: `${31 + seed % 66}d ${String(seed % 24).padStart(2, '0')}h ${String(seed % 60).padStart(2, '0')}m`, packets: (18420 + seed * 317).toLocaleString() }
}

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'NeonSpace · Network Observatory' }, { name: 'description', content: 'Explore your network in a live, interactive neon graph.' }] }),
  component: NetworkDashboard,
})

function NetworkDashboard() {
  const [selected, setSelected] = useState<string | null>('T-Mobile Main Router')
  const [beamSpeed, setBeamSpeed] = useState(1)
  const [isScanning, setIsScanning] = useState(false)
  const [lastScan, setLastScan] = useState<FleetScan | null>(null)
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectNode = useCallback((name: string) => setSelected(name), [])
  const stats = selected ? getStats(selected) : null
  const kind = selected ? getKind(selected) : ''
  const selectedHealth = selected ? healthFor(selected) : null
  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current) }, [])
  const runFleetScan = () => {
    if (isScanning) return
    setIsScanning(true)
    scanTimer.current = setTimeout(() => {
      setIsScanning(false)
      setLastScan({ checked: names.length, counts: healthCounts, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
      scanTimer.current = null
    }, 1800)
  }
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="flex h-[72px] items-center justify-between border-b border-border/70 px-5 md:px-9">
        <div className="flex items-center gap-3">
          <div className="relative grid size-9 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-[0_0_22px_oklch(0.79_0.22_332_/_0.12)]"><Radio size={18} /><span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" /></div>
          <div><div className="font-semibold tracking-tight">NEON<span className="text-primary">SPACE</span></div><div className="font-mono text-[9px] tracking-[0.24em] text-muted-foreground">NETWORK OBSERVATORY</div></div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1.5 sm:flex"><span className="size-1.5 animate-pulse rounded-full bg-amber-300 shadow-[0_0_8px_#ffc857]"/><span className="font-mono text-[9px] tracking-[0.12em] text-foreground">{healthCounts.healthy} HEALTHY</span><span className="font-mono text-[9px] tracking-[0.12em] text-amber-200">{healthCounts.degraded} DEGRADED</span><span className="font-mono text-[9px] tracking-[0.12em] text-rose-300">{healthCounts.offline} OFFLINE</span></div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground"><span className="hidden md:inline">LOCAL GRID / 01</span><span className="text-border">|</span><span className="text-foreground">21 LINKS</span></div>
      </header>

      <div className="px-4 pb-7 pt-7 md:px-9 md:pt-9">
        <div className="mb-6 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary"><span className="h-px w-6 bg-primary"/>Live topology</div><h1 className="text-3xl font-medium tracking-tight md:text-[40px]">Your network, <span className="text-muted-foreground">in orbit.</span></h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">A live field view of every connected device, service, and route in your private network.</p></div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Metric label="NODES" value={String(names.length).padStart(2, '0')} detail="active endpoints" />
            <Metric label="THROUGHPUT" value="842.6" unit="Mbps" detail="aggregate flow" />
            <Metric label="LATENCY" value="08.4" unit="ms" detail="median response" />
          </div>
        </div>

        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="relative min-h-[540px] overflow-hidden rounded-2xl border border-border/80 bg-[#030407] shadow-[inset_0_0_80px_rgba(14,10,28,0.35)] md:min-h-[650px]" aria-label="Interactive network topology">
            <div className="pointer-events-none absolute inset-0 opacity-[0.11]" style={{ backgroundImage: 'linear-gradient(rgba(130,120,190,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(130,120,190,.16) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
            <div className="pointer-events-none absolute left-5 top-5 z-10 flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.13em] text-muted-foreground backdrop-blur"><CircleDot size={11} className="text-primary"/> TOPOLOGY FIELD <span className="text-border">/</span> DRAG TO REPOSITION</div>
            <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-2 sm:right-5 sm:flex-row sm:items-center sm:gap-4">
              <BeamSpeedControl value={beamSpeed} onChange={setBeamSpeed} />
              <div className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.09em] text-amber-100/80"><span className="size-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_#ffc857]"/> SAMPLE</div>
            </div>
            <NetworkCanvas selected={selected} onSelect={selectNode} beamSpeed={beamSpeed} />
            <div className="pointer-events-none absolute bottom-4 left-5 z-10 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[9px] text-muted-foreground">
              <Legend color="#FF007F" label="ROUTING"/><Legend color="#39FF14" label="MEDIA"/><Legend color="#4A90E2" label="OVERLAY"/><Legend color="#00FFFF" label="STORAGE"/>
            </div>
            <div className="pointer-events-none absolute bottom-4 right-5 z-10 hidden font-mono text-[9px] text-muted-foreground md:block">X: 42° 17′ 06″ <span className="px-1 text-border">/</span> Y: 07° 59′ 31″</div>
          </section>

          <aside className={`min-h-[540px] overflow-hidden rounded-2xl border border-border/80 bg-card/70 transition-all duration-500 ease-out xl:min-h-[650px] ${selected ? 'translate-x-0 opacity-100' : 'translate-x-5 opacity-60'}`} aria-live="polite">
            {selected && stats && selectedHealth ? <Inspector name={selected} kind={kind} stats={stats} health={selectedHealth} onClose={() => setSelected(null)} /> : <div className="flex h-full min-h-[540px] flex-col items-center justify-center px-7 text-center"><div className="mb-4 grid size-14 place-items-center rounded-2xl border border-border bg-secondary text-muted-foreground"><Activity size={22}/></div><h2 className="text-sm font-medium">No endpoint selected</h2><p className="mt-2 max-w-[220px] text-xs leading-5 text-muted-foreground">Choose any device in the topology field to open its telemetry.</p></div>}
          </aside>
        </div>
        <section className="mt-4" aria-labelledby="stations-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary"><Orbit size={12}/> ORBITAL STATIONS</div><h2 id="stations-heading" className="mt-1 text-sm font-medium">Fleet command deck</h2></div><span className="font-mono text-[8px] tracking-[0.1em] text-muted-foreground">LOCAL SAMPLE SIMULATION</span></div>
          <div className="grid gap-2.5 md:grid-cols-3">
            <StationCard ship="courier" codename="NEXUS · 01" title="Core uplink" description="Inspect the main router" action="OPEN ROUTER" onClick={() => selectNode('T-Mobile Main Router')} />
            <StationCard ship="relay" codename="MIRAGE · 02" title="Mesh relay" description="Inspect mesh coverage" action="OPEN MESH" onClick={() => selectNode('T-Mobile Mesh Router')} />
            <StationCard ship="carrier" codename="ATLAS · 03" title="Fleet diagnostics" description={lastScan ? `${lastScan.checked} checked · ${lastScan.counts.healthy} healthy · ${lastScan.counts.degraded} degraded · ${lastScan.counts.offline} offline · ${lastScan.at}` : `Run a sample health check on all ${names.length} devices`} action={isScanning ? 'SCANNING…' : lastScan ? 'SCAN AGAIN' : 'RUN FLEET SCAN'} onClick={runFleetScan} busy={isScanning} />
          </div>
        </section>
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"><span>Sample health states · not connected to live devices</span><span className="flex items-center gap-2"><Shield size={11} className="text-primary/70"/> Encrypted topology view</span></footer>
      </div>
    </main>
  )
}

function BeamSpeedControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <label className="flex items-center gap-2 rounded-md border border-border/70 bg-background/80 px-2 py-1.5 font-mono text-[8px] tracking-[0.08em] text-muted-foreground backdrop-blur">
    <Gauge size={12} className="text-primary"/><span className="hidden sm:inline">BEAM SPEED</span><span className="text-foreground">{value.toFixed(2)}×</span>
    <input aria-label="Beam speed" type="range" min="0.25" max="3" step="0.25" value={value} onChange={event => onChange(Number(event.target.value))} className="w-16 cursor-pointer accent-primary sm:w-20" />
  </label>
}

function ShipIllustration({ ship }: { ship: 'courier' | 'relay' | 'carrier' }) {
  const accent = ship === 'courier' ? '#ff58cf' : ship === 'relay' ? '#68e8ff' : '#ffc36a'
  return <svg aria-hidden="true" viewBox="0 0 128 72" className="h-14 w-[92px] shrink-0 overflow-visible transition duration-300 group-hover:scale-110" style={{ color: accent }}>
    <defs>
      <linearGradient id={`hull-${ship}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f8f4ff" stopOpacity=".6"/><stop offset=".42" stopColor={accent} stopOpacity=".22"/><stop offset="1" stopColor="#171525" stopOpacity=".76"/></linearGradient>
      <linearGradient id={`wake-${ship}`} x1="0" y1="0" x2="1" y2="0"><stop stopColor={accent} stopOpacity="0"/><stop offset="1" stopColor={accent} stopOpacity=".8"/></linearGradient>
    </defs>
    <path d="M5 36H34" stroke={`url(#wake-${ship})`} strokeWidth="1.2"/>
    <path d="M11 32H34M16 40H34" stroke={accent} strokeOpacity=".24" strokeWidth=".7"/>
    {ship === 'courier' && <g stroke="currentColor" strokeLinejoin="round">
      <path d="M28 36 51 25 92 28 116 36 91 44 51 47Z" fill={`url(#hull-${ship})`} strokeWidth="1.1"/>
      <path d="m51 25-5-9 20 9m26 3 8-8 6 16M51 47l-5 9 20-9" fill="#ff58cf" fillOpacity=".13" strokeWidth=".8"/>
      <path d="m72 29 12 7-12 5-8-5Z" fill="#effcff" fillOpacity=".7" strokeWidth=".6"/>
      <path d="M30 34H40M30 38H40" strokeWidth=".8"/>
    </g>}
    {ship === 'relay' && <g stroke="currentColor" strokeLinejoin="round">
      <path d="M24 37c8-13 31-18 55-16 16 1 27 8 36 16-9 8-20 15-36 16-24 2-47-3-55-16Z" fill={`url(#hull-${ship})`} strokeWidth="1.1"/>
      <path d="M49 31c8-11 20-14 29-13 8 1 14 5 18 11" fill="#68e8ff" fillOpacity=".14" strokeWidth=".8"/>
      <path d="M35 37h72M53 29l-7-7m37 7 8-9m-38 25-7 7m37-7 8 9" fill="none" strokeOpacity=".6" strokeWidth=".65"/>
      <ellipse cx="76" cy="36" rx="10" ry="4" fill="#e9fbff" fillOpacity=".48" strokeWidth=".6"/>
    </g>}
    {ship === 'carrier' && <g stroke="currentColor" strokeLinejoin="round">
      <path d="m19 36 24-9 59 2 15 7-15 7-59 2Z" fill={`url(#hull-${ship})`} strokeWidth="1.1"/>
      <path d="m42 29-8-11 31 8m18 4 11-10 7 11m-59 9-8 11 31-8" fill="#ffc36a" fillOpacity=".14" strokeWidth=".8"/>
      <path d="m58 30 14-4 13 10-13 10-14-4Z" fill="#fff3d7" fillOpacity=".46" strokeWidth=".65"/>
      <path d="M23 33h14m-14 6h14M48 32v8m8-9v10m34-9v8" fill="none" strokeOpacity=".62" strokeWidth=".7"/>
    </g>}
    <circle cx="31" cy="36" r="1.5" fill={accent}/><circle cx="31" cy="36" r="4" fill={accent} fillOpacity=".12"/>
  </svg>
}

function StationCard({ ship, codename, title, description, action, onClick, busy = false }: { ship: 'courier' | 'relay' | 'carrier'; codename: string; title: string; description: string; action: string; onClick: () => void; busy?: boolean }) {
  return <button type="button" onClick={onClick} disabled={busy} className="group flex min-h-[112px] items-center gap-2.5 rounded-xl border border-border/70 bg-card/55 px-3 py-3 text-left transition duration-200 hover:border-primary/35 hover:bg-card/90 active:scale-[0.99] disabled:cursor-wait sm:gap-3 sm:px-4">
    <span className={`grid h-[72px] w-[94px] shrink-0 place-items-center rounded-lg border border-border/60 bg-background/75 transition group-hover:border-primary/20 ${busy ? 'animate-pulse' : ''}`}><ShipIllustration ship={ship}/></span>
    <span className="min-w-0 flex-1"><span className="block font-mono text-[8px] tracking-[0.14em] text-primary/80">{codename}</span><span className="mt-0.5 block text-xs font-medium text-foreground">{title}</span><span className="mt-1 block text-[9px] leading-4 text-muted-foreground">{description}</span><span className={`mt-1.5 inline-flex rounded border border-border/70 px-1.5 py-0.5 font-mono text-[7px] tracking-[0.08em] ${busy ? 'text-amber-200' : 'text-muted-foreground group-hover:text-foreground'}`}>{action}</span></span>
  </button>
}

function Metric({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail: string }) {
  return <div className="min-w-[100px] rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 sm:min-w-[125px] sm:px-4"><div className="font-mono text-[9px] tracking-[0.16em] text-muted-foreground">{label}</div><div className="mt-1 font-mono text-lg tracking-tight text-foreground sm:text-xl">{value}<span className="ml-1 text-[9px] text-muted-foreground">{unit}</span></div><div className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block">{detail}</div></div>
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 7px ${color}` }}/>{label}</span>
}

function Inspector({ name, kind, stats, health, onClose }: { name: string; kind: string; stats: ReturnType<typeof getStats>; health: HealthStatus; onClose: () => void }) {
  const seed = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const statusStyle = healthStyles[health]
  const StatusIcon = health === 'healthy' ? CircleCheck : health === 'degraded' ? TriangleAlert : CircleX
  const logs = [
    { time: 'NOW', event: health === 'offline' ? 'Heartbeat missed · endpoint unreachable' : health === 'degraded' ? 'Elevated response time detected' : 'Heartbeat acknowledged', type: health === 'healthy' ? 'OK' : 'WARN' },
    { time: '−02s', event: health === 'offline' ? 'No packets received' : `Downlink ${stats.down} Mbps stable`, type: health === 'offline' ? 'WARN' : 'RX' },
    { time: '−06s', event: 'Route integrity verified', type: 'OK' },
    { time: '−11s', event: `${(seed % 8) + 1} packets reassembled`, type: 'DATA' },
  ]
  return <div className="flex h-full min-h-[540px] flex-col animate-fade-in">
    <div className="flex items-center justify-between border-b border-border/70 px-5 py-4"><div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.17em] text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full" style={{ backgroundColor: statusStyle.dot, boxShadow: `0 0 8px ${statusStyle.dot}` }}/> ENDPOINT INSPECTOR</div><button onClick={onClose} aria-label="Close endpoint inspector" className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"><X size={15}/></button></div>
    <div className="flex-1 px-5 py-5">
      <div className="flex items-start gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">{iconFor(kind)}</div><div className="min-w-0 flex-1"><h2 className="break-words text-[15px] font-medium leading-5">{name}</h2><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">{kind} <span className="px-1 text-border">·</span> 192.168.1.{(seed % 200) + 20}</p></div><ChevronRight size={15} className="mt-1 text-muted-foreground"/></div>
      <div className={`mt-4 flex items-center justify-between rounded-lg border px-3 py-2.5 ${statusStyle.border} ${statusStyle.surface}`}><span className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground">DEVICE HEALTH</span><span className={`flex items-center gap-1.5 font-mono text-[9px] ${statusStyle.text}`}><StatusIcon size={12}/>{statusStyle.label.toUpperCase()}</span></div>
      <div className="mt-6 grid grid-cols-2 gap-2.5"><Telemetry label="DOWNLOAD" value={stats.down} unit="Mbps" icon={<ArrowDown size={12}/>} color="text-cyan-300"/><Telemetry label="UPLOAD" value={stats.up} unit="Mbps" icon={<ArrowUp size={12}/>} color="text-primary"/><Telemetry label="UPTIME" value={stats.uptime} unit="" icon={<Activity size={12}/>} color="text-emerald-300"/><Telemetry label="PACKETS RX" value={stats.packets} unit="" icon={<Cpu size={12}/>} color="text-amber-200"/></div>
      <div className="mt-6"><div className="mb-3 flex items-center justify-between"><h3 className="font-mono text-[9px] tracking-[0.16em] text-muted-foreground">PACKET STREAM</h3><span className="rounded border border-amber-300/20 bg-amber-300/[0.06] px-1.5 py-0.5 font-mono text-[8px] text-amber-100">SAMPLE</span></div><div className="overflow-hidden rounded-lg border border-border/70 bg-background/70">{logs.map((log, index) => <div key={log.time} className={`flex items-start gap-2.5 px-3 py-3 ${index > 0 ? 'border-t border-border/50' : ''}`}><span className="w-8 shrink-0 pt-0.5 font-mono text-[8px] text-muted-foreground">{log.time}</span><span className={`mt-0.5 shrink-0 rounded px-1 font-mono text-[7px] ${log.type === 'OK' ? 'bg-emerald-400/10 text-emerald-300' : log.type === 'WARN' ? 'bg-amber-300/10 text-amber-200' : 'bg-primary/10 text-primary'}`}>{log.type}</span><span className="text-[10px] leading-4 text-foreground/75">{log.event}</span></div>)}</div></div>
      <div className={`mt-5 flex items-center justify-between rounded-lg border px-3 py-2.5 ${statusStyle.border} ${statusStyle.surface}`}><span className="font-mono text-[9px] tracking-[0.11em] text-muted-foreground">LINK STATE</span><span className={`flex items-center gap-1.5 font-mono text-[9px] ${statusStyle.text}`}><StatusIcon size={11}/>{statusStyle.label.toUpperCase()}</span></div>
    </div>
    <div className="border-t border-border/70 px-5 py-3 font-mono text-[8px] tracking-[0.12em] text-muted-foreground">SIGNAL LOCKED <span className="px-1 text-border">/</span> ENCRYPTED</div>
  </div>
}

function Telemetry({ label, value, unit, icon, color }: { label: string; value: string; unit: string; icon: React.ReactNode; color: string }) {
  return <div className="rounded-lg border border-border/70 bg-background/55 px-3 py-3"><div className="flex items-center justify-between"><span className="font-mono text-[8px] tracking-[0.12em] text-muted-foreground">{label}</span><span className={color}>{icon}</span></div><div className="mt-2 break-words font-mono text-[13px] tracking-tight">{value}<span className="ml-1 text-[8px] text-muted-foreground">{unit}</span></div></div>
}

function NetworkCanvas({ selected, onSelect, beamSpeed }: { selected: string | null; onSelect: (name: string) => void; beamSpeed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectedRef = useRef(selected)
  const selectRef = useRef(onSelect)
  const speedRef = useRef(beamSpeed)
  useEffect(() => { selectedRef.current = selected; selectRef.current = onSelect; speedRef.current = beamSpeed }, [selected, onSelect, beamSpeed])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    let width = 0, height = 0, frame = 0, tick = 0
    const positions = new Map<string, NodeData>()
    let dragging: NodeData | null = null
    let pointer = { x: -9999, y: -9999 }
    const stars = Array.from({ length: 100 }, (_, i) => ({ x: ((i * 173 + 23) % 997) / 997, y: ((i * 311 + 97) % 991) / 991, a: 0.16 + (i % 7) * 0.07, r: i % 11 === 0 ? 1.3 : 0.65 }))
    const planets = [
      { x: 0.32, y: 0.22, r: 25, color: '#d49cff', ring: '#d8a8ff', shadow: '#542c88' },
      { x: 0.79, y: 0.29, r: 15, color: '#5ee5da', ring: '#85fff1', shadow: '#176e78' },
      { x: 0.12, y: 0.41, r: 20, color: '#ff9a75', ring: '#ffc29d', shadow: '#7e382d' },
      { x: 0.54, y: 0.14, r: 17, color: '#ffcf69', ring: '#ffe2a0', shadow: '#765328' },
      { x: 0.9, y: 0.82, r: 23, color: '#81aaff', ring: '#b1cbff', shadow: '#293e80' },
      { x: 0.47, y: 0.86, r: 13, color: '#78e8a9', ring: '#a5ffd0', shadow: '#246d51' },
    ]
    const drawPlanet = (planet: typeof planets[number]) => {
      const scale = Math.max(0.58, Math.min(1.12, width / 820)), x = planet.x * width, y = planet.y * height, r = planet.r * scale
      context.save(); context.globalAlpha = 0.23
      context.beginPath(); context.ellipse(x, y, r * 2.05, r * 0.65, -0.28, 0, Math.PI * 2); context.strokeStyle = planet.ring; context.lineWidth = 1; context.shadowColor = planet.ring; context.shadowBlur = 12; context.stroke()
      const surface = context.createRadialGradient(x - r * 0.38, y - r * 0.4, r * 0.04, x, y, r * 1.2)
      surface.addColorStop(0, '#f5f1ff'); surface.addColorStop(0.18, planet.color); surface.addColorStop(0.63, planet.shadow); surface.addColorStop(1, '#080912')
      context.globalAlpha = 0.73; context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.fillStyle = surface; context.shadowColor = planet.color; context.shadowBlur = 18; context.fill()
      context.save(); context.beginPath(); context.arc(x, y, r * 0.98, 0, Math.PI * 2); context.clip(); context.globalAlpha = 0.11
      for (let band = -2; band <= 2; band++) { context.beginPath(); context.ellipse(x, y + band * r * 0.3, r * 0.92, r * (0.16 + Math.abs(band) * 0.035), 0, 0, Math.PI * 2); context.strokeStyle = planet.ring; context.lineWidth = Math.max(1, r * 0.08); context.stroke() }
      context.restore(); context.globalAlpha = 0.17; context.beginPath(); context.ellipse(x, y, r * 2.05, r * 0.65, -0.28, Math.PI * 1.08, Math.PI * 1.92); context.strokeStyle = planet.ring; context.stroke(); context.restore()
    }
    const anchors = (name: string, index: number) => {
      const group = /T-Mobile Main/i.test(name) ? [0.42, 0.47] : /T-Mobile Mesh/i.test(name) ? [0.26, 0.55] : /Node pve/i.test(name) ? [0.59, 0.36] : /Tailscale/i.test(name) ? [0.69, 0.56] : /plex|docker|homarr|cloudflared/i.test(name) ? [0.85, 0.47] : /Storage Vault/i.test(name) ? [0.72, 0.82] : /Gaming PC|My Laptop|S25/i.test(name) ? [0.87, 0.72] : /TV/i.test(name) ? [0.1 + (index % 3) * 0.06, 0.18 + (index % 3) * 0.17] : /iPhone|iPad|ROG|Legion/i.test(name) ? [0.1 + (index % 4) * 0.04, 0.76 + (index % 2) * 0.08] : [0.3 + (index % 3) * 0.08, 0.82]
      return { x: group[0] * width, y: group[1] * height }
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width; height = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      names.forEach((name, index) => {
        const anchor = anchors(name, index)
        const existing = positions.get(name)
        if (existing) { existing.anchorX = anchor.x; existing.anchorY = anchor.y }
        else {
          const kind = getKind(name)
          positions.set(name, { id: name, x: anchor.x + Math.sin(index * 7.2) * 24, y: anchor.y + Math.cos(index * 4.7) * 22, vx: 0, vy: 0, anchorX: anchor.x, anchorY: anchor.y, color: links.find(link => link.destination === name)?.color ?? '#FF007F', radius: /T-Mobile Main Router|Node pve|Tailscale Virtual Network/.test(name) ? 6 : 4.2, kind, health: healthFor(name) })
        }
      })
    }
    const point = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
    const nearest = (x: number, y: number) => [...positions.values()].map(node => ({ node, d: Math.hypot(node.x - x, node.y - y) })).filter(item => item.d < Math.max(15, item.node.radius + 9)).sort((a, b) => a.d - b.d)[0]?.node ?? null
    const down = (event: PointerEvent) => {
      const p = point(event); pointer = p; dragging = nearest(p.x, p.y)
      if (dragging) { canvas.setPointerCapture(event.pointerId); selectRef.current(dragging.id) }
    }
    const move = (event: PointerEvent) => {
      pointer = point(event)
      if (dragging) { dragging.x = pointer.x; dragging.y = pointer.y; dragging.vx = 0; dragging.vy = 0 }
      else canvas.style.cursor = nearest(pointer.x, pointer.y) ? 'grab' : 'default'
    }
    const up = () => { if (dragging) canvas.style.cursor = 'grab'; dragging = null }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
    const draw = () => {
      frame = requestAnimationFrame(draw); tick += 0.016 * speedRef.current
      context.clearRect(0, 0, width, height)
      const glow = context.createRadialGradient(width * 0.53, height * 0.48, 8, width * 0.53, height * 0.48, Math.max(width, height) * 0.62)
      glow.addColorStop(0, 'rgba(24, 11, 34, 0.30)'); glow.addColorStop(1, 'rgba(3, 4, 7, 0)'); context.fillStyle = glow; context.fillRect(0, 0, width, height)
      stars.forEach(star => { context.globalAlpha = star.a * (0.7 + Math.sin(tick * 1.6 + star.x * 25) * 0.3); context.fillStyle = '#c9d6ff'; context.beginPath(); context.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2); context.fill() })
      context.globalAlpha = 1
      planets.forEach(drawPlanet)
      const nodes = [...positions.values()]
      nodes.forEach(node => { if (node !== dragging) { const dx = node.anchorX - node.x, dy = node.anchorY - node.y; node.vx += dx * 0.0009; node.vy += dy * 0.0009; nodes.forEach(other => { if (node === other) return; const rx = node.x - other.x, ry = node.y - other.y, distance = Math.max(16, Math.hypot(rx, ry)); if (distance < 40) { node.vx += rx / distance * 0.018; node.vy += ry / distance * 0.018 } }); node.vx *= 0.985; node.vy *= 0.985; node.x += node.vx; node.y += node.vy } })
      links.forEach((link, index) => {
        const a = positions.get(link.source), b = positions.get(link.destination); if (!a || !b) return
        const pulse = (Math.sin(tick * 2.1 + index * 0.83) + 1) / 2
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy)), nx = -dy / length, ny = dx / length
        const bend = Math.sin(tick * 0.45 + index * 0.63) * 5
        const control = { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend }
        for (const strand of [-3, -1.5, 0, 1.5, 3]) {
          context.save(); context.beginPath(); context.moveTo(a.x + nx * strand, a.y + ny * strand); context.quadraticCurveTo(control.x + nx * strand, control.y + ny * strand, b.x + nx * strand, b.y + ny * strand); context.strokeStyle = link.color; context.globalAlpha = strand === 0 ? 0.23 + pulse * 0.27 : 0.07 + pulse * 0.1; context.lineWidth = strand === 0 ? 0.9 + pulse * 0.55 : 0.45; context.shadowColor = link.color; context.shadowBlur = strand === 0 ? 12 : 5; context.stroke(); context.restore()
        }
        const pointOnStrand = (phase: number) => ({ x: (1 - phase) ** 2 * a.x + 2 * (1 - phase) * phase * control.x + phase ** 2 * b.x, y: (1 - phase) ** 2 * a.y + 2 * (1 - phase) * phase * control.y + phase ** 2 * b.y })
        for (let packet = 0; packet < 2; packet++) {
          const phase = (tick * (0.12 + (index % 4) * 0.025) + index * 0.173 + packet * 0.5) % 1
          const head = pointOnStrand(phase), tail = pointOnStrand(Math.max(0, phase - 0.035))
          const trail = context.createLinearGradient(tail.x, tail.y, head.x, head.y)
          trail.addColorStop(0, 'rgba(255,255,255,0)'); trail.addColorStop(0.6, link.color); trail.addColorStop(1, '#fff8ff')
          context.save(); context.beginPath(); context.moveTo(tail.x, tail.y); context.lineTo(head.x, head.y); context.strokeStyle = trail; context.lineWidth = 2.3; context.globalAlpha = 0.78; context.shadowColor = link.color; context.shadowBlur = 12; context.stroke()
          context.beginPath(); context.arc(head.x, head.y, 2.1 + pulse * 0.8, 0, Math.PI * 2); context.fillStyle = link.color; context.shadowBlur = 16; context.globalAlpha = 0.93; context.fill()
          context.beginPath(); context.arc(head.x, head.y, 0.85, 0, Math.PI * 2); context.fillStyle = '#fffaff'; context.globalAlpha = 0.92; context.shadowBlur = 4; context.fill(); context.restore()
        }
      })
      nodes.forEach(node => {
        const chosen = selectedRef.current === node.id, hover = Math.hypot(pointer.x - node.x, pointer.y - node.y) < 17, pulse = 0.7 + Math.sin(tick * 2.4 + node.x * 0.01) * 0.18, radius = node.radius * (chosen ? 1.32 : 1)
        context.save(); context.globalAlpha = 0.1 + pulse * 0.12; context.beginPath(); context.arc(node.x, node.y, radius * (chosen ? 4 : 3), 0, Math.PI * 2); context.fillStyle = node.color; context.shadowColor = node.color; context.shadowBlur = 24; context.fill(); context.restore()
        context.save(); context.beginPath(); context.arc(node.x, node.y, radius, 0, Math.PI * 2); context.fillStyle = '#080a10'; context.strokeStyle = node.color; context.lineWidth = chosen ? 1.8 : 1.2; context.shadowColor = node.color; context.shadowBlur = chosen || hover ? 17 : 9; context.fill(); context.stroke(); context.restore()
        context.save(); context.beginPath(); context.arc(node.x + radius * 0.72, node.y - radius * 0.72, 2.5, 0, Math.PI * 2); context.fillStyle = healthStyles[node.health].dot; context.shadowColor = healthStyles[node.health].dot; context.shadowBlur = 8; context.fill(); context.restore()
        if (chosen) { context.save(); context.beginPath(); context.arc(node.x, node.y, radius + 5 + pulse * 2, 0, Math.PI * 2); context.strokeStyle = node.color; context.globalAlpha = 0.45; context.setLineDash([2, 5]); context.stroke(); context.restore() }
        const text = node.id
        context.save(); context.font = `${chosen ? '500' : '400'} 9px "IBM Plex Mono", monospace`; const textWidth = context.measureText(text).width, labelX = node.x - textWidth / 2, labelY = node.y + radius + 15
        context.fillStyle = chosen ? 'rgba(10, 9, 16, 0.92)' : 'rgba(5, 6, 10, 0.78)'; context.fillRect(labelX - 5, labelY - 9, textWidth + 10, 15)
        context.fillStyle = chosen ? '#f5e8f4' : hover ? '#f4f2fb' : 'rgba(210, 216, 235, 0.78)'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.shadowColor = node.color; context.shadowBlur = chosen ? 8 : 0; context.fillText(text, node.x, labelY - 1); context.restore()
      })
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); draw()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up) }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" aria-label="Interactive network graph. Drag any node to move it and select it to inspect telemetry." role="img" />
}

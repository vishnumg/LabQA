"use client"
import { BarChart3 } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, ReferenceLine, Tooltip, Legend } from 'recharts'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Download, Image as ImageIcon, SlidersHorizontal } from 'lucide-react'
import { makeTargetKey } from './targetKeyHelpers'

type ChartsProps = {
    selectedBranch: string
    selectedParameter: string
    parameters: Array<{ id: string; name: string; unit?: string }>
    chartData: { L1: any[]; L2: any[]; L3: any[] }
    targetValues: Record<string, { mean: number; sd: number; validFrom: string }>
    observedStats: Record<string, { n: number; mean: string; sd: string }>
    setSelectedParameter: (v: string) => void
}

const LEVELS: Array<'L1' | 'L2' | 'L3'> = ['L1', 'L2', 'L3']

export default function Charts({ selectedBranch, selectedParameter, parameters, chartData, targetValues, observedStats, setSelectedParameter }: ChartsProps) {
    const keyFor = (level: string) => makeTargetKey(selectedBranch, selectedParameter, level)

    // Helper to format numbers in tooltips (trim long decimals, remove trailing zeros)
    const fmt = (n: any, decimals = 3) => {
        if (n === null || n === undefined || n === '') return '—'
        const num = Number(n)
        if (Number.isNaN(num)) return '—'
        // Fixed then strip trailing zeros and optional dot
        return num.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.[0-9]*?[1-9])0+$/, '$1')
    }

    const renderChart = (level: 'L1' | 'L2' | 'L3') => {
        const data = chartData[level] || []
        const target = targetValues[keyFor(level)]
        const mean = target?.mean
        const sd = target?.sd
        const upper3 = mean != null && sd != null ? mean + 3 * sd : undefined
        const lower3 = mean != null && sd != null ? mean - 3 * sd : undefined
        const upper2 = mean != null && sd != null ? mean + 2 * sd : undefined
        const lower2 = mean != null && sd != null ? mean - 2 * sd : undefined
        const upper1 = mean != null && sd != null ? mean + sd : undefined
        const lower1 = mean != null && sd != null ? mean - sd : undefined
        return (
            <div key={level} className="bg-white rounded-lg shadow p-4 space-y-2" data-chart-level={level}>
                <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-sm">{parameters.find(p => p.id === selectedParameter)?.name || selectedParameter} – {level}</h3>
                    {mean != null && sd != null && (
                        <div className="text-xs text-gray-600 flex gap-3">
                            <span>Mean: {fmt(mean)}</span>
                            <span>SD: {fmt(sd)}</span>
                            <span>n: {observedStats[level]?.n || 0}</span>
                        </div>
                    )}
                </div>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 10, left: 4, right: 4, bottom: 0 }}>
                            <CartesianGrid stroke="#eee" strokeDasharray="4 4" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={60} />
                            <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                            <Tooltip formatter={(val: any, _name, ctx) => [fmt(val), ctx?.payload?.zScore != null ? `Value (Z=${fmt(ctx.payload.zScore)})` : 'Value']} />
                            {mean != null && <ReferenceLine y={mean} stroke="#2563eb" strokeWidth={2} />}
                            {upper3 != null && <ReferenceLine y={upper3} stroke="#dc2626" strokeDasharray="4 4" />}
                            {lower3 != null && <ReferenceLine y={lower3} stroke="#dc2626" strokeDasharray="4 4" />}
                            {upper2 != null && <ReferenceLine y={upper2} stroke="#f59e0b" strokeDasharray="4 4" />}
                            {lower2 != null && <ReferenceLine y={lower2} stroke="#f59e0b" strokeDasharray="4 4" />}
                            {upper1 != null && <ReferenceLine y={upper1} stroke="#6b7280" strokeDasharray="4 4" />}
                            {lower1 != null && <ReferenceLine y={lower1} stroke="#6b7280" strokeDasharray="4 4" />}
                            <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                {data.length === 0 && (
                    <div className="text-xs text-gray-500">No data points for {level} in selected date range.</div>
                )}
            </div>
        )
    }

    // Build combined z-score dataset (one point per date per level) using existing chartData arrays (which contain zScore & value)
    const combinedData = (() => {
        // Gather all unique dates across levels
        const dateSet = new Set<string>()
        LEVELS.forEach(l => (chartData[l] || []).forEach((d: any) => dateSet.add(d.date)))
        const dates = Array.from(dateSet).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
        return dates.map(date => {
            const row: any = { date }
            LEVELS.forEach(l => {
                const found = (chartData[l] || []).find((d: any) => d.date === date)
                row[`${l}Z`] = found?.zScore ?? null
            })
            return row
        })
    })()

    const anyZ = combinedData.some(r => LEVELS.some(l => r[`${l}Z`] != null))

    // State for legend toggling
    const [visible, setVisible] = useState<Record<string, boolean>>({ L1Z: true, L2Z: true, L3Z: true })
    const toggleSeries = (key: string) => setVisible(v => ({ ...v, [key]: !v[key] }))

    // Mouse wheel zoom & drag pan on combined chart
    const [windowIdx, setWindowIdx] = useState<{ start: number; end: number }>({ start: 0, end: combinedData.length - 1 })
    // Adjust window if data size changes
    if (windowIdx.end !== combinedData.length - 1 && combinedData.length && windowIdx.end > combinedData.length - 1) {
        // shrink to new length
        windowIdx.end = combinedData.length - 1
        if (windowIdx.start > windowIdx.end) windowIdx.start = 0
    }
    const viewData = useMemo(() => combinedData.slice(windowIdx.start, windowIdx.end + 1), [combinedData, windowIdx])
    const clampWindow = (start: number, end: number) => {
        const max = combinedData.length - 1
        start = Math.max(0, Math.min(start, max))
        end = Math.max(0, Math.min(end, max))
        if (end - start < 2) end = Math.min(start + 2, max)
        setWindowIdx({ start, end })
    }
    const onWheel = (e: React.WheelEvent) => {
        if (!combinedData.length) return
        // Note: Cannot preventDefault on passive wheel events in modern browsers
        const delta = e.deltaY
        const span = windowIdx.end - windowIdx.start + 1
        const center = windowIdx.start + span / 2
        const zoomFactor = 0.1 // 10% per notch
        let newSpan = delta > 0 ? span * (1 + zoomFactor) : span * (1 - zoomFactor)
        newSpan = Math.max(5, Math.min(newSpan, combinedData.length))
        const half = newSpan / 2
        let newStart = Math.round(center - half)
        let newEnd = Math.round(center + half)
        if (newStart < 0) { newEnd += -newStart; newStart = 0 }
        if (newEnd > combinedData.length - 1) { const diff = newEnd - (combinedData.length - 1); newStart -= diff; newEnd = combinedData.length - 1; if (newStart < 0) newStart = 0 }
        clampWindow(newStart, newEnd)
    }
    // Drag to pan
    const dragRef = useRef<{ startX: number; startWindow: { start: number; end: number } } | null>(null)
    const onMouseDown = (e: React.MouseEvent) => { dragRef.current = { startX: e.clientX, startWindow: { ...windowIdx } } }
    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragRef.current) return
        const { startX, startWindow } = dragRef.current
        const dx = e.clientX - startX
        const pixelsPerPoint = (e.currentTarget as HTMLDivElement).clientWidth / (startWindow.end - startWindow.start + 1)
        const shift = Math.round(-dx / pixelsPerPoint)
        clampWindow(startWindow.start + shift, startWindow.end + shift)
    }
    const endDrag = () => { dragRef.current = null }
    const resetZoom = () => clampWindow(0, combinedData.length - 1)

    // Alert-only dots: we need a quick lookup from original per-level chartData to see alert markers; assume upstream includes hasAlert flag
    const alertLookup = useMemo(() => {
        const map = new Set<string>()
        LEVELS.forEach(l => (chartData[l] || []).forEach((d: any) => { if (d.hasAlert) map.add(`${d.date}|${l}`) }))
        return map
    }, [chartData])

    // Export PNG: render chart container to canvas via html2canvas (lazy dynamic import to avoid SSR issues)
    const chartRef = useRef<HTMLDivElement | null>(null)
    const exportPNG = useCallback(async () => {
        if (!chartRef.current) return
        try {
            // @ts-ignore - html2canvas types may not be installed
            const mod = await import('html2canvas').catch(() => null)
            if (!mod) { console.warn('html2canvas not available'); return }
            const html2canvas = mod.default
            const canvas = await html2canvas(chartRef.current, { backgroundColor: '#ffffff', scale: 2 })
            const link = document.createElement('a')
            link.download = `${selectedParameter}_${selectedBranch}_combined_zscores.png`
            link.href = canvas.toDataURL('image/png')
            link.click()
        } catch (e) { console.error(e) }
    }, [selectedParameter, selectedBranch])

    // Export CSV
    const exportCSV = useCallback(() => {
        if (!combinedData.length) return
        const headers = ['date', 'L1Z', 'L2Z', 'L3Z']
        const lines = [headers.join(',')]
        combinedData.forEach(r => { lines.push([r.date, r.L1Z ?? '', r.L2Z ?? '', r.L3Z ?? ''].join(',')) })
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `${selectedParameter}_${selectedBranch}_zscores.csv`)
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
    }, [combinedData, selectedParameter, selectedBranch])

    const seriesMeta: Array<{ key: string; label: string; color: string }> = [
        { key: 'L1Z', label: 'L1', color: '#2563eb' },
        { key: 'L2Z', label: 'L2', color: '#16a34a' },
        { key: 'L3Z', label: 'L3', color: '#9333ea' },
    ]
    const customLegend = () => (
        <div className="flex flex-wrap gap-3 text-xs items-center">
            {seriesMeta.map(s => {
                const active = visible[s.key]
                return (
                    <button
                        type="button"
                        key={s.key}
                        onClick={() => toggleSeries(s.key)}
                        className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors ${active ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200 opacity-50'} hover:bg-gray-50 focus:outline-none`}
                        aria-pressed={active}
                    >
                        <span className="w-3 h-3 rounded-sm" style={{ background: s.color, opacity: active ? 1 : 0.4 }} />
                        <span>{s.label}</span>
                        <span className={`w-3 h-3 inline-flex items-center justify-center text-[10px] font-semibold rounded-sm ${active ? 'text-green-600' : 'text-gray-400'}`}>{active ? '✓' : ''}</span>
                    </button>
                )
            })}
        </div>
    )

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="bg-blue-600 text-white p-2 rounded"><BarChart3 className="w-5 h-5" /></div>
                    <h2 className="text-xl font-semibold">Charts & Analysis</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium mb-1">Parameter</label>
                        <select value={selectedParameter} onChange={e => setSelectedParameter(e.target.value)} className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500">
                            {parameters.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                        {LEVELS.map(l => {
                            const t = targetValues[keyFor(l)]
                            return (
                                <div key={l} className="bg-gray-50 rounded p-3 flex flex-col gap-1 min-w-[8rem]">
                                    <div className="font-medium">{l} Targets</div>
                                    {t ? (
                                        <>
                                            <div>Mean: <span className="font-semibold">{fmt(t.mean)}</span></div>
                                            <div>SD: <span className="font-semibold">{fmt(t.sd)}</span></div>
                                            <div className="text-[10px] text-gray-500">since {t.validFrom}</div>
                                        </>
                                    ) : <div className="text-xs text-gray-500">No target</div>}
                                </div>
                            )
                        })}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {LEVELS.map(renderChart)}
                </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2"><SlidersHorizontal className="w-5 h-5 text-blue-600" />Combined Z-Scores (L1 / L2 / L3)</h3>
                    <div className="flex flex-wrap gap-2 text-xs">
                        <button onClick={exportPNG} className="flex items-center gap-1 px-3 py-1.5 rounded border bg-white hover:bg-gray-50"><ImageIcon className="w-4 h-4" />PNG</button>
                        <button onClick={exportCSV} className="flex items-center gap-1 px-3 py-1.5 rounded border bg-white hover:bg-gray-50"><Download className="w-4 h-4" />CSV</button>
                    </div>
                </div>
                <div className="h-96 select-none" ref={chartRef} onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={endDrag} onMouseUp={endDrag}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={viewData} margin={{ top: 10, left: 4, right: 8, bottom: 0 }}>
                            <CartesianGrid stroke="#eee" strokeDasharray="4 4" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={0} angle={-45} textAnchor="end" height={60} />
                            <YAxis tick={{ fontSize: 11 }} domain={[-4, 4]} />
                            <Tooltip formatter={(val: any, name: string) => [fmt(val), `${name} Z`]} />
                            <Legend content={customLegend} />
                            {/* Wheel zoom & drag pan replaces Brush */}
                            {/* Z reference lines */}
                            <ReferenceLine y={0} stroke="#2563eb" strokeWidth={2} />
                            <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="3 3" />
                            <ReferenceLine y={-1} stroke="#6b7280" strokeDasharray="3 3" />
                            <ReferenceLine y={2} stroke="#f59e0b" strokeDasharray="4 4" />
                            <ReferenceLine y={-2} stroke="#f59e0b" strokeDasharray="4 4" />
                            <ReferenceLine y={3} stroke="#dc2626" strokeDasharray="4 4" />
                            <ReferenceLine y={-3} stroke="#dc2626" strokeDasharray="4 4" />
                            {visible.L1Z && <Line type="monotone" dataKey="L1Z" stroke="#2563eb" strokeWidth={2} dot={(props: any) => {
                                const date = props.payload?.date
                                if (!alertLookup.has(`${date}|L1`)) return <g />
                                const { cx, cy } = props
                                return <circle cx={cx} cy={cy} r={4} fill="#dc2626" stroke="#ffffff" strokeWidth={1} />
                            }} connectNulls isAnimationActive={false} name="L1" />}
                            {visible.L2Z && <Line type="monotone" dataKey="L2Z" stroke="#16a34a" strokeWidth={2} dot={(props: any) => {
                                const date = props.payload?.date
                                if (!alertLookup.has(`${date}|L2`)) return <g />
                                const { cx, cy } = props
                                return <circle cx={cx} cy={cy} r={4} fill="#dc2626" stroke="#ffffff" strokeWidth={1} />
                            }} connectNulls isAnimationActive={false} name="L2" />}
                            {visible.L3Z && <Line type="monotone" dataKey="L3Z" stroke="#9333ea" strokeWidth={2} dot={(props: any) => {
                                const date = props.payload?.date
                                if (!alertLookup.has(`${date}|L3`)) return <g />
                                const { cx, cy } = props
                                return <circle cx={cx} cy={cy} r={4} fill="#dc2626" stroke="#ffffff" strokeWidth={1} />
                            }} connectNulls isAnimationActive={false} name="L3" />}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-600">
                    <div>Showing {viewData.length} / {combinedData.length} points</div>
                    <div className="flex gap-2">
                        <button onClick={resetZoom} className="px-2 py-1 border rounded hover:bg-gray-50">Reset</button>
                    </div>
                </div>
                {!anyZ && <div className="text-xs text-gray-500 mt-2">No z-score data available for the selected range.</div>}
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Observed Statistics (Current Range)</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    {LEVELS.map(l => {
                        const s = observedStats[l]
                        return (
                            <div key={l} className="border rounded p-3">
                                <div className="font-medium mb-1">{l}</div>
                                {s ? (
                                    <ul className="space-y-1 text-xs">
                                        <li>n: {s.n}</li>
                                        <li>Mean: {s.mean}</li>
                                        <li>SD: {s.sd}</li>
                                    </ul>
                                ) : <div className="text-xs text-gray-500">No data</div>}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

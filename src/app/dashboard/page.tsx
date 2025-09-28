"use client"
// Migrated full dashboard implementation from former frontend directory.
// (Enhancement) Technician defaults: auto lock branch & ensure first parameter selected after data loads.
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, AlertTriangle, Settings, FileText, Plus, Save, X, Calendar, Download } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'

const Charts = dynamic(() => import('./Charts'), { ssr: false })

type QcEntry = {
    id: string | number
    date: string
    parameter: string
    branch: string
    level: 'L1' | 'L2' | 'L3'
    value: number
    enteredBy: string
    enteredAt: string
    zScore?: number | null
}

type TargetVersion = { mean: number; sd: number; validFrom: string }
type TargetVersionsMap = Record<string, TargetVersion[]>
type TargetMap = Record<string, { mean: number; sd: number; validFrom: string }>

type Alert = {
    id: string
    date: string
    parameter: string
    branch: string
    level: 'L1' | 'L2' | 'L3'
    rule: string
    severity: 'warning' | 'error'
    description: string
    acknowledged: boolean
}

export default function MedicalLabQADashboard() {
    const { claims, ready, logout } = useAuth()
    const [redirected, setRedirected] = useState(false)
    useEffect(() => {
        if (!ready) return
        if (!claims && typeof window !== 'undefined') {
            window.location.replace('/login')
            setRedirected(true)
        }
    }, [ready, claims])
    if (!ready || (!claims && !redirected)) {
        return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading…</div>
    }
    const [currentTab, setCurrentTab] = useState<'dataEntry' | 'charts' | 'alerts' | 'targets' | 'reports'>('dataEntry')
    const [selectedBranch, setSelectedBranch] = useState('')
    const [selectedParameter, setSelectedParameter] = useState('')
    const [dateRange, setDateRange] = useState({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
    })

    const [qcData, setQcData] = useState<QcEntry[]>([])
    const [recentQcData, setRecentQcData] = useState<QcEntry[]>([])
    const [targetVersions, setTargetVersions] = useState<TargetVersionsMap>({})
    const [targetValues, setTargetValues] = useState<TargetMap>({})
    const [alerts, setAlerts] = useState<Alert[]>([])
    const [parameters, setParameters] = useState<Array<{ id: string; name: string; unit?: string }>>([])
    const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
    const rawRole = (claims?.role || 'viewer').toLowerCase()
    const role = rawRole === 'technician' ? 'tech' : rawRole
    const isTech = role === 'tech'
    const userBranch = claims?.branch

    const [entryForm, setEntryForm] = useState({
        date: new Date().toISOString().split('T')[0],
        parameter: '',
        branch: '',
        l1: '', l2: '', l3: ''
    })
    const [targetForm, setTargetForm] = useState({
        parameter: '', level: 'L1', branch: '', mean: '', sd: '', validFrom: new Date().toISOString().split('T')[0]
    }) as any
    const [showTargetModal, setShowTargetModal] = useState(false)
    const [editingTarget, setEditingTarget] = useState<string | null>(null)

    // Initial load
    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!ready || !claims) return
            const [b, p, t] = await Promise.all([
                api.getBranches(),
                api.getParameters(),
                api.getTargets(),
            ])
            if (cancelled) return
            if (b.ok && Array.isArray(b.json?.items)) setBranches(b.json.items)
            if (p.ok && Array.isArray(p.json?.items)) setParameters(p.json.items)
            if (t.ok && Array.isArray(t.json?.items)) {
                const versions: TargetVersionsMap = {}
                t.json.items.forEach((it: any) => {
                    const key = `${it.branch_id}_${it.parameter_id}_${it.level}`
                    if (!versions[key]) versions[key] = []
                    versions[key].push({ mean: it.mean, sd: it.sd, validFrom: it.validFrom })
                })
                Object.keys(versions).forEach(k => versions[k].sort((a, b) => a.validFrom.localeCompare(b.validFrom)))
                setTargetVersions(versions)
                const eff: TargetMap = {}
                Object.entries(versions).forEach(([k, arr]) => {
                    let chosen = arr[0]
                    for (const v of arr) { if (v.validFrom <= dateRange.end) chosen = v; else break }
                    eff[k] = chosen
                })
                setTargetValues(eff)
            }
        }
        load()
        return () => { cancelled = true }
    }, [ready, claims])

    // Technician defaults: lock branch and parameter once data available
    useEffect(() => {
        if (!claims || !ready) return
        if (isTech) {
            if (userBranch && selectedBranch !== userBranch) setSelectedBranch(userBranch)
        } else if (!selectedBranch && branches.length) setSelectedBranch(branches[0].id)
    }, [branches, selectedBranch, isTech, userBranch, claims, ready])
    useEffect(() => {
        if (!selectedParameter && parameters.length) setSelectedParameter(parameters[0].id)
    }, [parameters, selectedParameter])
    useEffect(() => {
        if (isTech) {
            if (userBranch && entryForm.branch !== userBranch) setEntryForm(f => ({ ...f, branch: userBranch }))
        } else if (!entryForm.branch && branches.length) setEntryForm(f => ({ ...f, branch: branches[0].id }))
    }, [branches, entryForm.branch, isTech, userBranch])
    useEffect(() => { if (!entryForm.parameter && parameters.length) setEntryForm(f => ({ ...f, parameter: parameters[0].id })) }, [parameters, entryForm.parameter])
    useEffect(() => {
        if (isTech) {
            if (userBranch && targetForm.branch !== userBranch) setTargetForm((f: any) => ({ ...f, branch: userBranch }))
        } else if (!targetForm.branch && branches.length) setTargetForm((f: any) => ({ ...f, branch: branches[0].id }))
    }, [branches, targetForm.branch, isTech, userBranch])
    useEffect(() => { if (!targetForm.parameter && parameters.length) setTargetForm((f: any) => ({ ...f, parameter: parameters[0].id })) }, [parameters, targetForm.parameter])

    // Fetch QC for selected parameter
    useEffect(() => {
        let cancelled = false
        const loadQc = async () => {
            if (!ready || !claims) return
            if (!selectedBranch || !selectedParameter) return
            const branchId = isTech && userBranch ? userBranch : selectedBranch
            const r = await api.listQc({ branch_id: branchId, parameter_id: selectedParameter, start: dateRange.start, end: dateRange.end })
            if (cancelled) return
            if (r.ok && Array.isArray(r.json?.items)) setQcData(r.json.items as any)
            else setQcData([])
        }
        loadQc()
        return () => { cancelled = true }
    }, [ready, claims, selectedBranch, selectedParameter, dateRange.start, dateRange.end, isTech])

    // Fetch recent QC (branch only)
    useEffect(() => {
        let cancelled = false
        const loadRecent = async () => {
            if (!ready || !claims) return
            const branchId = isTech && userBranch ? userBranch : selectedBranch
            if (!branchId) return
            const r = await api.listQc({ branch_id: branchId, start: dateRange.start, end: dateRange.end })
            if (cancelled) return
            if (r.ok && Array.isArray(r.json?.items)) setRecentQcData(r.json.items as any)
            else setRecentQcData([])
        }
        loadRecent()
        return () => { cancelled = true }
    }, [ready, claims, selectedBranch, dateRange.start, dateRange.end, isTech])

    const effectiveTarget = (branch: string, parameter: string, level: string, onDate: string): TargetVersion | null => {
        const key = `${branch}_${parameter}_${level}`
        const versions = targetVersions[key]
        if (!versions || !versions.length) return null
        let chosen: TargetVersion | null = null
        for (const v of versions) { if (v.validFrom <= onDate) chosen = v; else break }
        return chosen || versions[0]
    }
    const calculateZ = (value: number, parameter: string, level: string, branch: string, date?: string) => {
        const t = effectiveTarget(branch, parameter, level, date || new Date().toISOString().split('T')[0])
        if (!t || !t.mean || !t.sd) return null
        return (value - t.mean) / t.sd
    }
    const evaluateRules = (data: QcEntry[]) => {
        const newAlerts: Alert[] = []
        const sorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        sorted.forEach((e, idx) => {
            const z = e.zScore
            if (z == null) return
            if (Math.abs(z) > 3) newAlerts.push({ id: `${e.id}_1_3s`, date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, rule: '1₃s', severity: 'error', description: `Single result exceeds ±3SD (Z=${z.toFixed(2)})`, acknowledged: false })
            else if (Math.abs(z) > 2) newAlerts.push({ id: `${e.id}_1_2s`, date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, rule: '1₂s', severity: 'warning', description: `Single result exceeds ±2SD (Z=${z.toFixed(2)})`, acknowledged: false })
            if (idx > 0) {
                const p = sorted[idx - 1]
                if (p.parameter === e.parameter && p.level === e.level && p.branch === e.branch && p.zScore != null) {
                    if (Math.abs(z) > 2 && Math.abs(p.zScore!) > 2 && Math.sign(z) === Math.sign(p.zScore!)) newAlerts.push({ id: `${e.id}_2_2s`, date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, rule: '2₂s', severity: 'error', description: `Two consecutive results exceed ±2SD on same side`, acknowledged: false })
                    if (Math.abs(z - p.zScore!) >= 4) newAlerts.push({ id: `${e.id}_R_4s`, date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, rule: 'R₄s', severity: 'error', description: `Range between consecutive results ≥4SD`, acknowledged: false })
                }
            }
            if (idx >= 3) {
                const r4 = sorted.slice(idx - 3, idx + 1)
                if (r4.every(r => r.parameter === e.parameter && r.level === e.level && r.branch === e.branch && r.zScore != null && Math.abs(r.zScore!) > 1 && Math.sign(r.zScore!) === Math.sign(z))) newAlerts.push({ id: `${e.id}_4_1s`, date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, rule: '4₁s', severity: 'error', description: `Four consecutive results exceed ±1SD on same side`, acknowledged: false })
            }
            if (idx >= 9) {
                const r10 = sorted.slice(idx - 9, idx + 1)
                if (r10.every(r => r.parameter === e.parameter && r.level === e.level && r.branch === e.branch && r.zScore != null && Math.sign(r.zScore!) === Math.sign(z))) newAlerts.push({ id: `${e.id}_10_x`, date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, rule: '10ₓ', severity: 'error', description: `Ten consecutive results on same side of mean`, acknowledged: false })
            }
        })
        setAlerts(newAlerts)
    }
    const processed = useMemo(() => {
        const p = qcData.map(e => ({ ...e, zScore: calculateZ(e.value, e.parameter, e.level, e.branch, e.date) }))
        evaluateRules(p)
        return p
    }, [qcData, targetValues])
    const recentProcessed = useMemo(() => recentQcData.map(e => ({ ...e, zScore: calculateZ(e.value, e.parameter, e.level, e.branch, e.date) })), [recentQcData, targetValues])
    useEffect(() => {
        const eff: TargetMap = {}
        Object.entries(targetVersions).forEach(([k, arr]) => {
            if (!arr.length) return
            let chosen = arr[0]
            for (const v of arr) { if (v.validFrom <= dateRange.end) chosen = v; else break }
            eff[k] = chosen
        })
        setTargetValues(eff)
    }, [dateRange.end, targetVersions])
    const filtered = useMemo(() => {
        const s = new Date(dateRange.start).getTime()
        const e = new Date(dateRange.end).getTime()
        return processed.filter(x => x.branch === selectedBranch && x.parameter === selectedParameter && new Date(x.date).getTime() >= s && new Date(x.date).getTime() <= e)
    }, [processed, selectedBranch, selectedParameter, dateRange])
    const observedStats = useMemo(() => {
        const stats: Record<string, { n: number; mean: string; sd: string }> = {}
            ; (['L1', 'L2', 'L3'] as const).forEach(level => {
                const data = filtered.filter(d => d.level === level)
                if (data.length) {
                    const values = data.map(d => d.value)
                    const mean = values.reduce((a, b) => a + b, 0) / values.length
                    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
                    const sd = Math.sqrt(variance)
                    stats[level] = { n: values.length, mean: mean.toFixed(2), sd: sd.toFixed(2) }
                }
            })
        return stats
    }, [filtered])
    const acknowledgeAlert = (id: string) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a))
    const chartData = useMemo(() => {
        const data: Record<'L1' | 'L2' | 'L3', any[]> = { L1: [], L2: [], L3: [] }
            ; (['L1', 'L2', 'L3'] as const).forEach(level => {
                data[level] = filtered.filter(d => d.level === level).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map(d => ({
                    date: d.date, zScore: d.zScore, value: d.value,
                    hasAlert: alerts.some(a => a.date === d.date && a.level === d.level && a.parameter === d.parameter && a.branch === d.branch)
                }))
            })
        return data
    }, [filtered, alerts])

    // Recent entries sort/filter
    const [recentSortKey, setRecentSortKey] = useState<string>('date')
    const [recentSortDir, setRecentSortDir] = useState<'asc' | 'desc'>('desc')
    const [recentFilters, setRecentFilters] = useState<Record<string, string>>({ date: '', parameter: '', level: '', value: '', zScore: '', status: '' })
    const toggleRecentSort = (key: string) => { if (recentSortKey === key) setRecentSortDir(recentSortDir === 'asc' ? 'desc' : 'asc'); else { setRecentSortKey(key); setRecentSortDir('asc') } }
    const recentRows = useMemo(() => {
        const rows = [...recentProcessed]
            .filter(r => {
                const status = alerts.some(a => a.date === r.date && a.level === r.level && a.parameter === r.parameter && a.branch === r.branch) ? 'alert' : 'ok'
                const m: Record<string, string> = { date: r.date, parameter: r.parameter, level: r.level, value: String(r.value), zScore: r.zScore == null ? '' : r.zScore.toFixed(2), status }
                return Object.entries(recentFilters).every(([k, v]) => (v || '').trim() === '' || (m[k] || '').toLowerCase().includes(v.toLowerCase().trim()))
            })
            .sort((a, b) => {
                const get = (r: any) => { if (recentSortKey === 'status') return alerts.some(x => x.date === r.date && x.level === r.level && x.parameter === r.parameter && x.branch === r.branch) ? 'alert' : 'ok'; if (recentSortKey === 'value') return r.value; if (recentSortKey === 'zScore') return r.zScore ?? -Infinity; return r[recentSortKey] }
                const va = get(a), vb = get(b)
                if (va == null && vb == null) return 0
                if (va == null) return recentSortDir === 'asc' ? -1 : 1
                if (vb == null) return recentSortDir === 'asc' ? 1 : -1
                if (typeof va === 'number' && typeof vb === 'number') return recentSortDir === 'asc' ? va - vb : vb - va
                return recentSortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
            })
        return rows.slice(0, 10)
    }, [recentProcessed, alerts, recentFilters, recentSortKey, recentSortDir])

    const renderDataEntry = () => (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Plus className="w-5 h-5" />QC Data Entry</h2>
                <form onSubmit={async (e) => { e.preventDefault(); const entries: QcEntry[] = []; (['l1', 'l2', 'l3'] as const).forEach(l => { const v = (entryForm as any)[l]; if (v) { entries.push({ id: Date.now() + Math.random(), date: entryForm.date, parameter: entryForm.parameter, branch: entryForm.branch, level: l.toUpperCase() as any, value: parseFloat(v), enteredBy: 'Current User', enteredAt: new Date().toISOString() }) } }); if (entries.length) { const res = await api.createQc(entries.map(e => ({ date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, value: e.value }))); if (res.ok) { setEntryForm({ ...entryForm, l1: '', l2: '', l3: '' }); const branchId = isTech && userBranch ? userBranch : selectedBranch; const r1 = await api.listQc({ branch_id: branchId, parameter_id: selectedParameter, start: dateRange.start, end: dateRange.end }); if (r1.ok && Array.isArray(r1.json?.items)) setQcData(r1.json.items as any); const r2 = await api.listQc({ branch_id: branchId, start: dateRange.start, end: dateRange.end }); if (r2.ok && Array.isArray(r2.json?.items)) setRecentQcData(r2.json.items as any) } } }} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={entryForm.date} onChange={e => setEntryForm({ ...entryForm, date: e.target.value })} className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" required /></div>
                        <div><label className="block text-sm font-medium mb-1">Branch</label><select value={entryForm.branch} onChange={e => setEntryForm({ ...entryForm, branch: e.target.value })} className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" disabled={isTech}>{(isTech ? branches.filter(b => b.id === claims?.branch) : branches).map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}</select></div>
                        <div><label className="block text-sm font-medium mb-1">Parameter</label><select value={entryForm.parameter} onChange={e => setEntryForm({ ...entryForm, parameter: e.target.value })} className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500">{parameters.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{(['l1', 'l2', 'l3'] as const).map((l, idx) => (<div key={l}><label className="block text-sm font-medium mb-1">L{idx + 1} Value</label><input type="number" step="0.01" value={(entryForm as any)[l]} onChange={(e) => setEntryForm({ ...entryForm, [l]: e.target.value })} className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" placeholder={`Enter L${idx + 1} value`} /></div>))}</div>
                    <div className="flex gap-2"><button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2"><Save className="w-4 h-4" />Save Entry</button></div>
                </form>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-2">Recent Entries</h3>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 text-xs">
                    <input placeholder="Filter Date" value={recentFilters.date} onChange={e => setRecentFilters(f => ({ ...f, date: e.target.value }))} className="border rounded px-2 py-1" />
                    <input placeholder="Filter Parameter" value={recentFilters.parameter} onChange={e => setRecentFilters(f => ({ ...f, parameter: e.target.value }))} className="border rounded px-2 py-1" />
                    <input placeholder="Filter Level" value={recentFilters.level} onChange={e => setRecentFilters(f => ({ ...f, level: e.target.value }))} className="border rounded px-2 py-1" />
                    <input placeholder="Filter Value" value={recentFilters.value} onChange={e => setRecentFilters(f => ({ ...f, value: e.target.value }))} className="border rounded px-2 py-1" />
                    <input placeholder="Filter Z-Score" value={recentFilters.zScore} onChange={e => setRecentFilters(f => ({ ...f, zScore: e.target.value }))} className="border rounded px-2 py-1" />
                    <input placeholder="Filter Status" value={recentFilters.status} onChange={e => setRecentFilters(f => ({ ...f, status: e.target.value }))} className="border rounded px-2 py-1" />
                </div>
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('date')}>Date</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('parameter')}>Parameter</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('level')}>Level</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('value')}>Value</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('zScore')}>Z-Score</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('status')}>Status</th></tr></thead><tbody>{recentRows.map(e => (<tr key={e.id} className="border-b"><td className="py-2">{e.date}</td><td className="py-2">{e.parameter}</td><td className="py-2">{e.level}</td><td className="py-2">{e.value.toFixed(2)}</td><td className="py-2">{e.zScore == null ? '—' : e.zScore.toFixed(2)}</td><td className="py-2">{alerts.some(a => a.date === e.date && a.level === e.level && a.parameter === e.parameter && a.branch === e.branch) ? (<span className="text-red-600">Alert</span>) : (<span className="text-green-600">OK</span>)}</td></tr>))}</tbody></table></div>
            </div>
        </div>
    )

    const renderCharts = () => (<Charts selectedBranch={selectedBranch} selectedParameter={selectedParameter} branches={branches} parameters={parameters} chartData={chartData as any} targetValues={targetValues} observedStats={observedStats as any} setSelectedBranch={setSelectedBranch} setSelectedParameter={setSelectedParameter} />)

    // Alerts table sort/filter
    const [alertSortKey, setAlertSortKey] = useState<string>('date')
    const [alertSortDir, setAlertSortDir] = useState<'asc' | 'desc'>('desc')
    const [alertFilters, setAlertFilters] = useState<Record<string, string>>({ date: '', branch: '', parameter: '', level: '', rule: '', description: '', severity: '', acknowledged: '' })
    const toggleAlertSort = (key: string) => { if (alertSortKey === key) setAlertSortDir(alertSortDir === 'asc' ? 'desc' : 'asc'); else { setAlertSortKey(key); setAlertSortDir('asc') } }
    const alertRows = useMemo(() => {
        const rows = alerts.filter(a => { const m: Record<string, string> = { date: a.date, branch: a.branch, parameter: a.parameter, level: a.level, rule: a.rule, description: a.description, severity: a.severity, acknowledged: a.acknowledged ? 'yes' : 'no' }; return Object.entries(alertFilters).every(([k, v]) => (v || '').trim() === '' || (m[k] || '').toLowerCase().includes(v.toLowerCase().trim())) }).sort((a: any, b: any) => { const get = (r: any) => (r as any)[alertSortKey]; const va = get(a), vb = get(b); if (typeof va === 'number' && typeof vb === 'number') return alertSortDir === 'asc' ? va - vb : vb - va; return alertSortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va)) })
        return rows
    }, [alerts, alertFilters, alertSortKey, alertSortDir])
    const renderAlerts = () => (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><AlertTriangle className="w-5 h-5" />Westgard Rule Alerts</h2>
                <div className="mb-4"><div className="grid grid-cols-4 gap-4 text-sm"><div className="bg-red-50 p-3 rounded"><div className="font-medium text-red-800">Critical Alerts</div><div className="text-2xl font-bold text-red-600">{alerts.filter(a => a.severity === 'error' && !a.acknowledged).length}</div></div><div className="bg-yellow-50 p-3 rounded"><div className="font-medium text-yellow-800">Warnings</div><div className="text-2xl font-bold text-yellow-600">{alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length}</div></div><div className="bg-green-50 p-3 rounded"><div className="font-medium text-green-800">Acknowledged</div><div className="text-2xl font-bold text-green-600">{alerts.filter(a => a.acknowledged).length}</div></div><div className="bg-blue-50 p-3 rounded"><div className="font-medium text-blue-800">Total Alerts</div><div className="text-2xl font-bold text-blue-600">{alerts.length}</div></div></div></div>
                <div className="grid grid-cols-2 md:grid-cols-8 gap-2 mb-3 text-xs"><input placeholder="Filter Date" value={alertFilters.date} onChange={e => setAlertFilters(f => ({ ...f, date: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Branch" value={alertFilters.branch} onChange={e => setAlertFilters(f => ({ ...f, branch: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Parameter" value={alertFilters.parameter} onChange={e => setAlertFilters(f => ({ ...f, parameter: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Level" value={alertFilters.level} onChange={e => setAlertFilters(f => ({ ...f, level: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Rule" value={alertFilters.rule} onChange={e => setAlertFilters(f => ({ ...f, rule: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Description" value={alertFilters.description} onChange={e => setAlertFilters(f => ({ ...f, description: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Severity" value={alertFilters.severity} onChange={e => setAlertFilters(f => ({ ...f, severity: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Ack (yes/no)" value={alertFilters.acknowledged} onChange={e => setAlertFilters(f => ({ ...f, acknowledged: e.target.value }))} className="border rounded px-2 py-1" /></div>
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('date')}>Date</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('branch')}>Branch</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('parameter')}>Parameter</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('level')}>Level</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('rule')}>Rule</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('description')}>Description</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('severity')}>Severity</th><th className="text-left py-2">Action</th></tr></thead><tbody>{alertRows.map(a => (<tr key={a.id} className={`border-b ${a.acknowledged ? 'opacity-50' : ''}`}><td className="py-2">{a.date}</td><td className="py-2">{a.branch}</td><td className="py-2">{a.parameter}</td><td className="py-2">{a.level}</td><td className="py-2"><span className={`px-2 py-1 rounded text-xs font-medium ${a.rule === '1₂s' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{a.rule}</span></td><td className="py-2">{a.description}</td><td className="py-2">{a.severity}</td><td className="py-2"><button className="text-blue-600 hover:underline disabled:text-gray-400" disabled={a.acknowledged} onClick={() => acknowledgeAlert(a.id)}>Acknowledge</button></td></tr>))}</tbody></table></div>
            </div>
            <div className="bg-white rounded-lg shadow p-6"><h3 className="text-lg font-semibold mb-4">Westgard Rules Reference</h3><div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm"><div className="space-y-2"><div className="flex items-center gap-2"><span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-medium">1₂s</span><span>Warning: Single result exceeds ±2SD</span></div><div className="flex items-center gap-2"><span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">1₃s</span><span>Error: Single result exceeds ±3SD</span></div><div className="flex items-center gap-2"><span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">2₂s</span><span>Error: 2 consecutive results exceed ±2SD (same side)</span></div></div><div className="space-y-2"><div className="flex items-center gap-2"><span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">R₄s</span><span>Error: Range between consecutive results ≥4SD</span></div><div className="flex items-center gap-2"><span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">4₁s</span><span>Error: 4 consecutive results exceed ±1SD (same side)</span></div><div className="flex items-center gap-2"><span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">10ₓ</span><span>Error: 10 consecutive results on same side of mean</span></div></div></div></div>
        </div>
    )

    // Targets table
    const [targetSortKey, setTargetSortKey] = useState<string>('branch')
    const [targetSortDir, setTargetSortDir] = useState<'asc' | 'desc'>('asc')
    const [targetFilters, setTargetFilters] = useState<Record<string, string>>({ branch: '', parameter: '', level: '', mean: '', sd: '', validFrom: '' })
    const toggleTargetSort = (key: string) => { if (targetSortKey === key) setTargetSortDir(targetSortDir === 'asc' ? 'desc' : 'asc'); else { setTargetSortKey(key); setTargetSortDir('asc') } }
    const targetRows = useMemo(() => {
        const rows = Object.entries(targetVersions).map(([key, versions]) => {
            const [branchId, parameterId, level] = key.split('_')
            const branch = branches.find(b => b.id === branchId)
            const parameter = parameters.find(p => p.id === parameterId)
            const latest = versions[versions.length - 1]
            return { key, branchName: branch?.name || branchId, branchId, parameterName: parameter?.name || parameterId, parameterId, level, mean: latest.mean, sd: latest.sd, validFrom: latest.validFrom, latest }
        }).filter(r => {
            const m: Record<string, string> = { branch: r.branchName, parameter: r.parameterName, level: r.level, mean: String(r.mean), sd: String(r.sd), validFrom: r.validFrom }
            return Object.entries(targetFilters).every(([k, v]) => (v || '').trim() === '' || (m[k] || '').toLowerCase().includes(v.toLowerCase().trim()))
        }).sort((a, b) => {
            const get = (r: any) => { if (targetSortKey === 'branch') return r.branchName; if (targetSortKey === 'parameter') return r.parameterName; return r[targetSortKey] }
            const va = get(a), vb = get(b)
            if (typeof va === 'number' && typeof vb === 'number') return targetSortDir === 'asc' ? va - vb : vb - va
            return targetSortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
        })
        return rows
    }, [targetVersions, branches, parameters, targetFilters, targetSortKey, targetSortDir])
    const renderTargets = () => (
        <div className="space-y-6"><div className="bg-white rounded-lg shadow p-6"><div className="flex justify-between items-center mb-4"><h2 className="text-xl font-semibold flex items-center gap-2"><Settings className="w-5 h-5" />Target Mean & SD Management</h2><button onClick={() => { setShowTargetModal(true); setEditingTarget(null) }} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2"><Plus className="w-4 h-4" />Add Target</button></div><div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 text-xs"><input placeholder="Filter Branch" value={targetFilters.branch} onChange={e => setTargetFilters(f => ({ ...f, branch: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Parameter" value={targetFilters.parameter} onChange={e => setTargetFilters(f => ({ ...f, parameter: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Level" value={targetFilters.level} onChange={e => setTargetFilters(f => ({ ...f, level: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Mean" value={targetFilters.mean} onChange={e => setTargetFilters(f => ({ ...f, mean: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter SD" value={targetFilters.sd} onChange={e => setTargetFilters(f => ({ ...f, sd: e.target.value }))} className="border rounded px-2 py-1" /><input placeholder="Filter Valid From" value={targetFilters.validFrom} onChange={e => setTargetFilters(f => ({ ...f, validFrom: e.target.value }))} className="border rounded px-2 py-1" /></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('branch')}>Branch</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('parameter')}>Parameter</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('level')}>Level</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('mean')}>Mean</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('sd')}>SD</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('validFrom')}>Valid From</th><th className="text-left py-2">Actions</th></tr></thead><tbody>{targetRows.map(r => (<tr key={r.key} className="border-b"><td className="py-2">{r.branchName}</td><td className="py-2">{r.parameterName}</td><td className="py-2">{r.level}</td><td className="py-2">{r.mean}</td><td className="py-2">{r.sd}</td><td className="py-2">{r.validFrom}</td><td className="py-2"><button className="text-blue-600 hover:underline" onClick={() => { setEditingTarget(r.key); setShowTargetModal(true); setTargetForm({ parameter: r.parameterId, level: r.level, branch: r.branchId, mean: String(r.mean), sd: String(r.sd), validFrom: r.validFrom }) }}>Edit</button></td></tr>))}</tbody></table></div></div></div>
    )

    const renderReports = () => (
        <div className="space-y-6"><div className="bg-white rounded-lg shadow p-6"><h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><FileText className="w-5 h-5" />Monthly Reports</h2><div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"><div><label className="block text-sm font-medium mb-1">Branch</label><select className="w-full p-2 border rounded">{branches.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}</select></div><div><label className="block text-sm font-medium mb-1">Month</label><input type="month" defaultValue={new Date().toISOString().slice(0, 7)} className="w-full p-2 border rounded" /></div><div className="flex items-end"><button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2"><Download className="w-4 h-4" />Generate Report</button></div></div><div className="bg-gray-50 p-4 rounded"><h3 className="font-medium mb-2">Report will include:</h3><ul className="text-sm text-gray-600 space-y-1"><li>• Levey-Jennings charts for all parameters and levels</li><li>• Complete list of Westgard rule violations</li><li>• Summary statistics (observed vs target mean/SD)</li><li>• Control performance metrics</li><li>• Audit trail of target value changes</li></ul></div></div><div className="bg-white rounded-lg shadow p-6"><h3 className="text-lg font-semibold mb-4">Export Data</h3><div className="flex gap-2"><button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 flex items-center gap-2"><Download className="w-4 h-4" />Export as Excel</button><button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2"><Download className="w-4 h-4" />Export as CSV</button></div></div></div>
    )

    const handleTargetSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const body = { branch_id: targetForm.branch, parameter_id: targetForm.parameter, level: targetForm.level, mean: parseFloat(targetForm.mean), sd: parseFloat(targetForm.sd), validFrom: targetForm.validFrom }
        const res = await api.upsertTarget(body)
        if (res.ok) {
            const key = `${targetForm.branch}_${targetForm.parameter}_${targetForm.level}`
            setTargetVersions(prev => {
                const arr = [...(prev[key] || [])]
                arr.push({ mean: body.mean, sd: body.sd, validFrom: body.validFrom })
                arr.sort((a, b) => a.validFrom.localeCompare(b.validFrom))
                const next = { ...prev, [key]: arr }
                const eff: TargetMap = {}
                Object.entries(next).forEach(([k, a]) => {
                    let chosen = a[0]
                    for (const v of a) { if (v.validFrom <= dateRange.end) chosen = v; else break }
                    eff[k] = chosen
                })
                setTargetValues(eff)
                return next
            })
            setShowTargetModal(false)
            setEditingTarget(null)
        }
    }

    const can = { dataEntry: role === 'admin' || role === 'tech', charts: role === 'admin' || role === 'viewer', alerts: role === 'admin' || role === 'viewer', targets: role === 'admin', reports: role === 'admin' }
    const firstAllowedTab: typeof currentTab = (['dataEntry', 'charts', 'alerts', 'targets', 'reports'] as const).find(t => (can as any)[t]) as any || 'charts'
    useEffect(() => { if (!(can as any)[currentTab]) setCurrentTab(firstAllowedTab) }, [role])
    if (!branches.length || !parameters.length) return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading data…</div>
    return (<div className="min-h-screen bg-gray-50"><div className="bg-white shadow-sm border-b"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div className="flex justify-between items-center h-16"><div className="flex items-center gap-3"><div className="bg-blue-600 text-white p-2 rounded"><BarChart3 className="w-6 h-6" /></div><h1 className="text-xl font-semibold text-gray-900">Medical Lab QA Dashboard</h1></div><div className="flex items-center gap-4"><div className="flex items-center gap-2 text-sm text-gray-600"><Calendar className="w-4 h-4" /><input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="border rounded px-2 py-1" /><span>to</span><input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="border rounded px-2 py-1" /></div>{claims && <div className="text-sm text-gray-700">{claims.sub} · {claims.role || 'role'} · {claims.branch || 'branch'}</div>}<button onClick={() => { logout(); if (typeof window !== 'undefined') window.location.replace('/login') }} className="text-sm text-red-600 hover:text-red-700">Logout</button></div></div></div></div><div className="bg-white border-b"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><nav className="flex space-x-8">{[{ id: 'dataEntry', name: 'Data Entry', icon: Plus, show: can.dataEntry }, { id: 'charts', name: 'Charts & Analysis', icon: BarChart3, show: can.charts }, { id: 'alerts', name: 'Alerts', icon: AlertTriangle, show: can.alerts }, { id: 'targets', name: 'Target Management', icon: Settings, show: can.targets }, { id: 'reports', name: 'Reports', icon: FileText, show: can.reports }].filter(t => t.show).map((tab: any) => (<button key={tab.id} onClick={() => setCurrentTab(tab.id)} className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm ${currentTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}><tab.icon className="w-4 h-4" />{tab.name}{tab.id === 'alerts' && alerts.filter(a => !a.acknowledged).length > 0 && (<span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[1.5rem] text-center">{alerts.filter(a => !a.acknowledged).length}</span>)}</button>))}</nav></div></div><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{currentTab === 'dataEntry' && can.dataEntry && renderDataEntry()}{currentTab === 'charts' && can.charts && renderCharts()}{currentTab === 'alerts' && can.alerts && renderAlerts()}{currentTab === 'targets' && can.targets && renderTargets()}{currentTab === 'reports' && can.reports && renderReports()}</div>{showTargetModal && (<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 w-full max-w-md"><div className="flex justify-between items-center mb-4"><h3 className="text-lg font-semibold">{editingTarget ? 'Edit Target Values' : 'Add Target Values'}</h3><button onClick={() => { setShowTargetModal(false); setEditingTarget(null) }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button></div><form onSubmit={handleTargetSubmit} className="space-y-4"><div><label className="block text-sm font-medium mb-1">Branch</label><select value={targetForm.branch} onChange={(e) => setTargetForm({ ...targetForm, branch: e.target.value })} className="w-full p-2 border rounded" required>{branches.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}</select></div><div><label className="block text-sm font-medium mb-1">Parameter</label><select value={targetForm.parameter} onChange={(e) => setTargetForm({ ...targetForm, parameter: e.target.value })} className="w-full p-2 border rounded" required>{parameters.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div><div><label className="block text-sm font-medium mb-1">Level</label><select value={targetForm.level} onChange={(e) => setTargetForm({ ...targetForm, level: e.target.value })} className="w-full p-2 border rounded" required><option value="L1">L1</option><option value="L2">L2</option><option value="L3">L3</option></select></div><div><label className="block text-sm font-medium mb-1">Target Mean</label><input type="number" step="0.01" value={targetForm.mean} onChange={(e) => setTargetForm({ ...targetForm, mean: e.target.value })} className="w-full p-2 border rounded" required /></div><div><label className="block text-sm font-medium mb-1">Target SD</label><input type="number" step="0.01" value={targetForm.sd} onChange={(e) => setTargetForm({ ...targetForm, sd: e.target.value })} className="w-full p-2 border rounded" required /></div><div><label className="block text-sm font-medium mb-1">Valid From</label><input type="date" value={targetForm.validFrom} onChange={(e) => setTargetForm({ ...targetForm, validFrom: e.target.value })} className="w-full p-2 border rounded" required /></div><div className="flex gap-2"><button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700">{editingTarget ? 'Update' : 'Add'} Target</button><button type="button" onClick={() => { setShowTargetModal(false); setEditingTarget(null) }} className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400">Cancel</button></div></form></div></div>)} </div>)
}

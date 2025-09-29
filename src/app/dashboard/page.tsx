"use client"
// Migrated full dashboard implementation from former frontend directory.
// (Enhancement) Technician defaults: auto lock branch & ensure first parameter selected after data loads.
import { useEffect, useMemo, useState, useRef } from 'react'
import { BarChart3, AlertTriangle, Settings, FileText, Plus, Save, X, Calendar, Download } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, ReferenceLine, Tooltip } from 'recharts'
import { startGoogleOAuth, initOAuthMessageListener, ensureGoogleAccessToken, loadTokens } from '../../lib/googleAuth'
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

    const [entryForm, setEntryForm] = useState({ date: new Date().toISOString().split('T')[0], parameter: '', branch: '', l1: '', l2: '', l3: '' })
    const [targetForm, setTargetForm] = useState({ parameter: '', level: 'L1', branch: '', mean: '', sd: '', validFrom: new Date().toISOString().split('T')[0] }) as any
    const [showTargetModal, setShowTargetModal] = useState(false)
    const [editingTarget, setEditingTarget] = useState<string | null>(null)
    const [labDetails] = useState({
        name: 'Central Clinical Laboratory',
        address: '123 Diagnostics Ave, City, Country',
        contact: '+1 (555) 010-4455',
        accreditation: 'ISO 15189',
        instrument: 'AU5800 Chemistry Analyzer'
    })
    const [narrativeText, setNarrativeText] = useState<string>('') // Description (was internal QC narrative)
    const [preparedBy, setPreparedBy] = useState<string>('')
    const [reviewedBy, setReviewedBy] = useState<string>('')

    // Display helpers (avoid showing raw UUIDs)
    const branchName = (id: string | undefined | null) => {
        if (!id) return ''
        const b = branches.find(x => x.id === id)
        return b?.name || id
    }
    // Some identity providers expose email; fall back to sub
    const userDisplay = (claims && (claims as any).email) ? (claims as any).email : (claims?.sub || 'User')

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

    // Technician defaults & parameter selection
    useEffect(() => {
        if (!claims || !ready) return
        if (isTech) {
            if (userBranch && selectedBranch !== userBranch) setSelectedBranch(userBranch)
        } else if (!selectedBranch && branches.length) setSelectedBranch(branches[0].id)
    }, [branches, selectedBranch, isTech, userBranch, claims, ready])
    useEffect(() => { if (!selectedParameter && parameters.length) setSelectedParameter(parameters[0].id) }, [parameters, selectedParameter])
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
                if (r10.every(r => r.parameter === e.parameter && r.level === e.level && r.branch === e.branch && r.zScore != null && Math.sign(r.zScore!) === Math.sign(z))) newAlerts.push({ id: `${e.id}_10_x`, date: e.date, parameter: e.parameter, branch: e.branch, level: e.level, rule: '10₁x', severity: 'error', description: `Ten consecutive results on same side of mean`, acknowledged: false })
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
                // Fixed: was referencing undefined variable 'e'; should use current row 'r'
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
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('date')}>Date</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('branch')}>Branch</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('parameter')}>Parameter</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('level')}>Level</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('rule')}>Rule</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('description')}>Description</th><th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('severity')}>Severity</th><th className="text-left py-2">Action</th></tr></thead><tbody>{alertRows.map(a => (<tr key={a.id} className={`border-b ${a.acknowledged ? 'opacity-50' : ''}`}><td className="py-2">{a.date}</td><td className="py-2">{branchName(a.branch)}</td><td className="py-2">{a.parameter}</td><td className="py-2">{a.level}</td><td className="py-2"><span className={`px-2 py-1 rounded text-xs font-medium ${a.rule === '1₂s' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{a.rule}</span></td><td className="py-2">{a.description}</td><td className="py-2">{a.severity}</td><td className="py-2"><button className="text-blue-600 hover:underline disabled:text-gray-400" disabled={a.acknowledged} onClick={() => acknowledgeAlert(a.id)}>Acknowledge</button></td></tr>))}</tbody></table></div>
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

    // Report functions
    const exportReportCSV = () => {
        const meta = [
            `Lab Name:,"${labDetails.name}"`,
            `Branch:,"${branchName(selectedBranch).replace(/"/g, '""')}"`,
            `Parameters:,${allParameterIdsForBranch.length}`,
            `Parameter List:,"${allParameterIdsForBranch.map(pid => parameters.find(p => p.id === pid)?.name || pid).join('; ')}"`,
            `Period:,${dateRange.start} to ${dateRange.end}`,
            `Generated:,${new Date().toISOString()}`,
            `Narrative:,"${(narrativeText || '').replace(/"/g, '""')}"`,
            ''
        ]
        const headers = ['Parameter', 'Level', 'n', 'Mean', 'SD', 'CV%', '1₂s', '1₃s', '2₂s', 'R₄s', '4₁s', '10ₓ']
        const lines = [...meta, headers.join(',')]
        allReportStats.forEach(r => {
            const paramName = parameters.find(p => p.id === r.parameter)?.name || r.parameter
            const line = [paramName, r.level, r.n, r.mean.toFixed(3), r.sd.toFixed(3), r.cv?.toFixed(1) || '', r.rules['1₂s'], r.rules['1₃s'], r.rules['2₂s'], r.rules['R₄s'], r.rules['4₁s'], r.rules['10ₓ']]
            lines.push(line.join(','))
        })
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const safeBranchSlug = branchName(selectedBranch).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'branch'
        a.download = `qc_report_${safeBranchSlug}_${dateRange.start}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const reportRootRef = useRef<HTMLDivElement | null>(null)
    const narrativeRef = useRef<HTMLDivElement | null>(null)
    const statsRef = useRef<HTMLDivElement | null>(null)
    const chartsRef = useRef<HTMLDivElement | null>(null)
    const frontMatterRef = useRef<HTMLDivElement | null>(null)
    const [exporting, setExporting] = useState(false)
    const [gdocExporting, setGdocExporting] = useState(false)
    const [googleReady, setGoogleReady] = useState<boolean>(() => !!loadTokens())

    // Initialize OAuth postMessage listener once
    useEffect(() => {
        const dispose = initOAuthMessageListener(() => {
            setGoogleReady(true)
        })
        return () => { if (dispose) dispose() }
    }, [])

    // Backend export (pdf/docx/html) via /api/report/export
    const backendExport = async (format: 'pdf' | 'docx' | 'html') => {
        if (exporting) return
        setExporting(true)
        try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE || ''
            if (!apiBase) {
                console.warn('NEXT_PUBLIC_API_BASE not set; falling back to relative /api which may still be Next.js route')
            }
            // Ensure charts are rendered: wait a short tick & retry SVG capture if initially missing
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
            const maxChartWaitMs = 500
            const startTs = performance.now()
            let chartContainers = Array.from(document.querySelectorAll('[data-report-lj-parameter]'))
            if (!chartContainers.length) {
                // allow layout/render flush
                await wait(50)
                chartContainers = Array.from(document.querySelectorAll('[data-report-lj-parameter]'))
            }

            // Try a few rapid retries if first SVGs not found
            const ensureChartsReady = async () => {
                for (let attempt = 0; attempt < 5; attempt++) {
                    const missing = allParameterIdsForBranch.filter(pid => !document.querySelector(`[data-report-lj-parameter="${pid}"] svg`))
                    if (!missing.length) return true
                    await wait(60)
                }
                return false
            }
            const chartsReady = await ensureChartsReady()
            if (!chartsReady) {
                console.warn('Some charts not ready for export; proceeding anyway')
            }
            // Gather parameter stats across all parameters for selected branch (all levels separate)
            const payloadParameters = allParameterIdsForBranch.map(pid => {
                const name = parameters.find(p => p.id === pid)?.name || pid
                // Capture the combined SVG once per parameter (single multi-level chart)
                const containerSvgEl = document.querySelector(`[data-report-lj-parameter="${pid}"] svg`)
                const containerSvg = containerSvgEl ? (containerSvgEl as SVGElement).outerHTML : undefined
                if (!containerSvg) {
                    console.debug('No SVG found for parameter during export', { pid })
                }
                const levelStats = (['L1', 'L2', 'L3'] as const).map(level => {
                    const rows = recentProcessed.filter(q => q.branch === selectedBranch && q.parameter === pid && q.level === level && q.date >= dateRange.start && q.date <= dateRange.end)
                    if (!rows.length) return null
                    const values = rows.map(r => r.value)
                    const mean = values.reduce((a, b) => a + b, 0) / values.length
                    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
                    const sd = Math.sqrt(variance)
                    const cv = sd && mean ? (sd / mean) * 100 : 0
                    return { level, stats: { mean, sd, cv, n: values.length } }
                }).filter(Boolean) as any[]
                // Attach svg only to the first level entry to avoid duplicates in report charts section
                return levelStats.map((ls, idx) => ({ id: pid + '_' + ls.level, name: name + ' ' + ls.level, unit: '', level: ls.level, stats: ls.stats, svg: idx === 0 ? containerSvg : undefined }))
            }).flat()
            const body = {
                branchName: branchName(selectedBranch),
                period: { from: dateRange.start, to: dateRange.end },
                narrative: narrativeText,
                parameters: payloadParameters,
                format
            }
            const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
            const targetUrl = `${apiBase || ''}/api/report/export`.replace(/([^:])\/\//g, '$1/')
            const res = await fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
            if (!res.ok) {
                let msg = 'Export failed'
                try { const j = await res.json(); msg = j.error || msg } catch { }
                throw new Error(msg)
            }
            const fallback = res.headers.get('X-Export-Fallback')
            if (format === 'html' || (fallback && fallback.startsWith('pdf-') && format === 'pdf') || (fallback && fallback.startsWith('docx-') && format === 'docx')) {
                // Server provided HTML instead of requested binary (fallback scenario)
                const text = await res.text()
                const w = window.open('', '_blank')
                if (w) { w.document.write(text); w.document.close() }
                if (fallback) {
                    setTimeout(() => alert(`Server fallback (${fallback}). Displaying HTML instead.`), 250)
                }
            } else {
                const blob = await res.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                const safeBranchSlug = branchName(selectedBranch).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'branch'
                a.download = `qc_report_${safeBranchSlug}_${dateRange.start}.${format}`
                a.href = url
                a.click()
                URL.revokeObjectURL(url)
            }
        } catch (e: any) {
            alert(e.message || 'Export failed')
        } finally { setExporting(false) }
    }

    // Google Doc export (stateless; charts images to be added later)
    const exportGoogleDoc = async () => {
        if (gdocExporting) return
        const preWindow = typeof window !== 'undefined' ? window.open('', '_blank') : null
        if (preWindow) {
            preWindow.document.write('<!DOCTYPE html><title>Generating Google Doc…</title><body style="font-family:system-ui;padding:1rem;font-size:14px;">Generating Google Doc report…</body>')
        }
        setGdocExporting(true)
        try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE || ''
            let accessToken = await ensureGoogleAccessToken(apiBase)
            if (!accessToken) {
                await startGoogleOAuth(apiBase)
                const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
                for (let i = 0; i < 60; i++) { await wait(500); accessToken = await ensureGoogleAccessToken(apiBase); if (accessToken) break }
            }
            if (!accessToken) throw new Error('Authorization required – Google OAuth not completed')
            const rasterizeCharts = async () => {
                type Capture = { parameterId: string; name: string; pngBase64: string }
                const captures: Capture[] = []
                const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
                // Inject fallback palette to neutralize oklch() (which html2canvas cannot parse)
                let paletteStyle = document.querySelector('style[data-gdoc-color-fallback]') as HTMLStyleElement | null
                if (!paletteStyle) {
                    paletteStyle = document.createElement('style')
                    paletteStyle.setAttribute('data-gdoc-color-fallback', 'true')
                    paletteStyle.textContent = `
                      .bg-white { background-color:#ffffff !important; }
                      .bg-gray-50 { background-color:#f8fafc !important; }
                      .bg-gray-100 { background-color:#f1f5f9 !important; }
                      .bg-gray-200 { background-color:#e2e8f0 !important; }
                      .bg-blue-600 { background-color:#2563eb !important; }
                      .text-blue-600 { color:#2563eb !important; }
                      .text-gray-500 { color:#6b7280 !important; }
                      .text-gray-600 { color:#4b5563 !important; }
                      .text-gray-700 { color:#374151 !important; }
                      .text-gray-900 { color:#111827 !important; }
                      .border { border-color:#e5e7eb !important; }
                      [data-combined-chart] * { background-image:none !important; }
                    `
                    document.head.appendChild(paletteStyle)
                }
                // Poll for combined charts to exist
                let cards: NodeListOf<HTMLElement> | HTMLElement[] = [] as any
                for (let attempt = 0; attempt < 15; attempt++) {
                    cards = document.querySelectorAll('[data-combined-chart]') as NodeListOf<HTMLElement>
                    if (cards.length || attempt === 14) break
                    await wait(100)
                }
                if (!cards.length) {
                    console.warn('[GDoc Export] No combined chart nodes found after polling')
                }
                // (wait already defined above)
                // Wait for layout + React commit + Recharts render
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
                for (let i = 0; i < 5; i++) { // progressive settle
                    await wait(80)
                }
                // Dynamically import html2canvas once
                // @ts-ignore
                const mod = await import('html2canvas').catch(() => null)
                const html2canvas = mod?.default
                const origAnim = document.documentElement.style.animation
                const origTrans = document.documentElement.style.transition
                document.documentElement.style.animation = 'none'
                document.documentElement.style.transition = 'none'
                const paramName = (pid: string) => parameters.find(p => p.id === pid)?.name || pid
                try {
                    for (const card of Array.from(cards)) {
                        const pid = card.getAttribute('data-combined-chart') || ''
                        if (!pid) continue
                        const container = card
                        let base64: string | undefined
                        // Attempt html2canvas with limited retries if zero-sized
                        if (html2canvas) {
                            for (let attempt = 0; attempt < 2; attempt++) {
                                try {
                                    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
                                        await wait(60)
                                        continue
                                    }
                                    const canvas = await html2canvas(container, { backgroundColor: '#ffffff', scale: 2, useCORS: true })
                                    const dataUrl = canvas.toDataURL('image/png')
                                    if (dataUrl.startsWith('data:image/png;base64,')) {
                                        base64 = dataUrl.substring('data:image/png;base64,'.length)
                                    }
                                    if (base64) break
                                } catch (err) {
                                    if (attempt === 1) console.warn('[GDoc Export] html2canvas failed', pid, err)
                                    await wait(50)
                                }
                            }
                        }
                        if (!base64) {
                            console.warn('[GDoc Export] capture failed for combined chart', pid)
                            continue
                        }
                        captures.push({ parameterId: pid, name: `${paramName(pid)}`, pngBase64: base64 })
                    }
                } finally {
                    document.documentElement.style.animation = origAnim
                    document.documentElement.style.transition = origTrans
                }
                // Fallback: capture entire charts section if we got zero individual charts
                if (!captures.length) {
                    const chartsSection = document.querySelector('[data-report-section="charts"]') as HTMLElement | null
                    if (chartsSection && html2canvas) {
                        try {
                            const canvas = await html2canvas(chartsSection, { backgroundColor: '#ffffff', scale: 2, useCORS: true })
                            const dataUrl = canvas.toDataURL('image/png')
                            if (dataUrl.startsWith('data:image/png;base64,')) {
                                const base64 = dataUrl.substring('data:image/png;base64,'.length)
                                captures.push({ parameterId: 'all', name: 'All Parameters Combined', pngBase64: base64 })
                                console.warn('[GDoc Export] Used section-level fallback capture')
                            }
                        } catch (err) {
                            console.error('[GDoc Export] Fallback section capture failed', err)
                        }
                    }
                }
                console.log('[GDoc Export] Capture summary', { requested: (cards as any).length, succeeded: captures.length })
                // Remove palette override after capture to avoid side effects
                if (paletteStyle) {
                    try { document.head.removeChild(paletteStyle) } catch { }
                }
                return captures
            }
            const chartImages = await rasterizeCharts()
            // Build parameter stats payload (no svg)
            const payloadParameters = allParameterIdsForBranch.map(pid => {
                const pname = parameters.find(p => p.id === pid)?.name || pid
                return (['L1', 'L2', 'L3'] as const).map(level => {
                    const rows = recentProcessed.filter(q => q.branch === selectedBranch && q.parameter === pid && q.level === level && q.date >= dateRange.start && q.date <= dateRange.end)
                    if (!rows.length) return null
                    const values = rows.map(r => r.value)
                    const mean = values.reduce((a, b) => a + b, 0) / values.length
                    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
                    const sd = Math.sqrt(variance)
                    const cv = sd && mean ? (sd / mean) * 100 : 0
                    return { name: `${pname} ${level}`, level, stats: { mean, sd, cv, n: values.length } }
                }).filter(Boolean)
            }).flat().filter(Boolean)
            const body = { branchName: branchName(selectedBranch), period: { from: dateRange.start, to: dateRange.end }, narrative: narrativeText, parameters: payloadParameters, chartImages, format: 'gdoc' }
            const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
            const targetUrl = `${apiBase || ''}/api/report/export`.replace(/([^:])\/\//g, '$1/')
            const res = await fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}), 'X-Google-Access-Token': accessToken }, body: JSON.stringify(body) })
            if (!res.ok) { let msg = 'Google Doc export failed'; try { const j = await res.json(); msg = j.detail || j.error || msg } catch { } throw new Error(msg) }
            const j = await res.json()
            if (j.url) { if (preWindow) { try { preWindow.location.replace(j.url) } catch { window.open(j.url, '_blank') } } else { window.open(j.url, '_blank') } }
            else { if (preWindow) preWindow.close(); alert('Export succeeded but no document URL returned') }
        } catch (e: any) {
            if (preWindow) preWindow.close()
            alert(e.message || 'Google Doc export failed')
        } finally { setGdocExporting(false) }
    }

    const exportReportPDF = async () => {
        if (exporting) return
        setExporting(true)
        try {
            if (!reportRootRef.current) throw new Error('Report root not ready')
            const { jsPDF } = await import('jspdf')
            const html2canvas = (await import('html2canvas')).default
            const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
            const pageWidth = pdf.internal.pageSize.getWidth()
            const pageHeight = pdf.internal.pageSize.getHeight()
            // Tailwind v4 uses oklch() colors; html2canvas doesn't parse them. Inject fallback palette.
            const fallbackStyle = document.createElement('style')
            fallbackStyle.setAttribute('data-pdf-fallback', 'true')
            fallbackStyle.innerHTML = `
              /* Neutralize problematic modern color functions */
              * { outline-color: #000 !important; }
              .bg-white { background-color:#ffffff !important; }
              .bg-gray-50 { background-color:#f8fafc !important; }
              .bg-gray-100 { background-color:#f1f5f9 !important; }
              .bg-gray-200 { background-color:#e2e8f0 !important; }
              .bg-blue-600 { background-color:#2563eb !important; }
              .text-blue-600 { color:#2563eb !important; }
              .text-gray-500 { color:#6b7280 !important; }
              .text-gray-600 { color:#4b5563 !important; }
              .text-gray-700 { color:#374151 !important; }
              .text-gray-900 { color:#111827 !important; }
              .border { border-color:#e5e7eb !important; }
              .shadow, .shadow-sm { box-shadow:none !important; }
              [data-report-root] { color:#111827 !important; }
            `
            document.head.appendChild(fallbackStyle)

            // Temporarily remove transitions / animations for deterministic capture
            const prevAnim = document.body.style.animation
            const prevTrans = document.body.style.transition
            document.body.style.animation = 'none'
            document.body.style.transition = 'none'

            // Utility: detect oklch()/oklab()/color(display-p3 ...) patterns
            const hasUnsupportedColorFn = (v: string | null) => !!v && /(oklch|oklab|color\s*\()/i.test(v)
            // Convert OKLCH to sRGB (approx). Input format: oklch(L C h / a?)
            const oklchToSRGB = (str: string): string | null => {
                const m = /oklch\(\s*([0-9.]+%?|[0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?(?:\s*\/\s*([0-9.]+))?\s*\)/i.exec(str)
                if (!m) return null
                let [, Ls, Cs, hs, alpha] = m
                let L = Ls.endsWith('%') ? parseFloat(Ls) / 100 : parseFloat(Ls) // expecting 0-1 normally
                let C = parseFloat(Cs)
                let h = parseFloat(hs) * (Math.PI / 180)
                // OKLCH -> OKLab
                const a_ = Math.cos(h) * C
                const b_ = Math.sin(h) * C
                // OKLab -> LMS (inverse matrix)
                const L_ = L + 0.3963377774 * a_ + 0.2158037573 * b_
                const M_ = L - 0.1055613458 * a_ - 0.0638541728 * b_
                const S_ = L - 0.0894841775 * a_ - 1.2914855480 * b_
                const l = L_ ** 3
                const m2 = M_ ** 3
                const s = S_ ** 3
                let r = (4.0767416621 * l) - (3.3077115913 * m2) + (0.2309699292 * s)
                let g = (-1.2684380046 * l) + (2.6097574011 * m2) - (0.3413193965 * s)
                let b = (-0.0041960863 * l) - (0.7034186147 * m2) + (1.7076147010 * s)
                const clamp = (v: number) => Math.min(1, Math.max(0, v))
                r = clamp(r); g = clamp(g); b = clamp(b)
                const to255 = (v: number) => Math.round(v * 255)
                if (alpha) {
                    const aF = Math.min(1, Math.max(0, parseFloat(alpha)))
                    return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${aF})`
                }
                return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`
            }
            const toSRGB = (color: string, computed: CSSStyleDeclaration) => {
                if (/^rgb(a)?\(/i.test(color)) return color
                if (/oklch/i.test(color)) {
                    const converted = oklchToSRGB(color)
                    if (converted) return converted
                }
                // fallback to computed color
                return computed.color || color
            }
            const normalizeColors = (root: Document | HTMLElement) => {
                const walker = (root instanceof Document ? root.body : root)
                const all = walker.querySelectorAll<HTMLElement>('*')
                all.forEach(node => {
                    const cs = window.getComputedStyle(node)
                    const mappings: Array<[string, string]> = [
                        ['color', cs.color],
                        ['backgroundColor', cs.backgroundColor],
                        ['borderColor', cs.borderColor],
                        ['outlineColor', cs.outlineColor]
                    ]
                    mappings.forEach(([prop, val]) => {
                        if (hasUnsupportedColorFn(val)) {
                            const rgb = toSRGB(val!, cs)
                                ; (node.style as any)[prop] = rgb
                        }
                    })
                })
            }
            const addSection = async (el: HTMLElement, title?: string) => {
                const canvas = await html2canvas(el, {
                    scale: 2,
                    backgroundColor: '#ffffff',
                    useCORS: true,
                    onclone: (clonedDoc) => {
                        try { normalizeColors(clonedDoc) } catch { /* ignore */ }
                    }
                })
                const imgData = canvas.toDataURL('image/png')
                const imgWidth = pageWidth - 60
                const ratio = canvas.height / canvas.width
                const imgHeight = imgWidth * ratio
                let y = pdf.lastAutoTable ? (pdf as any).lastAutoTable.finalY + 20 : 40
                if (title) {
                    if (y + 20 > pageHeight - 40) { pdf.addPage(); y = 40 }
                    pdf.setFontSize(12)
                    pdf.text(title, 40, y)
                    y += 14
                }
                if (y + imgHeight > pageHeight - 40) { pdf.addPage(); y = 40 }
                pdf.addImage(imgData, 'PNG', 40, y, imgWidth, imgHeight)
            }

            // Capture narrative + front matter merged
            if (frontMatterRef.current) await addSection(frontMatterRef.current, 'Front Matter')
            if (narrativeRef.current) await addSection(narrativeRef.current, 'Narrative')

            // Build statistics table manually (text) for better clarity instead of rasterizing
            if (statsRef.current) {
                pdf.addPage()
                pdf.setFontSize(14)
                pdf.text('QC Statistics', 40, 50)
                pdf.setFontSize(8)
                const headers = ['Parameter', 'Level', 'n', 'Mean', 'SD', 'CV%', '1_2s', '1_3s', '2_2s', 'R_4s', '4_1s', '10_x']
                const startY = 70
                let y = startY
                pdf.setFont('helvetica', 'bold')
                headers.forEach((h, i) => pdf.text(h, 40 + i * 45, y))
                pdf.setFont('helvetica', 'normal')
                y += 12
                allReportStats.forEach(r => {
                    if (y > pageHeight - 60) { pdf.addPage(); y = 50 }
                    const paramName = parameters.find(p => p.id === r.parameter)?.name || r.parameter
                    const row = [paramName, r.level, r.n, r.n ? r.mean.toFixed(3) : '—', r.n > 1 ? r.sd.toFixed(3) : '—', r.cv != null ? r.cv.toFixed(1) : '—', r.rules['1₂s'] || 0, r.rules['1₃s'] || 0, r.rules['2₂s'] || 0, r.rules['R₄s'] || 0, r.rules['4₁s'] || 0, r.rules['10ₓ'] || 0]
                    row.forEach((val, i) => pdf.text(String(val), 40 + i * 45, y))
                    y += 10
                })
            }

            // Charts grid: capture each chart card individually for resolution
            if (chartsRef.current) {
                const cards = chartsRef.current.querySelectorAll('[data-report-lj-parameter]') as NodeListOf<HTMLElement>
                for (let i = 0; i < cards.length; i++) {
                    const card = cards[i]
                    await addSection(card, card.getAttribute('data-report-lj-parameter') || undefined)
                }
            }

            const pdfBranch = branchName(selectedBranch).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'branch'
            const fileName = `qc_report_${pdfBranch}_${dateRange.start}_${dateRange.end}.pdf`
            // Page numbers
            const pageCount = (pdf as any).internal.getNumberOfPages()
            for (let i = 1; i <= pageCount; i++) {
                pdf.setPage(i)
                pdf.setFontSize(8)
                pdf.text(`Page ${i} / ${pageCount}`, pageWidth - 70, pageHeight - 20)
            }
            pdf.save(fileName)
        } catch (err) {
            console.error('PDF export failed', err)
        } finally {
            // Cleanup fallback styles
            const styleEl = document.querySelector('style[data-pdf-fallback="true"]')
            if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
            document.body.style.animation = ''
            document.body.style.transition = ''
            setExporting(false)
        }
    }

    // Replace allParameterIdsForBranch to use branch-wide recentProcessed dataset
    const allParameterIdsForBranch = useMemo(() => {
        const setP = new Set<string>()
        recentProcessed.filter(r => r.branch === selectedBranch && new Date(r.date) >= new Date(dateRange.start) && new Date(r.date) <= new Date(dateRange.end)).forEach(r => setP.add(r.parameter))
        return Array.from(setP).sort()
    }, [recentProcessed, selectedBranch, dateRange.start, dateRange.end])

    // Add allReportStats after allParameterIdsForBranch
    const allReportStats = useMemo(() => {
        const stats: Array<{ parameter: string; level: string; n: number; mean: number; sd: number; cv: number | null; rules: Record<string, number>; zShift?: number }> = []
        const branchRows = recentProcessed.filter(r => r.branch === selectedBranch && new Date(r.date) >= new Date(dateRange.start) && new Date(r.date) <= new Date(dateRange.end))
        const paramIds = Array.from(new Set(branchRows.map(r => r.parameter)))
        paramIds.forEach(pid => {
            (['L1', 'L2', 'L3'] as const).forEach(level => {
                const rows = branchRows.filter(r => r.parameter === pid && r.level === level)
                if (!rows.length) return
                const values = rows.map(r => r.value)
                const n = values.length
                const mean = values.reduce((a, b) => a + b, 0) / n
                const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, n - 1)
                const sd = Math.sqrt(variance)
                const cv = mean !== 0 ? (sd / mean) * 100 : null
                const rules = { '1₂s': 0, '1₃s': 0, '2₂s': 0, 'R₄s': 0, '4₁s': 0, '10ₓ': 0 }
                rows.forEach(r => { const z = r.zScore; if (z != null) { if (Math.abs(z) >= 3) rules['1₃s']++; else if (Math.abs(z) >= 2) rules['1₂s']++ } })
                stats.push({ parameter: pid, level, n, mean, sd, cv, rules })
            })
        })
        return stats
    }, [recentProcessed, selectedBranch, dateRange.start, dateRange.end])

    const renderReports = () => {
        return (
            <div className="space-y-8" ref={reportRootRef} data-report-root>
                {/* Description only */}
                <div className="bg-white shadow rounded-lg p-4 text-sm" ref={narrativeRef} data-report-section="narrative">
                    <h3 className="font-semibold mb-2">Description</h3>
                    <textarea value={narrativeText} onChange={e => setNarrativeText(e.target.value)} rows={6} className="w-full border rounded p-2 text-xs focus:ring-2 focus:ring-blue-500" placeholder="Enter description to include in export." />
                </div>
                {/* Existing Front Matter follows */}
                <div className="bg-white shadow rounded-lg p-4 text-sm grid md:grid-cols-2 gap-4" ref={frontMatterRef} data-report-section="front-matter">
                    <div>
                        <div><span className="font-medium">Branch:</span> {branchName(selectedBranch)}</div>
                        <div><span className="font-medium">Parameters:</span> {allParameterIdsForBranch.length} ({allParameterIdsForBranch.map(pid => parameters.find(p => p.id === pid)?.name || pid).join(', ')})</div>
                        <div><span className="font-medium">Period:</span> {dateRange.start} → {dateRange.end}</div>
                        <div><span className="font-medium">Generated:</span> {new Date().toLocaleString()}</div>
                    </div>
                    <div className="flex flex-col gap-2 text-xs">
                        <label className="flex items-center gap-2"> <span className="font-medium w-20">Prepared By</span>
                            <input value={preparedBy} onChange={e => setPreparedBy(e.target.value)} placeholder="Name" className="flex-1 border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </label>
                        <label className="flex items-center gap-2"> <span className="font-medium w-20">Reviewed By</span>
                            <input value={reviewedBy} onChange={e => setReviewedBy(e.target.value)} placeholder="Name" className="flex-1 border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </label>
                        <div><span className="font-medium">Version:</span> {dateRange.start.slice(0, 7)}</div>
                    </div>
                </div>
                {/* Visible LJ Charts */}
                {/* Removed old per-level LJ charts in favor of combined multi-parameter charts */}
                {/* Statistics Table */}
                <div className="bg-white shadow rounded-lg p-4" ref={statsRef} data-report-section="statistics">
                    <h3 className="font-semibold mb-3 text-sm">QC Statistics</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50">
                                <tr className="border-b">
                                    <th className="p-2 text-left">Parameter</th>
                                    <th className="p-2 text-left">Level</th>
                                    <th className="p-2 text-right">n</th>
                                    <th className="p-2 text-right">Mean</th>
                                    <th className="p-2 text-right">SD</th>
                                    <th className="p-2 text-right">CV%</th>
                                    <th className="p-2 text-right">1₂s</th>
                                    <th className="p-2 text-right">1₃s</th>
                                    <th className="p-2 text-right">2₂s</th>
                                    <th className="p-2 text-right">R₄s</th>
                                    <th className="p-2 text-right">4₁s</th>
                                    <th className="p-2 text-right">10ₓ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allReportStats.map(r => {
                                    const paramName = parameters.find(p => p.id === r.parameter)?.name || r.parameter
                                    return (
                                        <tr key={paramName + "_" + r.level} className="border-b">
                                            <td className="p-2 font-medium">{paramName}</td>
                                            <td className="p-2">{r.level}</td>
                                            <td className="p-2 text-right">{r.n}</td>
                                            <td className="p-2 text-right">{r.n ? r.mean.toFixed(3) : '—'}</td>
                                            <td className="p-2 text-right">{r.n > 1 ? r.sd.toFixed(3) : '—'}</td>
                                            <td className="p-2 text-right">{r.cv != null ? r.cv.toFixed(1) : '—'}</td>
                                            <td className="p-2 text-right">{r.rules['1₂s'] || 0}</td>
                                            <td className="p-2 text-right">{r.rules['1₃s'] || 0}</td>
                                            <td className="p-2 text-right">{r.rules['2₂s'] || 0}</td>
                                            <td className="p-2 text-right">{r.rules['R₄s'] || 0}</td>
                                            <td className="p-2 text-right">{r.rules['4₁s'] || 0}</td>
                                            <td className="p-2 text-right">{r.rules['10ₓ'] || 0}</td>
                                        </tr>
                                    )
                                })}
                                {!allReportStats.length && <tr><td colSpan={12} className="p-4 text-center text-gray-500">No statistics for selected period.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
                {/* Combined Z-Score Charts */}
                <div className="bg-white shadow rounded-lg p-4" ref={chartsRef} data-report-section="charts">
                    <h3 className="font-semibold mb-3 text-sm">Combined Z-Score Charts</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-report-charts-grid>
                        {allParameterIdsForBranch.map(pid => {
                            const param = parameters.find(p => p.id === pid)
                            const rows = recentProcessed.filter(r => r.branch === selectedBranch && r.parameter === pid && new Date(r.date) >= new Date(dateRange.start) && new Date(r.date) <= new Date(dateRange.end))
                            if (!rows.length) return null
                            const dataL1 = rows.filter(r => r.level === 'L1').map(r => ({ date: r.date, z: r.zScore }))
                            const dataL2 = rows.filter(r => r.level === 'L2').map(r => ({ date: r.date, z: r.zScore }))
                            const dataL3 = rows.filter(r => r.level === 'L3').map(r => ({ date: r.date, z: r.zScore }))
                            const domain = [-3.5, 3.5]
                            return (
                                <div key={pid} className="border rounded-md p-4 bg-white" data-combined-chart={pid}>
                                    <div className="mb-2 text-xs font-semibold">
                                        <span>{param?.name || pid}</span>
                                    </div>
                                    <div className="h-48">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart margin={{ top: 8, left: 8, right: 8, bottom: 4 }}>
                                                <CartesianGrid stroke="#eee" strokeDasharray="4 4" />
                                                <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 10 }} minTickGap={16} />
                                                <YAxis domain={domain} tick={{ fontSize: 10 }} />
                                                <Tooltip formatter={(val: any) => [val, 'Z']} />
                                                <ReferenceLine y={0} stroke="#111827" strokeWidth={2} />
                                                <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="4 4" />
                                                <ReferenceLine y={-1} stroke="#6b7280" strokeDasharray="4 4" />
                                                <ReferenceLine y={2} stroke="#f59e0b" strokeDasharray="4 4" />
                                                <ReferenceLine y={-2} stroke="#f59e0b" strokeDasharray="4 4" />
                                                <ReferenceLine y={3} stroke="#dc2626" strokeDasharray="4 4" />
                                                <ReferenceLine y={-3} stroke="#dc2626" strokeDasharray="4 4" />
                                                <Line data={dataL1} dataKey="z" name="L1" stroke="#2563eb" dot={{ r: 2 }} isAnimationActive={false} type="monotone" />
                                                <Line data={dataL2} dataKey="z" name="L2" stroke="#16a34a" dot={{ r: 2 }} isAnimationActive={false} type="monotone" />
                                                <Line data={dataL3} dataKey="z" name="L3" stroke="#9333ea" dot={{ r: 2 }} isAnimationActive={false} type="monotone" />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )
                        })}
                        {!allParameterIdsForBranch.length && <div className="text-xs text-gray-500">No charts for selected period.</div>}
                    </div>
                </div>
                {/* Export Actions */}
                <div className="flex gap-3 justify-end">
                    <button onClick={exportReportCSV} disabled={exporting} className="px-4 py-2 text-xs rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50">CSV</button>
                    <button onClick={() => backendExport('pdf')} disabled={exporting} className="px-4 py-2 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                        {exporting && (<svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>)}
                        <span>{exporting ? 'PDF…' : 'PDF'}</span>
                    </button>
                    <button onClick={() => backendExport('docx')} disabled={exporting} className="px-4 py-2 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                        {exporting && (<svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>)}
                        <span>{exporting ? 'DOCX…' : 'DOCX'}</span>
                    </button>
                    <button onClick={() => backendExport('html')} disabled={exporting} className="px-4 py-2 text-xs rounded bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2">
                        {exporting && (<svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>)}
                        <span>{exporting ? 'HTML…' : 'HTML'}</span>
                    </button>
                    <button onClick={exportGoogleDoc} disabled={gdocExporting} className="px-4 py-2 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                        {gdocExporting && (<svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>)}
                        <span>{gdocExporting ? 'Google Doc…' : (googleReady ? 'Google Doc' : 'Connect Google')}</span>
                    </button>
                </div>
            </div>
        )
    }

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
    // Enhanced return with branch selector, period presets, tabs, content and modal
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Top Bar */}
            <div className="bg-white shadow-sm border-b">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-start md:items-center py-4 flex-col md:flex-row gap-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-600 text-white p-2 rounded"><BarChart3 className="w-6 h-6" /></div>
                            <h1 className="text-xl font-semibold text-gray-900">Medical Lab QA Dashboard</h1>
                        </div>
                        <div className="flex flex-wrap items-end gap-4 w-full md:w-auto">
                            {role !== 'tech' ? (
                                <div className="flex flex-col text-xs">
                                    <label className="text-gray-500 mb-0.5">Branch</label>
                                    <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="border rounded px-2 py-1 text-sm min-w-[140px]">
                                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                </div>
                            ) : (
                                <div className="flex flex-col text-xs">
                                    <label className="text-gray-500 mb-0.5">Branch</label>
                                    <div className="px-2 py-1 text-sm min-w-[140px] bg-gray-50 border rounded">{branchName(selectedBranch)}</div>
                                </div>
                            )}
                            <div className="flex flex-col text-xs">
                                <label className="text-gray-500 mb-0.5">Period</label>
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Calendar className="w-4 h-4" />
                                    <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="border rounded px-2 py-1" />
                                    <span>to</span>
                                    <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="border rounded px-2 py-1" />
                                </div>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {[
                                        { label: '7d', days: 7 },
                                        { label: '30d', days: 30 },
                                        { label: '90d', days: 90 },
                                    ].map(p => (
                                        <button key={p.label} type="button" onClick={() => {
                                            const end = new Date();
                                            const start = new Date(Date.now() - p.days * 24 * 60 * 60 * 1000);
                                            const fmt = (d: Date) => d.toISOString().split('T')[0];
                                            setDateRange({ start: fmt(start), end: fmt(end) });
                                        }} className="px-2 py-0.5 border rounded text-[11px] hover:bg-gray-100">{p.label}</button>
                                    ))}
                                    <button type="button" onClick={() => {
                                        const now = new Date();
                                        const start = new Date(now.getFullYear(), now.getMonth(), 1);
                                        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                                        const fmt = (d: Date) => d.toISOString().split('T')[0];
                                        setDateRange({ start: fmt(start), end: fmt(end) });
                                    }} className="px-2 py-0.5 border rounded text-[11px] hover:bg-gray-100">This Month</button>
                                </div>
                            </div>
                            {claims && (
                                <div className="text-xs text-gray-700 leading-tight min-w-[180px]">
                                    <div className="font-medium truncate" title={userDisplay}>{userDisplay}</div>
                                    <div className="text-[11px] text-gray-500">{(claims.role || 'role')} {claims.branch ? `· ${branchName(claims.branch)}` : ''}</div>
                                </div>
                            )}
                            <button onClick={() => { logout(); if (typeof window !== 'undefined') window.location.replace('/login') }} className="text-sm text-red-600 hover:text-red-700 self-start">Logout</button>
                        </div>
                    </div>
                </div>
            </div>
            {/* Tabs */}
            <div className="bg-white border-b">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <nav className="flex space-x-8 overflow-x-auto">{[{ id: 'dataEntry', name: 'Data Entry', icon: Plus, show: can.dataEntry }, { id: 'charts', name: 'Charts & Analysis', icon: BarChart3, show: can.charts }, { id: 'alerts', name: 'Alerts', icon: AlertTriangle, show: can.alerts }, { id: 'targets', name: 'Target Management', icon: Settings, show: can.targets }, { id: 'reports', name: 'Reports', icon: FileText, show: can.reports }].filter(t => t.show).map((tab: any) => (
                        <button key={tab.id} onClick={() => setCurrentTab(tab.id)} className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm ${currentTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                            <tab.icon className="w-4 h-4" />{tab.name}
                            {tab.id === 'alerts' && alerts.filter(a => !a.acknowledged).length > 0 && (
                                <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[1.5rem] text-center">{alerts.filter(a => !a.acknowledged).length}</span>
                            )}
                        </button>
                    ))}</nav>
                </div>
            </div>
            {/* Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {currentTab === 'dataEntry' && can.dataEntry && renderDataEntry()}
                {currentTab === 'charts' && can.charts && renderCharts()}
                {currentTab === 'alerts' && can.alerts && renderAlerts()}
                {currentTab === 'targets' && can.targets && renderTargets()}
                {currentTab === 'reports' && can.reports && renderReports()}
            </div>
            {/* Target Modal */}
            {showTargetModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold">{editingTarget ? 'Edit Target Values' : 'Add Target Values'}</h3>
                            <button onClick={() => { setShowTargetModal(false); setEditingTarget(null) }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                        </div>
                        <form onSubmit={handleTargetSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Branch</label>
                                <select value={targetForm.branch} onChange={(e) => setTargetForm({ ...targetForm, branch: e.target.value })} className="w-full p-2 border rounded" required>
                                    {branches.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Parameter</label>
                                <select value={targetForm.parameter} onChange={(e) => setTargetForm({ ...targetForm, parameter: e.target.value })} className="w-full p-2 border rounded" required>
                                    {parameters.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Level</label>
                                <select value={targetForm.level} onChange={(e) => setTargetForm({ ...targetForm, level: e.target.value })} className="w-full p-2 border rounded" required>
                                    <option value="L1">L1</option>
                                    <option value="L2">L2</option>
                                    <option value="L3">L3</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Target Mean</label>
                                <input type="number" step="0.01" value={targetForm.mean} onChange={(e) => setTargetForm({ ...targetForm, mean: e.target.value })} className="w-full p-2 border rounded" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Target SD</label>
                                <input type="number" step="0.01" value={targetForm.sd} onChange={(e) => setTargetForm({ ...targetForm, sd: e.target.value })} className="w-full p-2 border rounded" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Valid From</label>
                                <input type="date" value={targetForm.validFrom} onChange={(e) => setTargetForm({ ...targetForm, validFrom: e.target.value })} className="w-full p-2 border rounded" required />
                            </div>
                            <div className="flex gap-2">
                                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700">{editingTarget ? 'Update' : 'Add'} Target</button>
                                <button type="button" onClick={() => { setShowTargetModal(false); setEditingTarget(null) }} className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
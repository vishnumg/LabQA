"use client"
// Migrated full dashboard implementation from former frontend directory.
// (Enhancement) Technician defaults: auto lock branch & ensure first parameter selected after data loads.
import { useEffect, useMemo, useState, useRef } from 'react'
import { BarChart3, AlertTriangle, Settings, FileText, Calendar, X, Plus } from 'lucide-react'
import { initOAuthMessageListener, loadTokens, ensureGoogleAccessToken, startGoogleOAuth } from '../../lib/googleAuth'
import dynamic from 'next/dynamic'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'

// Extracted modules
import type { QcEntry, TargetVersion, Alert, Branch, Parameter, Technician, LabDetails, EntryForm, TargetForm, DateRange, TabType } from './types'
import { formatDateDisplay, formatDateTimeDisplay, effectiveTarget, calculateZ, evaluateRules, calculateObservedStats, getEffectiveTargetMap } from './utils'
import { useBranches, useParameters, useTargets, useQcData, useRecentQcData, useTechnicians } from './hooks'
import DataEntry from './components/DataEntry'
import AlertsView from './components/AlertsView'
import ReportsView from './components/ReportsView'
import AdminView from './components/AdminView'
import TargetsView from './components/TargetsView'
import TargetModal from './components/TargetModal'
import DeleteConfirmationModal, { type DeleteOption } from './components/DeleteConfirmationModal'

const Charts = dynamic(() => import('./Charts'), { ssr: false })

type TargetVersionsMap = Record<string, TargetVersion[]>
type TargetMap = Record<string, { mean: number; sd: number; validFrom: string }>

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
    const [currentTab, setCurrentTab] = useState<'dataEntry' | 'charts' | 'alerts' | 'targets' | 'reports' | 'admin'>('dataEntry')
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
    const userBranch = claims?.branch_id

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
    // Admin management state
    const isAdmin = role === 'admin'
    const [technicians, setTechnicians] = useState<Array<{ id: string; email: string; branch_id?: string | null; created_at?: string }>>([])
    const [techLoading, setTechLoading] = useState(false)
    const [branchCreateName, setBranchCreateName] = useState('')
    const [branchEdit, setBranchEdit] = useState<{ id: string; name: string } | null>(null)
    const [techCreate, setTechCreate] = useState<{ email: string; password: string; branch_id: string | '' }>({ email: '', password: '', branch_id: '' })
    const [techEdit, setTechEdit] = useState<{ id: string; email: string; branch_id: string | '' } | null>(null)
    const [pwReset, setPwReset] = useState<{ id: string; password: string } | null>(null)
    const [adminMessage, setAdminMessage] = useState<string | null>(null)

    // Delete confirmation modal state
    const [deleteModal, setDeleteModal] = useState<{
        isOpen: boolean
        type: 'branch' | 'technician' | null
        item: { id: string; name: string } | null
        cascadeOptions: DeleteOption[]
        isDeleting: boolean
    }>({ isOpen: false, type: null, item: null, cascadeOptions: [], isDeleting: false })

    // Display helpers (avoid showing raw UUIDs)
    const branchName = (id: string | undefined | null) => {
        if (!id) return ''
        const b = branches.find(x => x.id === id)
        return b?.name || id
    }
    // User display: email and branch/role
    const userEmail = claims?.email || claims?.sub || 'User'
    const userBranchDisplay = isAdmin ? 'Admin' : (userBranch ? branchName(userBranch) : '')

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
    // Load technicians lazily when admin tab selected
    useEffect(() => {
        if (!isAdmin) return
        if (currentTab !== 'admin') return
        let cancelled = false
        const loadTechs = async () => {
            setTechLoading(true)
            const r = await api.adminListTechnicians()
            if (!cancelled) {
                if (r.ok && Array.isArray(r.json?.items)) setTechnicians(r.json.items)
                setTechLoading(false)
            }
        }
        loadTechs()
        return () => { cancelled = true }
    }, [currentTab, isAdmin])
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

    // Wrapper functions that use imported utils with local state
    const getEffectiveTarget = (branch: string, parameter: string, level: string, onDate: string) =>
        effectiveTarget(targetVersions, branch, parameter, level, onDate)

    const getCalculateZ = (value: number, parameter: string, level: string, branch: string, date?: string) =>
        calculateZ(value, parameter, level, branch, date || new Date().toISOString().split('T')[0], targetVersions)

    const runEvaluateRules = (data: QcEntry[]) => {
        const newAlerts = evaluateRules(data)
        setAlerts(newAlerts)
    }

    const processed = useMemo(() => {
        const p = qcData.map(e => ({ ...e, zScore: getCalculateZ(e.value, e.parameter, e.level, e.branch, e.date) }))
        runEvaluateRules(p)
        return p
    }, [qcData, targetValues])
    const recentProcessed = useMemo(() => recentQcData.map(e => ({ ...e, zScore: getCalculateZ(e.value, e.parameter, e.level, e.branch, e.date) })), [recentQcData, targetValues])
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

    const observedStats = useMemo(() => calculateObservedStats(filtered), [filtered])

    const acknowledgeAlert = (id: string | number) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a))
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

    // Charts data processing
    const renderCharts = () => (<Charts selectedBranch={selectedBranch} selectedParameter={selectedParameter} parameters={parameters} chartData={chartData as any} targetValues={targetValues} observedStats={observedStats as any} setSelectedParameter={setSelectedParameter} />)

    // Alerts table sort/filter
    const [alertSortKey, setAlertSortKey] = useState<string>('date')
    const [alertSortDir, setAlertSortDir] = useState<'asc' | 'desc'>('desc')
    const [alertFilters, setAlertFilters] = useState<Record<string, string>>({ date: '', branch: '', parameter: '', level: '', rule: '', description: '', severity: '', acknowledged: '' })
    const toggleAlertSort = (key: string) => { if (alertSortKey === key) setAlertSortDir(alertSortDir === 'asc' ? 'desc' : 'asc'); else { setAlertSortKey(key); setAlertSortDir('asc') } }
    const alertRows = useMemo(() => {
        const rows = alerts.filter(a => { const m: Record<string, string> = { date: a.date, branch: a.branch, parameter: a.parameter, level: a.level, rule: a.rule, description: a.description, severity: a.severity, acknowledged: a.acknowledged ? 'yes' : 'no' }; return Object.entries(alertFilters).every(([k, v]) => (v || '').trim() === '' || (m[k] || '').toLowerCase().includes(v.toLowerCase().trim())) }).sort((a: any, b: any) => { const get = (r: any) => (r as any)[alertSortKey]; const va = get(a), vb = get(b); if (typeof va === 'number' && typeof vb === 'number') return alertSortDir === 'asc' ? va - vb : vb - va; return alertSortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va)) })
        return rows
    }, [alerts, alertFilters, alertSortKey, alertSortDir])


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


    // Report functions
    const exportReportCSV = () => {
        const meta = [
            `Lab Name:,"${labDetails.name}"`,
            `Branch:,"${branchName(selectedBranch).replace(/"/g, '""')}"`,
            `Parameters:,${allParameterIdsForBranch.length}`,
            `Parameter List:,"${allParameterIdsForBranch.map(pid => parameters.find(p => p.id === pid)?.name || pid).join('; ')}"`,
            `Period:,${formatDateDisplay(dateRange.start)} to ${formatDateDisplay(dateRange.end)}`,
            `Generated:,${formatDateTimeDisplay(new Date().toISOString())}`,
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
        const fileStartDate = formatDateDisplay(dateRange.start).replace(/\//g, '-')
        const fileEndDate = formatDateDisplay(dateRange.end).replace(/\//g, '-')
        a.download = `qc_report_${safeBranchSlug}_${fileStartDate}_${fileEndDate}.csv`
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

    // Utility
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

    // Google Doc export (stateless; charts images to be added later)
    const exportGoogleDoc = async () => {
        if (gdocExporting) return
        setGdocExporting(true)
        try {
            const apiBase = process.env.NEXT_PUBLIC_API_BASE || ''
            let accessToken = await ensureGoogleAccessToken(apiBase)
            if (!accessToken) {
                await startGoogleOAuth(apiBase)
                for (let i = 0; i < 60; i++) { await wait(500); accessToken = await ensureGoogleAccessToken(apiBase); if (accessToken) break }
            }
            if (!accessToken) throw new Error('Authorization required – Google OAuth not completed')
            const rasterizeCharts = async () => {
                type Capture = { parameterId: string; name: string; pngBase64: string }
                const captures: Capture[] = []
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
                                    const canvas = await html2canvas(container, { backgroundColor: '#ffffff', scale: 1, useCORS: true })
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
                            const canvas = await html2canvas(chartsSection, { backgroundColor: '#ffffff', scale: 1, useCORS: true })
                            const dataUrl = canvas.toDataURL('image/png')
                            if (dataUrl.startsWith('data:image/png;base64,')) {
                                const base64 = dataUrl.substring('data:image/png;base64.'.length)
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
            // Build rule violations payload
            const ruleViolations = reportAlerts.map(a => ({
                date: formatDateDisplay(a.date),
                parameter: parameters.find(p => p.id === a.parameter)?.name || a.parameter,
                level: a.level,
                rule: a.rule,
                description: a.description,
                severity: a.severity === 'error' ? 'Critical' : 'Warning'
            }))
            const body = {
                branchName: branchName(selectedBranch),
                period: { from: dateRange.start, to: dateRange.end },
                narrative: narrativeText,
                parameters: payloadParameters,
                chartImages,
                ruleViolations,
                format: 'gdoc'
            }
            const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
            const targetUrl = `${apiBase || ''}/api/report/export`.replace(/([^:])\/\//g, '$1/')
            const res = await fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}), 'X-Google-Access-Token': accessToken }, body: JSON.stringify(body) })
            if (!res.ok) { let msg = 'Google Doc export failed'; try { const j = await res.json(); msg = j.detail || j.error || msg } catch { } throw new Error(msg) }
            const j = await res.json()
            if (j.url) {
                window.open(j.url, '_blank')
            } else {
                alert('Export succeeded but no document URL returned')
            }
        } catch (e: any) {
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
            const pdfStartDate = formatDateDisplay(dateRange.start).replace(/\//g, '-')
            const pdfEndDate = formatDateDisplay(dateRange.end).replace(/\//g, '-')
            const fileName = `qc_report_${pdfBranch}_${pdfStartDate}_${pdfEndDate}.pdf`
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

    // Calculate alerts for the report period
    const reportAlerts = useMemo(() => {
        const branchRows = recentProcessed.filter(r => r.branch === selectedBranch && new Date(r.date) >= new Date(dateRange.start) && new Date(r.date) <= new Date(dateRange.end))
        const newAlerts: Alert[] = []
        const sorted = [...branchRows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
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
        return newAlerts
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

    // --- Admin helpers & UI ---
    const refreshBranches = async () => {
        const b = await api.getBranches(); if (b.ok && Array.isArray(b.json?.items)) setBranches(b.json.items)
    }

    const refreshParameters = async () => {
        const p = await api.getParameters(); if (p.ok && Array.isArray(p.json?.items)) setParameters(p.json.items)
    }
    const refreshTechnicians = async () => {
        if (!isAdmin) return; const r = await api.adminListTechnicians(); if (r.ok && Array.isArray(r.json?.items)) setTechnicians(r.json.items)
    }

    // Calculate cascade delete options for branch
    const getBranchCascadeOptions = (branchId: string): DeleteOption[] => {
        const options: DeleteOption[] = []

        // Always offer to delete QC entries (we can't count all of them from frontend due to date filtering)
        // The count shown is only for visible entries, actual count may be higher
        const qcCount = recentQcData.filter(q => q.branch === branchId).length
        options.push({
            id: 'qc_entries',
            label: qcCount > 0 ? `${qcCount}+ QC Data Entries` : 'QC Data Entries (if any)',
            description: `All quality control measurements for this branch (across all dates)`,
            checked: true
        })

        // Always offer to delete targets
        const targetCount = Object.keys(targetVersions).filter(k => k.startsWith(branchId + '_')).length
        options.push({
            id: 'targets',
            label: targetCount > 0 ? `${targetCount} Target Configurations` : 'Target Configurations (if any)',
            description: `Target mean and SD values for parameters`,
            checked: true
        })

        // Count technicians
        const techCount = technicians.filter(t => t.branch_id === branchId).length
        if (techCount > 0) {
            options.push({
                id: 'technicians',
                label: `${techCount} Technician${techCount > 1 ? 's' : ''}`,
                description: `Users assigned to this branch will be unlinked (not deleted)`,
                checked: false // Don't delete technicians by default
            })
        }

        // Note: Alerts are computed dynamically from QC entries, not stored separately.
        // When QC entries are deleted, their associated alerts disappear automatically.

        return options
    }

    // Calculate cascade delete options for technician
    const getTechnicianCascadeOptions = (techId: string): DeleteOption[] => {
        const options: DeleteOption[] = []

        // Note: QC entries don't currently track technician_id, so we can't cascade delete them
        // If needed in future, add technician_id to QcEntry type and track it

        return options
    }

    const handleBranchCreate = async (e: React.FormEvent) => { e.preventDefault(); if (!branchCreateName.trim()) return; const r = await api.adminCreateBranch(branchCreateName.trim()); if (r.ok) { setBranchCreateName(''); setAdminMessage('Branch created'); refreshBranches() } else setAdminMessage('Failed to create branch') }
    const handleBranchUpdate = async (e: React.FormEvent) => { e.preventDefault(); if (!branchEdit) return; const r = await api.adminUpdateBranch(branchEdit.id, branchEdit.name.trim()); if (r.ok) { setAdminMessage('Branch updated'); setBranchEdit(null); refreshBranches() } else setAdminMessage('Failed to update branch') }

    const handleBranchDelete = (id: string) => {
        const branch = branches.find(b => b.id === id)
        if (!branch) return

        const cascadeOptions = getBranchCascadeOptions(id)
        setDeleteModal({
            isOpen: true,
            type: 'branch',
            item: { id: branch.id, name: branch.name },
            cascadeOptions,
            isDeleting: false
        })
    }

    const handleTechCreate = async (e: React.FormEvent) => { e.preventDefault(); if (!techCreate.email || !techCreate.password) return; const r = await api.adminCreateTechnician(techCreate.email, techCreate.password, techCreate.branch_id || undefined); if (r.ok) { setTechCreate({ email: '', password: '', branch_id: '' }); setAdminMessage('Technician created'); refreshTechnicians() } else setAdminMessage('Failed to create technician') }
    const handleTechUpdate = async (e: React.FormEvent) => { e.preventDefault(); if (!techEdit) return; const r = await api.adminUpdateTechnician(techEdit.id, { email: techEdit.email, branch_id: techEdit.branch_id || null }); if (r.ok) { setTechEdit(null); setAdminMessage('Technician updated'); refreshTechnicians() } else setAdminMessage('Update failed') }

    const handleTechDelete = (id: string) => {
        const tech = technicians.find(t => t.id === id)
        if (!tech) return

        const cascadeOptions = getTechnicianCascadeOptions(id)
        setDeleteModal({
            isOpen: true,
            type: 'technician',
            item: { id: tech.id, name: tech.email },
            cascadeOptions,
            isDeleting: false
        })
    }

    const confirmDelete = async (selectedOptions: string[]) => {
        if (!deleteModal.item) return

        setDeleteModal(prev => ({ ...prev, isDeleting: true }))

        try {
            if (deleteModal.type === 'branch') {
                const r = await api.adminDeleteBranch(deleteModal.item.id, selectedOptions)
                if (r.ok) {
                    setAdminMessage('Branch deleted successfully')
                    refreshBranches()
                    setDeleteModal({ isOpen: false, type: null, item: null, cascadeOptions: [], isDeleting: false })
                } else {
                    // Parse error response
                    let errorMsg = 'Delete failed'
                    if (r.status === 409) {
                        const detail = r.json?.detail || ''
                        if (detail.startsWith('branch_in_use:')) {
                            // Extract the helpful message from the backend
                            errorMsg = detail.replace('branch_in_use: ', '❌ Cannot delete branch: ')
                        } else if (detail === 'branch_in_use') {
                            errorMsg = '⚠️ Branch has related data. Please select cascade options to delete related items.'
                        } else {
                            errorMsg = detail || 'Branch has related data that must be handled first.'
                        }
                    } else if (r.json?.detail) {
                        errorMsg = r.json.detail
                    }
                    setAdminMessage(errorMsg)
                    setDeleteModal(prev => ({ ...prev, isDeleting: false }))
                }
            } else if (deleteModal.type === 'technician') {
                const r = await api.adminDeleteTechnician(deleteModal.item.id, selectedOptions)
                if (r.ok) {
                    setAdminMessage('Technician deleted successfully')
                    refreshTechnicians()
                    setDeleteModal({ isOpen: false, type: null, item: null, cascadeOptions: [], isDeleting: false })
                } else {
                    let errorMsg = 'Delete failed'
                    if (r.status === 409 && r.json?.detail === 'technician_in_use') {
                        errorMsg = '⚠️ Backend does not support cascade delete yet. Please manually delete related data first.'
                    } else if (r.json?.detail) {
                        errorMsg = r.json.detail
                    }
                    setAdminMessage(errorMsg)
                    setDeleteModal(prev => ({ ...prev, isDeleting: false }))
                }
            }
        } catch (error) {
            setAdminMessage('Delete operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
            setDeleteModal(prev => ({ ...prev, isDeleting: false }))
        }
    }

    const cancelDelete = () => {
        setDeleteModal({ isOpen: false, type: null, item: null, cascadeOptions: [], isDeleting: false })
    }
    const handlePwReset = async (e: React.FormEvent) => { e.preventDefault(); if (!pwReset) return; const r = await api.adminChangeTechnicianPassword(pwReset.id, pwReset.password); if (r.ok) { setPwReset(null); setAdminMessage('Password changed'); } else setAdminMessage('Password change failed') }





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
                <div className="px-2 sm:px-4">
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
                                    <div className="font-medium truncate" title={userEmail}>{userEmail}</div>
                                    <div className="text-[11px] text-gray-500">{userBranchDisplay}</div>
                                </div>
                            )}
                            <button onClick={() => { logout(); if (typeof window !== 'undefined') window.location.replace('/login') }} className="text-sm text-red-600 hover:text-red-700 self-start">Logout</button>
                        </div>
                    </div>
                </div>
            </div>
            {/* Tabs */}
            <div className="bg-white border-b">
                <div className="px-2 sm:px-4">
                    <nav className="flex space-x-8 overflow-x-auto">{[
                        { id: 'dataEntry', name: 'Data Entry', icon: Plus, show: can.dataEntry },
                        { id: 'charts', name: 'Charts & Analysis', icon: BarChart3, show: can.charts },
                        { id: 'alerts', name: 'Alerts', icon: AlertTriangle, show: can.alerts },
                        { id: 'targets', name: 'Target Management', icon: Settings, show: can.targets },
                        { id: 'reports', name: 'Reports', icon: FileText, show: can.reports },
                        { id: 'admin', name: 'Admin', icon: Settings, show: isAdmin },
                    ].filter(t => t.show).map((tab: any) => (
                        <button
                            key={tab.id}
                            onClick={() => setCurrentTab(tab.id)}
                            className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm ${currentTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                        >
                            <tab.icon className="w-4 h-4" />{tab.name}
                            {tab.id === 'alerts' && alerts.filter(a => !a.acknowledged).length > 0 && (
                                <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[1.5rem] text-center">{alerts.filter(a => !a.acknowledged).length}</span>
                            )}
                        </button>
                    ))}</nav>
                </div>
            </div>
            {/* Content */}
            <div className="px-2 sm:px-4 py-6">
                {currentTab === 'dataEntry' && can.dataEntry && (
                    <DataEntry
                        entryForm={entryForm}
                        setEntryForm={setEntryForm}
                        branches={branches}
                        parameters={parameters}
                        isTech={isTech}
                        claims={claims}
                        selectedBranch={selectedBranch}
                        selectedParameter={selectedParameter}
                        dateRange={dateRange}
                        userBranch={userBranch}
                        setQcData={setQcData}
                        setRecentQcData={setRecentQcData}
                        recentRows={recentRows}
                        alerts={alerts}
                        recentFilters={recentFilters}
                        setRecentFilters={setRecentFilters}
                        recentSortKey={recentSortKey}
                        recentSortDir={recentSortDir}
                        toggleRecentSort={toggleRecentSort}
                    />
                )}
                {currentTab === 'charts' && can.charts && (
                    <Charts
                        selectedBranch={selectedBranch}
                        selectedParameter={selectedParameter}
                        parameters={parameters}
                        chartData={chartData as any}
                        targetValues={targetValues}
                        observedStats={observedStats as any}
                        setSelectedParameter={setSelectedParameter}
                    />
                )}
                {currentTab === 'alerts' && can.alerts && (
                    <AlertsView
                        alerts={alerts}
                        alertRows={alertRows}
                        alertFilters={alertFilters}
                        setAlertFilters={setAlertFilters}
                        toggleAlertSort={toggleAlertSort}
                        branches={branches}
                        acknowledgeAlert={acknowledgeAlert}
                    />
                )}
                {currentTab === 'targets' && can.targets && (
                    <TargetsView
                        targetRows={targetRows}
                        targetFilters={targetFilters}
                        setTargetFilters={setTargetFilters}
                        toggleTargetSort={toggleTargetSort}
                        setShowTargetModal={setShowTargetModal}
                        setEditingTarget={setEditingTarget}
                        setTargetForm={setTargetForm}
                    />
                )}
                {currentTab === 'reports' && can.reports && (
                    <ReportsView
                        selectedBranch={selectedBranch}
                        branchName={branchName}
                        allParameterIdsForBranch={allParameterIdsForBranch}
                        parameters={parameters}
                        dateRange={dateRange}
                        narrativeText={narrativeText}
                        setNarrativeText={setNarrativeText}
                        preparedBy={preparedBy}
                        setPreparedBy={setPreparedBy}
                        reviewedBy={reviewedBy}
                        setReviewedBy={setReviewedBy}
                        allReportStats={allReportStats}
                        reportAlerts={reportAlerts}
                        recentProcessed={recentProcessed}
                        exporting={exporting}
                        setExporting={setExporting}
                        gdocExporting={gdocExporting}
                        setGdocExporting={setGdocExporting}
                        googleReady={googleReady}
                        labDetails={labDetails}
                    />
                )}
                {currentTab === 'admin' && isAdmin && (
                    <AdminView
                        branches={branches}
                        branchName={branchName}
                        branchCreateName={branchCreateName}
                        setBranchCreateName={setBranchCreateName}
                        handleBranchCreate={handleBranchCreate}
                        branchEdit={branchEdit}
                        setBranchEdit={setBranchEdit}
                        handleBranchUpdate={handleBranchUpdate}
                        handleBranchDelete={handleBranchDelete}
                        technicians={technicians}
                        techLoading={techLoading}
                        techCreate={techCreate}
                        setTechCreate={setTechCreate}
                        handleTechCreate={handleTechCreate}
                        techEdit={techEdit}
                        setTechEdit={setTechEdit}
                        handleTechUpdate={handleTechUpdate}
                        handleTechDelete={handleTechDelete}
                        pwReset={pwReset}
                        setPwReset={setPwReset}
                        handlePwReset={handlePwReset}
                        adminMessage={adminMessage || ''}
                        parameters={parameters}
                        refreshParameters={refreshParameters}
                        setAdminMessage={setAdminMessage}
                    />
                )}
            </div>
            {/* Target Modal */}
            {showTargetModal && (
                <TargetModal
                    editingTarget={editingTarget}
                    targetForm={targetForm}
                    setTargetForm={setTargetForm}
                    branches={branches}
                    parameters={parameters}
                    handleTargetSubmit={handleTargetSubmit}
                    setShowTargetModal={setShowTargetModal}
                    setEditingTarget={setEditingTarget}
                />
            )}
            {/* Delete Confirmation Modal */}
            <DeleteConfirmationModal
                isOpen={deleteModal.isOpen}
                title={deleteModal.type === 'branch' ? 'Delete Branch' : 'Delete Technician'}
                message={deleteModal.type === 'branch'
                    ? 'Are you sure you want to delete this branch? This action cannot be undone.'
                    : 'Are you sure you want to delete this technician? This action cannot be undone.'}
                itemName={deleteModal.item?.name || ''}
                cascadeOptions={deleteModal.cascadeOptions}
                onConfirm={confirmDelete}
                onCancel={cancelDelete}
                isDeleting={deleteModal.isDeleting}
            />
        </div>
    )
}
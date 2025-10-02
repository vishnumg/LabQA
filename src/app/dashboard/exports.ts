// Export functionality for QC reports (CSV and Google Docs)

import type { Branch, Parameter, ReportStats, Alert, DateRange, LabDetails } from './types'
import { formatDateDisplay, formatDateTimeDisplay } from './utils'
import { startGoogleOAuth, ensureGoogleAccessToken } from '../../lib/googleAuth'

/**
 * Export QC report as CSV file
 */
export const exportReportCSV = (params: {
    labDetails: LabDetails
    branchName: string
    allParameterIdsForBranch: string[]
    parameters: Parameter[]
    dateRange: DateRange
    narrativeText: string
    allReportStats: ReportStats[]
}) => {
    const { labDetails, branchName, allParameterIdsForBranch, parameters, dateRange, narrativeText, allReportStats } = params

    const meta = [
        `Lab Name:,"${labDetails.name}"`,
        `Branch:,"${branchName.replace(/"/g, '""')}"`,
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
        const line = [
            paramName,
            r.level,
            r.n,
            r.mean.toFixed(3),
            r.sd.toFixed(3),
            r.cv?.toFixed(1) || '',
            r.rules['1₂s'],
            r.rules['1₃s'],
            r.rules['2₂s'],
            r.rules['R₄s'],
            r.rules['4₁s'],
            r.rules['10ₓ']
        ]
        lines.push(line.join(','))
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url

    const safeBranchSlug = branchName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'branch'
    const fileStartDate = formatDateDisplay(dateRange.start).replace(/\//g, '-')
    const fileEndDate = formatDateDisplay(dateRange.end).replace(/\//g, '-')

    a.download = `qc_report_${safeBranchSlug}_${fileStartDate}_${fileEndDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

/**
 * Rasterize chart images for Google Docs export
 */
const rasterizeCharts = async (params: {
    parameters: Parameter[]
}): Promise<Array<{ parameterId: string; name: string; pngBase64: string }>> => {
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

    // Wait for layout + React commit + Recharts render
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    for (let i = 0; i < 5; i++) {
        await wait(80)
    }

    // Dynamically import html2canvas
    // @ts-ignore
    const mod = await import('html2canvas').catch(() => null)
    const html2canvas = mod?.default

    const origAnim = document.documentElement.style.animation
    const origTrans = document.documentElement.style.transition
    document.documentElement.style.animation = 'none'
    document.documentElement.style.transition = 'none'

    const paramName = (pid: string) => params.parameters.find(p => p.id === pid)?.name || pid

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
                        const canvas = await html2canvas(container, {
                            backgroundColor: '#ffffff',
                            scale: 1,
                            useCORS: true
                        })
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
                const canvas = await html2canvas(chartsSection, {
                    backgroundColor: '#ffffff',
                    scale: 1,
                    useCORS: true
                })
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
        try {
            document.head.removeChild(paletteStyle)
        } catch { }
    }

    return captures
}

/**
 * Export QC report to Google Docs
 */
export const exportGoogleDoc = async (params: {
    branchName: string
    dateRange: DateRange
    narrativeText: string
    allParameterIdsForBranch: string[]
    parameters: Parameter[]
    recentProcessed: Array<{ branch: string; parameter: string; level: string; date: string; value: number }>
    selectedBranch: string
    reportAlerts: Alert[]
    setGdocExporting: (val: boolean) => void
}) => {
    const {
        branchName,
        dateRange,
        narrativeText,
        allParameterIdsForBranch,
        parameters,
        recentProcessed,
        selectedBranch,
        reportAlerts,
        setGdocExporting
    } = params

    setGdocExporting(true)
    try {
        const apiBase = process.env.NEXT_PUBLIC_API_BASE || ''
        let accessToken = await ensureGoogleAccessToken(apiBase)

        if (!accessToken) {
            await startGoogleOAuth(apiBase)
            const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
            for (let i = 0; i < 60; i++) {
                await wait(500)
                accessToken = await ensureGoogleAccessToken(apiBase)
                if (accessToken) break
            }
        }

        if (!accessToken) throw new Error('Authorization required – Google OAuth not completed')

        const chartImages = await rasterizeCharts({ parameters })

        // Build parameter stats payload
        const payloadParameters = allParameterIdsForBranch.map(pid => {
            const pname = parameters.find(p => p.id === pid)?.name || pid
            return (['L1', 'L2', 'L3'] as const).map(level => {
                const rows = recentProcessed.filter(q =>
                    q.branch === selectedBranch &&
                    q.parameter === pid &&
                    q.level === level &&
                    q.date >= dateRange.start &&
                    q.date <= dateRange.end
                )
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
            branchName,
            period: { from: dateRange.start, to: dateRange.end },
            narrative: narrativeText,
            parameters: payloadParameters,
            chartImages,
            ruleViolations,
            format: 'gdoc'
        }

        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
        const targetUrl = `${apiBase || ''}/api/report/export`.replace(/([^:])\/\//g, '$1/')
        const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                'X-Google-Access-Token': accessToken
            },
            body: JSON.stringify(body)
        })

        if (!res.ok) {
            let msg = 'Google Doc export failed'
            try {
                const j = await res.json()
                msg = j.detail || j.error || msg
            } catch { }
            throw new Error(msg)
        }

        const j = await res.json()
        if (j.url) {
            window.open(j.url, '_blank')
        } else {
            alert('Export succeeded but no document URL returned')
        }
    } catch (e: any) {
        alert(e.message || 'Google Doc export failed')
    } finally {
        setGdocExporting(false)
    }
}

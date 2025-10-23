import { useMemo } from 'react'
import type { QcEntry, Alert, Parameter, TargetVersion } from '../types'
import { calculateZ, evaluateRules, calculateObservedStats } from '../utils'

type TargetVersionsMap = Record<string, TargetVersion[]>

export function useDerivedData(
    qcData: QcEntry[],
    recentQcData: QcEntry[],
    targetVersions: TargetVersionsMap,
    selectedBranch: string,
    selectedParameter: string,
    dateRange: { start: string; end: string },
    parameters: Array<{ id: string; name: string; unit?: string }>,
    recentFilters: Record<string, string>,
    recentSortKey: string,
    recentSortDir: 'asc' | 'desc',
    alertFilters: Record<string, string>,
    alertSortKey: string,
    alertSortDir: 'asc' | 'desc',
    recentPage: number = 1,
    recentPageSize: number = 20
) {
    // Process QC data with Z-scores
    const processed = useMemo(() => {
        return qcData.map(e => ({
            ...e,
            zScore: calculateZ(e.value, e.parameter, e.level, e.branch, e.date, targetVersions)
        }))
    }, [qcData, targetVersions])

    // Process recent QC data
    const recentProcessed = useMemo(() => {
        return recentQcData.map(e => ({
            ...e,
            zScore: calculateZ(e.value, e.parameter, e.level, e.branch, e.date, targetVersions)
        }))
    }, [recentQcData, targetVersions])

    // Generate alerts from processed data
    const alerts = useMemo(() => {
        return evaluateRules(processed)
    }, [processed])

    // Filter data for selected branch/parameter/date range
    const filtered = useMemo(() => {
        const s = new Date(dateRange.start).getTime()
        const e = new Date(dateRange.end).getTime()
        return processed.filter(x =>
            x.branch === selectedBranch &&
            x.parameter === selectedParameter &&
            new Date(x.date).getTime() >= s &&
            new Date(x.date).getTime() <= e
        )
    }, [processed, selectedBranch, selectedParameter, dateRange])

    // Calculate observed statistics
    const observedStats = useMemo(() => calculateObservedStats(filtered), [filtered])

    // Chart data
    const chartData = useMemo(() => {
        const data: Record<'L1' | 'L2' | 'L3', any[]> = { L1: [], L2: [], L3: [] }
            ; (['L1', 'L2', 'L3'] as const).forEach(level => {
                data[level] = filtered
                    .filter(d => d.level === level)
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map(d => ({
                        date: d.date,
                        zScore: d.zScore,
                        value: d.value,
                        hasAlert: alerts.some(a =>
                            a.date === d.date &&
                            a.level === d.level &&
                            a.parameter === d.parameter &&
                            a.branch === d.branch
                        )
                    }))
            })
        return data
    }, [filtered, alerts])

    // Recent entries table rows (filtered and sorted with pagination)
    const recentRows = useMemo(() => {
        const allRows = [...recentProcessed]
            .filter(r => {
                const status = alerts.some(a =>
                    a.date === r.date &&
                    a.level === r.level &&
                    a.parameter === r.parameter &&
                    a.branch === r.branch
                ) ? 'alert' : 'ok'
                const m: Record<string, string> = {
                    date: r.date,
                    parameter: r.parameter,
                    level: r.level,
                    value: String(r.value),
                    zScore: r.zScore == null ? '' : r.zScore.toFixed(2),
                    status
                }
                return Object.entries(recentFilters).every(([k, v]) =>
                    (v || '').trim() === '' ||
                    (m[k] || '').toLowerCase().includes(v.toLowerCase().trim())
                )
            })
            .sort((a, b) => {
                const get = (r: any) => {
                    if (recentSortKey === 'status') {
                        return alerts.some(x =>
                            x.date === r.date &&
                            x.level === r.level &&
                            x.parameter === r.parameter &&
                            x.branch === r.branch
                        ) ? 'alert' : 'ok'
                    }
                    if (recentSortKey === 'value') return r.value
                    if (recentSortKey === 'zScore') return r.zScore ?? -Infinity
                    return r[recentSortKey]
                }
                const va = get(a), vb = get(b)
                if (va == null && vb == null) return 0
                if (va == null) return recentSortDir === 'asc' ? -1 : 1
                if (vb == null) return recentSortDir === 'asc' ? 1 : -1
                if (typeof va === 'number' && typeof vb === 'number') {
                    return recentSortDir === 'asc' ? va - vb : vb - va
                }
                return recentSortDir === 'asc'
                    ? String(va).localeCompare(String(vb))
                    : String(vb).localeCompare(String(va))
            })

        const startIndex = (recentPage - 1) * recentPageSize
        const endIndex = startIndex + recentPageSize
        return {
            rows: allRows.slice(startIndex, endIndex),
            total: allRows.length,
            page: recentPage,
            pageSize: recentPageSize,
            totalPages: Math.ceil(allRows.length / recentPageSize)
        }
    }, [recentProcessed, alerts, recentFilters, recentSortKey, recentSortDir, recentPage, recentPageSize])

    // Alert table rows (filtered and sorted)
    const alertRows = useMemo(() => {
        return alerts
            .filter(a => {
                const m: Record<string, string> = {
                    date: a.date,
                    branch: a.branch,
                    parameter: a.parameter,
                    level: a.level,
                    rule: a.rule,
                    description: a.description,
                    severity: a.severity,
                    acknowledged: a.acknowledged ? 'yes' : 'no'
                }
                return Object.entries(alertFilters).every(([k, v]) =>
                    (v || '').trim() === '' ||
                    (m[k] || '').toLowerCase().includes(v.toLowerCase().trim())
                )
            })
            .sort((a: any, b: any) => {
                const get = (r: any) => r[alertSortKey]
                const va = get(a), vb = get(b)
                if (typeof va === 'number' && typeof vb === 'number') {
                    return alertSortDir === 'asc' ? va - vb : vb - va
                }
                return alertSortDir === 'asc'
                    ? String(va).localeCompare(String(vb))
                    : String(vb).localeCompare(String(va))
            })
    }, [alerts, alertFilters, alertSortKey, alertSortDir])

    // Report data computations
    const allParameterIdsForBranch = useMemo(() => {
        const setP = new Set<string>()
        recentProcessed
            .filter(r =>
                r.branch === selectedBranch &&
                new Date(r.date) >= new Date(dateRange.start) &&
                new Date(r.date) <= new Date(dateRange.end)
            )
            .forEach(r => setP.add(r.parameter))
        return Array.from(setP).sort()
    }, [recentProcessed, selectedBranch, dateRange.start, dateRange.end])

    const reportAlerts = useMemo(() => {
        const branchRows = recentProcessed.filter(r =>
            r.branch === selectedBranch &&
            new Date(r.date) >= new Date(dateRange.start) &&
            new Date(r.date) <= new Date(dateRange.end)
        )
        return evaluateRules(branchRows)
    }, [recentProcessed, selectedBranch, dateRange.start, dateRange.end])

    const allReportStats = useMemo(() => {
        const stats: Array<{
            parameter: string
            level: string
            n: number
            mean: number
            sd: number
            cv: number | null
            rules: Record<string, number>
        }> = []
        const branchRows = recentProcessed.filter(r =>
            r.branch === selectedBranch &&
            new Date(r.date) >= new Date(dateRange.start) &&
            new Date(r.date) <= new Date(dateRange.end)
        )
        const paramIds = Array.from(new Set(branchRows.map(r => r.parameter)))
        paramIds.forEach(pid => {
            ; (['L1', 'L2', 'L3'] as const).forEach(level => {
                const rows = branchRows.filter(r => r.parameter === pid && r.level === level)
                if (!rows.length) return
                const values = rows.map(r => r.value)
                const n = values.length
                const mean = values.reduce((a, b) => a + b, 0) / n
                const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, n - 1)
                const sd = Math.sqrt(variance)
                const cv = mean !== 0 ? (sd / mean) * 100 : null
                const rules = { '1₂s': 0, '1₃s': 0, '2₂s': 0, 'R₄s': 0, '4₁s': 0, '10ₓ': 0 }
                rows.forEach(r => {
                    const z = r.zScore
                    if (z != null) {
                        if (Math.abs(z) > 3) rules['1₃s']++
                        else if (Math.abs(z) > 2) rules['1₂s']++
                    }
                })
                stats.push({ parameter: pid, level, n, mean, sd, cv, rules })
            })
        })
        return stats
    }, [recentProcessed, selectedBranch, dateRange.start, dateRange.end])

    return {
        processed,
        recentProcessed,
        alerts,
        filtered,
        observedStats,
        chartData,
        recentRows,
        alertRows,
        allParameterIdsForBranch,
        reportAlerts,
        allReportStats
    }
}

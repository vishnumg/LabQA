// Custom hooks for data fetching and management

import { useState, useEffect } from 'react'
import { api } from '../../../lib/api'
import type { Branch, Parameter, TargetVersionsMap, TargetMap, QcEntry, DateRange, Technician } from '../types'
import { getEffectiveTargetMap } from '../utils'

/**
 * Hook to fetch and manage branches
 */
export const useBranches = (ready: boolean, claims: any) => {
    const [branches, setBranches] = useState<Branch[]>([])

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!ready || !claims) return
            const b = await api.getBranches()
            if (cancelled) return
            if (b.ok && Array.isArray(b.json?.items)) {
                setBranches(b.json.items)
            }
        }
        load()
        return () => { cancelled = true }
    }, [ready, claims])

    return branches
}

/**
 * Hook to fetch and manage parameters
 */
export const useParameters = (ready: boolean, claims: any) => {
    const [parameters, setParameters] = useState<Parameter[]>([])

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!ready || !claims) return
            const p = await api.getParameters()
            if (cancelled) return
            if (p.ok && Array.isArray(p.json?.items)) {
                setParameters(p.json.items)
            }
        }
        load()
        return () => { cancelled = true }
    }, [ready, claims])

    return parameters
}

/**
 * Hook to fetch and manage target values
 */
export const useTargets = (ready: boolean, claims: any, dateRange: DateRange) => {
    const [targetVersions, setTargetVersions] = useState<TargetVersionsMap>({})
    const [targetValues, setTargetValues] = useState<TargetMap>({})

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!ready || !claims) return
            const t = await api.getTargets()
            if (cancelled) return

            if (t.ok && Array.isArray(t.json?.items)) {
                const versions: TargetVersionsMap = {}
                t.json.items.forEach((it: any) => {
                    const key = `${it.branch_id}_${it.parameter_id}_${it.level}`
                    if (!versions[key]) versions[key] = []
                    versions[key].push({
                        mean: it.mean,
                        sd: it.sd,
                        validFrom: it.validFrom
                    })
                })

                // Sort versions by validFrom date
                Object.keys(versions).forEach(k =>
                    versions[k].sort((a, b) => a.validFrom.localeCompare(b.validFrom))
                )

                setTargetVersions(versions)
            }
        }
        load()
        return () => { cancelled = true }
    }, [ready, claims])

    // Update effective target values when date range changes
    useEffect(() => {
        if (Object.keys(targetVersions).length > 0) {
            const eff = getEffectiveTargetMap(targetVersions, dateRange.end)
            setTargetValues(eff)
        }
    }, [targetVersions, dateRange.end])

    return { targetVersions, targetValues, setTargetVersions, setTargetValues }
}

/**
 * Hook to fetch QC data for a specific parameter
 */
export const useQcData = (
    ready: boolean,
    claims: any,
    selectedBranch: string,
    selectedParameter: string,
    dateRange: DateRange,
    isTech: boolean,
    userBranch?: string | null
) => {
    const [qcData, setQcData] = useState<QcEntry[]>([])

    useEffect(() => {
        let cancelled = false
        const loadQc = async () => {
            if (!ready || !claims) return
            if (!selectedBranch || !selectedParameter) return

            const branchId = isTech && userBranch ? userBranch : selectedBranch
            const r = await api.listQc({
                branch_id: branchId,
                parameter_id: selectedParameter,
                start: dateRange.start,
                end: dateRange.end
            })

            if (cancelled) return
            if (r.ok && Array.isArray(r.json?.items)) {
                setQcData(r.json.items as any)
            } else {
                setQcData([])
            }
        }
        loadQc()
        return () => { cancelled = true }
    }, [ready, claims, selectedBranch, selectedParameter, dateRange.start, dateRange.end, isTech, userBranch])

    return { qcData, setQcData }
}

/**
 * Hook to fetch recent QC data for all parameters in a branch
 */
export const useRecentQcData = (
    ready: boolean,
    claims: any,
    selectedBranch: string,
    dateRange: DateRange,
    isTech: boolean,
    userBranch?: string | null
) => {
    const [recentQcData, setRecentQcData] = useState<QcEntry[]>([])

    useEffect(() => {
        let cancelled = false
        const loadRecent = async () => {
            if (!ready || !claims) return

            const branchId = isTech && userBranch ? userBranch : selectedBranch
            if (!branchId) return

            const r = await api.listQc({
                branch_id: branchId,
                start: dateRange.start,
                end: dateRange.end
            })

            if (cancelled) return
            if (r.ok && Array.isArray(r.json?.items)) {
                setRecentQcData(r.json.items as any)
            } else {
                setRecentQcData([])
            }
        }
        loadRecent()
        return () => { cancelled = true }
    }, [ready, claims, selectedBranch, dateRange.start, dateRange.end, isTech, userBranch])

    return { recentQcData, setRecentQcData }
}

/**
 * Hook to fetch technicians (admin only)
 */
export const useTechnicians = (isAdmin: boolean, currentTab: string) => {
    const [technicians, setTechnicians] = useState<Technician[]>([])
    const [techLoading, setTechLoading] = useState(false)

    useEffect(() => {
        if (!isAdmin) return
        if (currentTab !== 'admin') return

        let cancelled = false
        const loadTechs = async () => {
            setTechLoading(true)
            const r = await api.adminListTechnicians()
            if (!cancelled) {
                if (r.ok && Array.isArray(r.json?.items)) {
                    setTechnicians(r.json.items)
                }
                setTechLoading(false)
            }
        }
        loadTechs()
        return () => { cancelled = true }
    }, [currentTab, isAdmin])

    return { technicians, setTechnicians, techLoading }
}

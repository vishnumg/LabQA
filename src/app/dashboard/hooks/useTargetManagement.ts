import { useState, useEffect, useMemo } from 'react'
import { api } from '../../../lib/api'
import { makeTargetKey, parseTargetKey } from '../targetKeyHelpers'
import type { TargetVersion, Parameter, Branch } from '../types'

type TargetVersionsMap = Record<string, TargetVersion[]>
type TargetMap = Record<string, { mean: number; sd: number; validFrom: string }>

interface TargetRow {
    key: string
    branchName: string
    branchId: string
    parameterName: string
    parameterId: string
    level: string
    mean: number
    sd: number
    validFrom: string
}

export const useTargetManagement = (
    ready: boolean,
    claims: any,
    dateRangeEnd: string,
    branches: Branch[],
    parameters: Parameter[]
) => {
    const [targetVersions, setTargetVersions] = useState<TargetVersionsMap>({})
    const [targetValues, setTargetValues] = useState<TargetMap>({})
    const [showTargetModal, setShowTargetModal] = useState(false)
    const [editingTarget, setEditingTarget] = useState<string | null>(null)
    const [targetForm, setTargetForm] = useState({
        parameter: '',
        level: 'L1' as 'L1' | 'L2' | 'L3',
        branch: '',
        mean: '',
        sd: '',
        validFrom: new Date().toISOString().split('T')[0]
    })

    // Table filtering and sorting
    const [targetSortKey, setTargetSortKey] = useState<string>('branch')
    const [targetSortDir, setTargetSortDir] = useState<'asc' | 'desc'>('asc')
    const [targetFilters, setTargetFilters] = useState<Record<string, string>>({
        branch: '', parameter: '', level: '', mean: '', sd: '', validFrom: ''
    })

    // Initial load of targets
    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!ready || !claims) return
            const t = await api.getTargets()
            if (cancelled) return
            if (t.ok && Array.isArray(t.json?.items)) {
                const versions: TargetVersionsMap = {}
                t.json.items.forEach((it: any) => {
                    const key = makeTargetKey(it.branch_id, it.parameter_id, it.level)
                    if (!versions[key]) versions[key] = []
                    versions[key].push({ mean: it.mean, sd: it.sd, validFrom: it.validFrom })
                })
                Object.keys(versions).forEach(k => versions[k].sort((a, b) => a.validFrom.localeCompare(b.validFrom)))
                setTargetVersions(versions)
            }
        }
        load()
        return () => { cancelled = true }
    }, [ready, claims])

    // Update effective target values when date range changes
    useEffect(() => {
        const eff: TargetMap = {}
        Object.entries(targetVersions).forEach(([k, arr]) => {
            if (!arr.length) return
            let chosen = arr[0]
            for (const v of arr) {
                if (v.validFrom <= dateRangeEnd) chosen = v
                else break
            }
            eff[k] = chosen
        })
        setTargetValues(eff)
    }, [dateRangeEnd, targetVersions])

    // Refresh targets (for use after edit/delete operations)
    const refreshTargets = async () => {
        const t = await api.getTargets()
        if (t.ok && Array.isArray(t.json?.items)) {
            const versions: TargetVersionsMap = {}
            t.json.items.forEach((it: any) => {
                const key = makeTargetKey(it.branch_id, it.parameter_id, it.level)
                if (!versions[key]) versions[key] = []
                versions[key].push({ mean: it.mean, sd: it.sd, validFrom: it.validFrom })
            })
            Object.keys(versions).forEach(k => versions[k].sort((a, b) => a.validFrom.localeCompare(b.validFrom)))
            setTargetVersions(versions)
            const eff: TargetMap = {}
            Object.entries(versions).forEach(([k, arr]) => {
                let chosen = arr[0]
                for (const v of arr) {
                    if (v.validFrom <= dateRangeEnd) chosen = v
                    else break
                }
                eff[k] = chosen
            })
            setTargetValues(eff)
        }
    }

    // Target submission handler
    const handleTargetSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const body = {
            branch_id: targetForm.branch,
            parameter_id: targetForm.parameter,
            level: targetForm.level,
            mean: parseFloat(targetForm.mean),
            sd: parseFloat(targetForm.sd),
            validFrom: targetForm.validFrom
        }
        const res = await api.upsertTarget(body)
        if (res.ok) {
            await refreshTargets()
            setShowTargetModal(false)
            setEditingTarget(null)
        }
    }

    // Toggle sort direction or change sort key
    const toggleTargetSort = (key: string) => {
        if (targetSortKey === key) {
            setTargetSortDir(targetSortDir === 'asc' ? 'desc' : 'asc')
        } else {
            setTargetSortKey(key)
            setTargetSortDir('asc')
        }
    }

    // Compute target rows (all versions, not just latest)
    const targetRows = useMemo(() => {
        const rows: TargetRow[] = []
        Object.entries(targetVersions).forEach(([key, versions]) => {
            const { branchId, parameterId, level } = parseTargetKey(key)
            const branch = branches.find(b => b.id === branchId)
            const parameter = parameters.find(p => p.id === parameterId)
            // Create a row for EACH version
            versions.forEach((version) => {
                rows.push({
                    key: `${key}_${version.validFrom}`,
                    branchName: branch?.name || branchId,
                    branchId,
                    parameterName: parameter?.name || parameterId,
                    parameterId,
                    level,
                    mean: version.mean,
                    sd: version.sd,
                    validFrom: version.validFrom
                })
            })
        })
        return rows
            .filter(r => {
                const m: Record<string, string> = {
                    branch: r.branchName,
                    parameter: r.parameterName,
                    level: r.level,
                    mean: String(r.mean),
                    sd: String(r.sd),
                    validFrom: r.validFrom
                }
                return Object.entries(targetFilters).every(([k, v]) =>
                    (v || '').trim() === '' || (m[k] || '').toLowerCase().includes(v.toLowerCase().trim())
                )
            })
            .sort((a, b) => {
                const get = (r: any) => {
                    if (targetSortKey === 'branch') return r.branchName
                    if (targetSortKey === 'parameter') return r.parameterName
                    return r[targetSortKey]
                }
                const va = get(a), vb = get(b)
                if (typeof va === 'number' && typeof vb === 'number') {
                    return targetSortDir === 'asc' ? va - vb : vb - va
                }
                return targetSortDir === 'asc'
                    ? String(va).localeCompare(String(vb))
                    : String(vb).localeCompare(String(va))
            })
    }, [targetVersions, branches, parameters, targetFilters, targetSortKey, targetSortDir])

    return {
        targetVersions,
        targetValues,
        targetRows,
        targetFilters,
        setTargetFilters,
        targetSortKey,
        targetSortDir,
        toggleTargetSort,
        showTargetModal,
        setShowTargetModal,
        editingTarget,
        setEditingTarget,
        targetForm,
        setTargetForm,
        handleTargetSubmit,
        refreshTargets
    }
}

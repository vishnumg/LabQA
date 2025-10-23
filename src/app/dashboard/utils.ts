// Utility functions for the Medical Lab QA Dashboard

import type { QcEntry, TargetVersion, TargetVersionsMap, Alert, TargetMap, ObservedStats } from './types'
import { makeTargetKey } from './targetKeyHelpers'

/**
 * Format date from yyyy-MM-dd to dd/MM/yyyy for display
 */
export const formatDateDisplay = (isoDate: string): string => {
    const [y, m, d] = isoDate.split('-')
    return `${d}/${m}/${y}`
}

/**
 * Format ISO datetime to dd/MM/yyyy HH:mm
 */
export const formatDateTimeDisplay = (isoDateTime: string): string => {
    const date = new Date(isoDateTime)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${day}/${month}/${year} ${hours}:${minutes}`
}

/**
 * Get the effective target for a given date (finds the most recent target <= date)
 */
export const effectiveTarget = (
    targetVersions: TargetVersionsMap,
    branch: string,
    parameter: string,
    level: string,
    onDate: string
): TargetVersion | null => {
    const key = makeTargetKey(branch, parameter, level)
    const versions = targetVersions[key]
    if (!versions || !versions.length) return null
    let chosen: TargetVersion | null = null
    for (const v of versions) {
        if (v.validFrom <= onDate) chosen = v
        else break
    }
    return chosen || versions[0]
}

/**
 * Calculate Z-score for a QC value
 */
export const calculateZ = (
    value: number,
    parameter: string,
    level: string,
    branch: string,
    date: string,
    targetVersions: TargetVersionsMap
): number | null => {
    const t = effectiveTarget(targetVersions, branch, parameter, level, date)
    if (!t || !t.mean || !t.sd) return null
    return (value - t.mean) / t.sd
}

/**
 * Evaluate Westgard rules and generate alerts
 */
export const evaluateRules = (data: QcEntry[]): Alert[] => {
    const newAlerts: Alert[] = []
    const sorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    sorted.forEach((e, idx) => {
        const z = e.zScore
        if (z == null) return

        // 1₃s rule
        if (Math.abs(z) > 3) {
            newAlerts.push({
                id: `${e.id}_1_3s`,
                date: e.date,
                parameter: e.parameter,
                branch: e.branch,
                level: e.level,
                rule: '1₃s',
                severity: 'error',
                description: `Single result exceeds ±3SD (Z=${z.toFixed(2)})`,
                acknowledged: false
            })
        }
        // 1₂s rule
        else if (Math.abs(z) > 2) {
            newAlerts.push({
                id: `${e.id}_1_2s`,
                date: e.date,
                parameter: e.parameter,
                branch: e.branch,
                level: e.level,
                rule: '1₂s',
                severity: 'warning',
                description: `Single result exceeds ±2SD (Z=${z.toFixed(2)})`,
                acknowledged: false
            })
        }

        // Check consecutive point rules
        if (idx > 0) {
            const p = sorted[idx - 1]
            if (p.parameter === e.parameter && p.level === e.level && p.branch === e.branch && p.zScore != null) {
                // 2₂s rule
                if (Math.abs(z) > 2 && Math.abs(p.zScore) > 2 && Math.sign(z) === Math.sign(p.zScore)) {
                    newAlerts.push({
                        id: `${e.id}_2_2s`,
                        date: e.date,
                        parameter: e.parameter,
                        branch: e.branch,
                        level: e.level,
                        rule: '2₂s',
                        severity: 'error',
                        description: `Two consecutive results exceed ±2SD on same side`,
                        acknowledged: false
                    })
                }
                // R₄s rule
                if (Math.abs(z - p.zScore) >= 4) {
                    newAlerts.push({
                        id: `${e.id}_R_4s`,
                        date: e.date,
                        parameter: e.parameter,
                        branch: e.branch,
                        level: e.level,
                        rule: 'R₄s',
                        severity: 'error',
                        description: `Range between consecutive results ≥4SD`,
                        acknowledged: false
                    })
                }
            }
        }

        // 4₁s rule
        if (idx >= 3) {
            const r4 = sorted.slice(idx - 3, idx + 1)
            if (r4.every(r =>
                r.parameter === e.parameter &&
                r.level === e.level &&
                r.branch === e.branch &&
                r.zScore != null &&
                Math.abs(r.zScore) > 1 &&
                Math.sign(r.zScore) === Math.sign(z)
            )) {
                newAlerts.push({
                    id: `${e.id}_4_1s`,
                    date: e.date,
                    parameter: e.parameter,
                    branch: e.branch,
                    level: e.level,
                    rule: '4₁s',
                    severity: 'error',
                    description: `Four consecutive results exceed ±1SD on same side`,
                    acknowledged: false
                })
            }
        }

        // 10ₓ rule
        if (idx >= 9) {
            const r10 = sorted.slice(idx - 9, idx + 1)
            if (r10.every(r =>
                r.parameter === e.parameter &&
                r.level === e.level &&
                r.branch === e.branch &&
                r.zScore != null &&
                Math.sign(r.zScore) === Math.sign(z)
            )) {
                newAlerts.push({
                    id: `${e.id}_10_x`,
                    date: e.date,
                    parameter: e.parameter,
                    branch: e.branch,
                    level: e.level,
                    rule: '10ₓ',
                    severity: 'error',
                    description: `Ten consecutive results on same side of mean`,
                    acknowledged: false
                })
            }
        }
    })

    return newAlerts
}

/**
 * Calculate observed statistics for filtered data
 */
export const calculateObservedStats = (filtered: QcEntry[]): ObservedStats => {
    const stats: ObservedStats = {
        L1: { n: 0, mean: 0, sd: 0, cv: 0 },
        L2: { n: 0, mean: 0, sd: 0, cv: 0 },
        L3: { n: 0, mean: 0, sd: 0, cv: 0 }
    }

        ; (['L1', 'L2', 'L3'] as const).forEach(level => {
            const vals = filtered.filter(e => e.level === level).map(e => e.value)
            if (vals.length) {
                const mean = vals.reduce((a, b) => a + b, 0) / vals.length
                const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length
                const sd = Math.sqrt(variance)
                stats[level] = { n: vals.length, mean, sd, cv: mean ? (sd / mean) * 100 : 0 }
            }
        })

    return stats
}

/**
 * Get effective target map for a specific end date
 */
export const getEffectiveTargetMap = (targetVersions: TargetVersionsMap, endDate: string): TargetMap => {
    const eff: TargetMap = {}
    Object.entries(targetVersions).forEach(([k, arr]) => {
        if (!arr.length) return
        let chosen = arr[0]
        for (const v of arr) {
            if (v.validFrom <= endDate) chosen = v
            else break
        }
        eff[k] = chosen
    })
    return eff
}

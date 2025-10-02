// Type definitions for the Medical Lab QA Dashboard

export type QcEntry = {
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

export type TargetVersion = {
    mean: number
    sd: number
    validFrom: string
}

export type TargetVersionsMap = Record<string, TargetVersion[]>

export type TargetMap = Record<string, TargetVersion>

export type Alert = {
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

export type Parameter = {
    id: string
    name: string
    unit?: string
}

export type Branch = {
    id: string
    name: string
}

export type Technician = {
    id: string
    email: string
    branch_id?: string | null
    created_at?: string
}

export type LabDetails = {
    name: string
    address: string
    contact: string
    accreditation: string
    instrument: string
}

export type EntryForm = {
    date: string
    parameter: string
    branch: string
    l1: string
    l2: string
    l3: string
}

export type TargetForm = {
    parameter: string
    level: 'L1' | 'L2' | 'L3'
    branch: string
    mean: string
    sd: string
    validFrom: string
}

export type DateRange = {
    start: string
    end: string
}

export type TabType = 'dataEntry' | 'charts' | 'alerts' | 'targets' | 'reports' | 'admin'

export type UserRole = 'admin' | 'tech' | 'viewer'

export type ObservedStats = Record<'L1' | 'L2' | 'L3', {
    n: number
    mean: number
    sd: number
    cv: number
}>

export type ChartData = Record<'L1' | 'L2' | 'L3', Array<{
    date: string
    value: number
    zScore: number | null
    alert?: boolean
}>>

export type ReportStats = {
    parameter: string
    level: string
    n: number
    mean: number
    sd: number
    cv: number | null
    rules: Record<string, number>
    zShift?: number
}

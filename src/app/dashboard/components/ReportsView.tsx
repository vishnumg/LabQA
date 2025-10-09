"use client"

import { useRef } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import type { Parameter, Alert, ReportStats, QcEntry, DateRange, LabDetails } from '../types'
import { formatDateDisplay, formatDateTimeDisplay } from '../utils'
import { exportReportCSV as exportCSV, exportGoogleDoc as exportGDoc } from '../exports'

interface ReportsViewProps {
    selectedBranch: string
    branchName: (branchId: string) => string
    allParameterIdsForBranch: string[]
    parameters: Parameter[]
    dateRange: DateRange
    narrativeText: string
    setNarrativeText: React.Dispatch<React.SetStateAction<string>>
    preparedBy: string
    setPreparedBy: React.Dispatch<React.SetStateAction<string>>
    reviewedBy: string
    setReviewedBy: React.Dispatch<React.SetStateAction<string>>
    allReportStats: ReportStats[]
    reportAlerts: Alert[]
    recentProcessed: Array<QcEntry & { zScore: number | null }>
    exporting: boolean
    setExporting: React.Dispatch<React.SetStateAction<boolean>>
    gdocExporting: boolean
    setGdocExporting: React.Dispatch<React.SetStateAction<boolean>>
    googleReady: boolean
    labDetails: LabDetails
}

export default function ReportsView({
    selectedBranch,
    branchName,
    allParameterIdsForBranch,
    parameters,
    dateRange,
    narrativeText,
    setNarrativeText,
    preparedBy,
    setPreparedBy,
    reviewedBy,
    setReviewedBy,
    allReportStats,
    reportAlerts,
    recentProcessed,
    exporting,
    setExporting,
    gdocExporting,
    setGdocExporting,
    googleReady,
    labDetails
}: ReportsViewProps) {

    const reportRootRef = useRef<HTMLDivElement | null>(null)
    const narrativeRef = useRef<HTMLDivElement | null>(null)
    const frontMatterRef = useRef<HTMLDivElement | null>(null)
    const statsRef = useRef<HTMLDivElement | null>(null)
    const chartsRef = useRef<HTMLDivElement | null>(null)

    const exportReportCSV = () => {
        exportCSV({
            labDetails,
            branchName: branchName(selectedBranch),
            allParameterIdsForBranch,
            parameters,
            dateRange,
            narrativeText,
            allReportStats
        })
    }

    const exportGoogleDoc = async () => {
        if (gdocExporting) return
        await exportGDoc({
            branchName: branchName(selectedBranch),
            dateRange,
            narrativeText,
            allParameterIdsForBranch,
            parameters,
            recentProcessed,
            selectedBranch,
            reportAlerts,
            setGdocExporting,
            preparedBy,
            reviewedBy
        })
    }

    return (
        <div className="space-y-8" ref={reportRootRef} data-report-root>
            {/* Description */}
            <div className="bg-white shadow rounded-lg p-4 text-sm" ref={narrativeRef} data-report-section="narrative">
                <h3 className="font-semibold mb-2">Description</h3>
                <textarea
                    value={narrativeText}
                    onChange={e => setNarrativeText(e.target.value)}
                    rows={6}
                    className="w-full border rounded p-2 text-xs focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter description to include in export."
                />
            </div>

            {/* Front Matter */}
            <div className="bg-white shadow rounded-lg p-4 text-sm grid md:grid-cols-2 gap-4" ref={frontMatterRef} data-report-section="front-matter">
                <div>
                    <div><span className="font-medium">Branch:</span> {branchName(selectedBranch)}</div>
                    <div><span className="font-medium">Parameters:</span> {allParameterIdsForBranch.length} ({allParameterIdsForBranch.map(pid => parameters.find(p => p.id === pid)?.name || pid).join(', ')})</div>
                    <div><span className="font-medium">Period:</span> {formatDateDisplay(dateRange.start)} → {formatDateDisplay(dateRange.end)}</div>
                    <div><span className="font-medium">Generated:</span> {formatDateTimeDisplay(new Date().toISOString())}</div>
                </div>
                <div className="flex flex-col gap-2 text-xs">
                    <label className="flex items-center gap-2">
                        <span className="font-medium w-20">Prepared By</span>
                        <input
                            value={preparedBy}
                            onChange={e => setPreparedBy(e.target.value)}
                            placeholder="Name"
                            className="flex-1 border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </label>
                    <label className="flex items-center gap-2">
                        <span className="font-medium w-20">Reviewed By</span>
                        <input
                            value={reviewedBy}
                            onChange={e => setReviewedBy(e.target.value)}
                            placeholder="Name"
                            className="flex-1 border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </label>
                    <div><span className="font-medium">Version:</span> {dateRange.start.slice(0, 7)}</div>
                </div>
            </div>

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
                            {!allReportStats.length && (
                                <tr>
                                    <td colSpan={12} className="p-4 text-center text-gray-500">
                                        No statistics for selected period.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Westgard Rule Violations */}
            <div className="bg-white shadow rounded-lg p-4" data-report-section="rule-violations">
                <h3 className="font-semibold mb-3 text-sm">Westgard Rule Violations</h3>
                <div className="mb-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div className="bg-red-50 p-3 rounded border border-red-200">
                        <div className="font-medium text-red-800">Critical Violations</div>
                        <div className="text-2xl font-bold text-red-600">
                            {reportAlerts.filter(a => a.severity === 'error').length}
                        </div>
                    </div>
                    <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                        <div className="font-medium text-yellow-800">Warnings</div>
                        <div className="text-2xl font-bold text-yellow-600">
                            {reportAlerts.filter(a => a.severity === 'warning').length}
                        </div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <div className="font-medium text-blue-800">Total Violations</div>
                        <div className="text-2xl font-bold text-blue-600">
                            {reportAlerts.length}
                        </div>
                    </div>
                </div>
                {reportAlerts.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50">
                                <tr className="border-b">
                                    <th className="p-2 text-left">Date</th>
                                    <th className="p-2 text-left">Parameter</th>
                                    <th className="p-2 text-left">Level</th>
                                    <th className="p-2 text-left">Rule</th>
                                    <th className="p-2 text-left">Description</th>
                                    <th className="p-2 text-left">Severity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportAlerts.map(a => {
                                    const paramName = parameters.find(p => p.id === a.parameter)?.name || a.parameter
                                    return (
                                        <tr key={a.id} className="border-b hover:bg-gray-50">
                                            <td className="p-2">{formatDateDisplay(a.date)}</td>
                                            <td className="p-2 font-medium">{paramName}</td>
                                            <td className="p-2">{a.level}</td>
                                            <td className="p-2">
                                                <span className={`px-2 py-1 rounded font-medium ${a.rule === '1₂s'
                                                    ? 'bg-yellow-100 text-yellow-800'
                                                    : 'bg-red-100 text-red-800'
                                                    }`}>
                                                    {a.rule}
                                                </span>
                                            </td>
                                            <td className="p-2">{a.description}</td>
                                            <td className="p-2">
                                                <span className={`px-2 py-1 rounded text-xs font-medium ${a.severity === 'error'
                                                    ? 'bg-red-100 text-red-800'
                                                    : 'bg-yellow-100 text-yellow-800'
                                                    }`}>
                                                    {a.severity === 'error' ? 'Critical' : 'Warning'}
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center p-6 bg-green-50 rounded border border-green-200">
                        <div className="text-green-800 font-medium">✓ No Westgard Rule Violations</div>
                        <div className="text-green-600 text-xs mt-1">
                            All QC results are within acceptable limits for this period.
                        </div>
                    </div>
                )}
                <div className="mt-4 p-3 bg-gray-50 rounded text-xs">
                    <div className="font-medium mb-2">Rule Reference:</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div><span className="font-medium">1₂s:</span> Single result exceeds ±2SD (Warning)</div>
                        <div><span className="font-medium">1₃s:</span> Single result exceeds ±3SD (Critical)</div>
                        <div><span className="font-medium">2₂s:</span> 2 consecutive results exceed ±2SD same side (Critical)</div>
                        <div><span className="font-medium">R₄s:</span> Range between consecutive results ≥4SD (Critical)</div>
                        <div><span className="font-medium">4₁s:</span> 4 consecutive results exceed ±1SD same side (Critical)</div>
                        <div><span className="font-medium">10ₓ:</span> 10 consecutive results on same side of mean (Critical)</div>
                    </div>
                </div>
            </div>

            {/* Combined Z-Score Charts */}
            <div className="bg-white shadow rounded-lg p-2" ref={chartsRef} data-report-section="charts">
                <h3 className="font-semibold mb-2 text-sm">Combined Z-Score Charts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-report-charts-grid>
                    {allParameterIdsForBranch.map(pid => {
                        const param = parameters.find(p => p.id === pid)
                        const rows = recentProcessed.filter(r =>
                            r.branch === selectedBranch &&
                            r.parameter === pid &&
                            new Date(r.date) >= new Date(dateRange.start) &&
                            new Date(r.date) <= new Date(dateRange.end)
                        )
                        if (!rows.length) return null

                        // Combine data into single array with one entry per date
                        const dateMap = new Map<string, { date: string; L1Z?: number; L2Z?: number; L3Z?: number }>()
                        rows.forEach(r => {
                            if (!dateMap.has(r.date)) {
                                dateMap.set(r.date, { date: r.date })
                            }
                            const entry = dateMap.get(r.date)!
                            if (r.zScore !== null) {
                                if (r.level === 'L1') entry.L1Z = r.zScore
                                else if (r.level === 'L2') entry.L2Z = r.zScore
                                else if (r.level === 'L3') entry.L3Z = r.zScore
                            }
                        })
                        const combinedData = Array.from(dateMap.values()).sort((a, b) =>
                            new Date(a.date).getTime() - new Date(b.date).getTime()
                        )

                        const domain = [-3.5, 3.5]
                        return (
                            <div key={pid} className="border rounded-md p-2 bg-white" data-combined-chart={pid}>
                                <div className="mb-1 text-xs font-semibold">
                                    <span>{param?.name || pid}</span>
                                </div>
                                <div className="h-80">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={combinedData} margin={{ top: 5, left: 0, right: 10, bottom: 10 }}>
                                            <CartesianGrid stroke="#eee" strokeDasharray="4 4" />
                                            <XAxis
                                                dataKey="date"
                                                type="category"
                                                tick={{ fontSize: 10, angle: -45, textAnchor: 'end' } as any}
                                                height={45}
                                                interval={0}
                                                tickFormatter={(value) => {
                                                    const date = new Date(value)
                                                    const day = String(date.getDate()).padStart(2, '0')
                                                    const month = String(date.getMonth() + 1).padStart(2, '0')
                                                    return `${day}/${month}`
                                                }}
                                            />
                                            <YAxis
                                                domain={domain}
                                                tick={{ fontSize: 10 }}
                                                ticks={[-3, -2, -1, 0, 1, 2, 3]}
                                                width={30}
                                            />
                                            <Tooltip formatter={(val: any) => [val, 'Z']} />
                                            <ReferenceLine y={0} stroke="#111827" strokeWidth={2} />
                                            <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="4 4" />
                                            <ReferenceLine y={-1} stroke="#6b7280" strokeDasharray="4 4" />
                                            <ReferenceLine y={2} stroke="#f59e0b" strokeDasharray="4 4" />
                                            <ReferenceLine y={-2} stroke="#f59e0b" strokeDasharray="4 4" />
                                            <ReferenceLine y={3} stroke="#dc2626" strokeDasharray="4 4" />
                                            <ReferenceLine y={-3} stroke="#dc2626" strokeDasharray="4 4" />
                                            <Line dataKey="L1Z" name="L1" stroke="#2563eb" dot={{ r: 2 }} isAnimationActive={false} connectNulls type="monotone" />
                                            <Line dataKey="L2Z" name="L2" stroke="#16a34a" dot={{ r: 2 }} isAnimationActive={false} connectNulls type="monotone" />
                                            <Line dataKey="L3Z" name="L3" stroke="#9333ea" dot={{ r: 2 }} isAnimationActive={false} connectNulls type="monotone" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )
                    })}
                    {!allParameterIdsForBranch.length && (
                        <div className="text-xs text-gray-500">No charts for selected period.</div>
                    )}
                </div>
            </div>

            {/* Export Actions (CSV + Google Doc only) */}
            <div className="flex gap-3 justify-end">
                <button
                    onClick={exportReportCSV}
                    disabled={exporting}
                    className="px-4 py-2 text-xs rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
                >
                    CSV
                </button>
                <button
                    onClick={exportGoogleDoc}
                    disabled={gdocExporting}
                    className="px-4 py-2 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {gdocExporting && (
                        <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                    )}
                    <span>{gdocExporting ? 'Google Doc…' : (googleReady ? 'Google Doc' : 'Connect Google')}</span>
                </button>
            </div>
        </div>
    )
}

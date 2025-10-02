"use client"

import { AlertTriangle } from 'lucide-react'
import type { Alert, Branch } from '../types'
import { formatDateDisplay } from '../utils'

interface AlertsViewProps {
    alerts: Alert[]
    alertRows: Alert[]
    alertFilters: Record<string, string>
    setAlertFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>
    toggleAlertSort: (key: string) => void
    branches: Branch[]
    acknowledgeAlert: (id: string | number) => void
}

export default function AlertsView({
    alerts,
    alertRows,
    alertFilters,
    setAlertFilters,
    toggleAlertSort,
    branches,
    acknowledgeAlert
}: AlertsViewProps) {

    const branchName = (branchId: string) => branches.find(b => b.id === branchId)?.name || branchId

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Westgard Rule Alerts
                </h2>

                {/* Summary Cards */}
                <div className="mb-4">
                    <div className="grid grid-cols-4 gap-4 text-sm">
                        <div className="bg-red-50 p-3 rounded">
                            <div className="font-medium text-red-800">Critical Alerts</div>
                            <div className="text-2xl font-bold text-red-600">
                                {alerts.filter(a => a.severity === 'error' && !a.acknowledged).length}
                            </div>
                        </div>
                        <div className="bg-yellow-50 p-3 rounded">
                            <div className="font-medium text-yellow-800">Warnings</div>
                            <div className="text-2xl font-bold text-yellow-600">
                                {alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length}
                            </div>
                        </div>
                        <div className="bg-green-50 p-3 rounded">
                            <div className="font-medium text-green-800">Acknowledged</div>
                            <div className="text-2xl font-bold text-green-600">
                                {alerts.filter(a => a.acknowledged).length}
                            </div>
                        </div>
                        <div className="bg-blue-50 p-3 rounded">
                            <div className="font-medium text-blue-800">Total Alerts</div>
                            <div className="text-2xl font-bold text-blue-600">
                                {alerts.length}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-2 md:grid-cols-8 gap-2 mb-3 text-xs">
                    <input
                        placeholder="Filter Date"
                        value={alertFilters.date}
                        onChange={e => setAlertFilters(f => ({ ...f, date: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Branch"
                        value={alertFilters.branch}
                        onChange={e => setAlertFilters(f => ({ ...f, branch: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Parameter"
                        value={alertFilters.parameter}
                        onChange={e => setAlertFilters(f => ({ ...f, parameter: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Level"
                        value={alertFilters.level}
                        onChange={e => setAlertFilters(f => ({ ...f, level: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Rule"
                        value={alertFilters.rule}
                        onChange={e => setAlertFilters(f => ({ ...f, rule: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Description"
                        value={alertFilters.description}
                        onChange={e => setAlertFilters(f => ({ ...f, description: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Severity"
                        value={alertFilters.severity}
                        onChange={e => setAlertFilters(f => ({ ...f, severity: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Ack (yes/no)"
                        value={alertFilters.acknowledged}
                        onChange={e => setAlertFilters(f => ({ ...f, acknowledged: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                </div>

                {/* Alerts Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('date')}>Date</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('branch')}>Branch</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('parameter')}>Parameter</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('level')}>Level</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('rule')}>Rule</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('description')}>Description</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleAlertSort('severity')}>Severity</th>
                                <th className="text-left py-2">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {alertRows.map(a => (
                                <tr key={a.id} className={`border-b ${a.acknowledged ? 'opacity-50' : ''}`}>
                                    <td className="py-2">{formatDateDisplay(a.date)}</td>
                                    <td className="py-2">{branchName(a.branch)}</td>
                                    <td className="py-2">{a.parameter}</td>
                                    <td className="py-2">{a.level}</td>
                                    <td className="py-2">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${a.rule === '1₂s'
                                                ? 'bg-yellow-100 text-yellow-800'
                                                : 'bg-red-100 text-red-800'
                                            }`}>
                                            {a.rule}
                                        </span>
                                    </td>
                                    <td className="py-2">{a.description}</td>
                                    <td className="py-2">{a.severity}</td>
                                    <td className="py-2">
                                        <button
                                            className="text-blue-600 hover:underline disabled:text-gray-400"
                                            disabled={a.acknowledged}
                                            onClick={() => acknowledgeAlert(a.id)}
                                        >
                                            Acknowledge
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Westgard Rules Reference */}
            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Westgard Rules Reference</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-medium">1₂s</span>
                            <span>Warning: Single result exceeds ±2SD</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">1₃s</span>
                            <span>Error: Single result exceeds ±3SD</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">2₂s</span>
                            <span>Error: 2 consecutive results exceed ±2SD (same side)</span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">R₄s</span>
                            <span>Error: Range between consecutive results ≥4SD</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">4₁s</span>
                            <span>Error: 4 consecutive results exceed ±1SD (same side)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">10ₓ</span>
                            <span>Error: 10 consecutive results on same side of mean</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

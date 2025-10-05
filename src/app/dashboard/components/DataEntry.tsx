"use client"

import { useState } from 'react'
import { Plus, Save, Edit2, Trash2, X, Check } from 'lucide-react'
import { api } from '../../../lib/api'
import type { Branch, Parameter, EntryForm, Alert, QcEntry, DateRange } from '../types'
import { formatDateDisplay } from '../utils'

interface DataEntryProps {
    entryForm: EntryForm
    setEntryForm: React.Dispatch<React.SetStateAction<EntryForm>>
    branches: Branch[]
    parameters: Parameter[]
    isTech: boolean
    claims: any
    selectedBranch: string
    selectedParameter: string
    dateRange: DateRange
    userBranch?: string | null
    setQcData: React.Dispatch<React.SetStateAction<QcEntry[]>>
    setRecentQcData: React.Dispatch<React.SetStateAction<QcEntry[]>>
    recentRows: {
        rows: Array<QcEntry & { zScore: number | null }>
        total: number
        page: number
        pageSize: number
        totalPages: number
    }
    alerts: Alert[]
    recentFilters: Record<string, string>
    setRecentFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>
    recentSortKey: string
    recentSortDir: 'asc' | 'desc'
    toggleRecentSort: (key: string) => void
    recentPage: number
    setRecentPage: React.Dispatch<React.SetStateAction<number>>
    recentPageSize: number
    setRecentPageSize: React.Dispatch<React.SetStateAction<number>>
}

export default function DataEntry({
    entryForm,
    setEntryForm,
    branches,
    parameters,
    isTech,
    claims,
    selectedBranch,
    selectedParameter,
    dateRange,
    userBranch,
    setQcData,
    setRecentQcData,
    recentRows,
    alerts,
    recentFilters,
    setRecentFilters,
    toggleRecentSort,
    recentPage,
    setRecentPage,
    recentPageSize,
    setRecentPageSize
}: DataEntryProps) {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editValue, setEditValue] = useState<string>('')
    const [isDeleting, setIsDeleting] = useState<string | null>(null)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleStartEdit = (entry: QcEntry & { zScore: number | null }) => {
        setEditingId(String(entry.id))
        setEditValue(entry.value.toString())
    }

    const handleCancelEdit = () => {
        setEditingId(null)
        setEditValue('')
    }

    const handleSaveEdit = async (entryId: string) => {
        try {
            const value = parseFloat(editValue)
            if (isNaN(value)) {
                alert('Please enter a valid number')
                return
            }

            await api.updateQc(entryId, value)

            // Reload data
            const [r1, r2] = await Promise.all([
                api.listQc({ branch_id: selectedBranch, parameter_id: selectedParameter, start: dateRange.start, end: dateRange.end }),
                api.listQc({ branch_id: selectedBranch, start: dateRange.start, end: dateRange.end })
            ])

            setQcData(r1.json.items as any)
            setRecentQcData(r2.json.items as any)

            setEditingId(null)
            setEditValue('')
        } catch (err: any) {
            alert(err.message || 'Failed to update entry')
        }
    }

    const handleDelete = async (entryId: string) => {
        if (!confirm('Are you sure you want to delete this QC entry?')) {
            return
        }

        try {
            setIsDeleting(entryId)
            await api.deleteQc(entryId)

            // Reload data
            const [r1, r2] = await Promise.all([
                api.listQc({ branch_id: selectedBranch, parameter_id: selectedParameter, start: dateRange.start, end: dateRange.end }),
                api.listQc({ branch_id: selectedBranch, start: dateRange.start, end: dateRange.end })
            ])

            setQcData(r1.json.items as any)
            setRecentQcData(r2.json.items as any)
        } catch (err: any) {
            alert(err.message || 'Failed to delete entry')
        } finally {
            setIsDeleting(null)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitError(null)
        setIsSubmitting(true)

        try {
            const entries: QcEntry[] = []
                ; (['l1', 'l2', 'l3'] as const).forEach(l => {
                    const v = (entryForm as any)[l]
                    if (v) {
                        entries.push({
                            id: Date.now() + Math.random(),
                            date: entryForm.date,
                            parameter: entryForm.parameter,
                            branch: entryForm.branch,
                            level: l.toUpperCase() as any,
                            value: parseFloat(v),
                            enteredBy: 'Current User',
                            enteredAt: new Date().toISOString()
                        })
                    }
                })

            if (entries.length === 0) {
                setSubmitError('Please enter at least one value (L1, L2, or L3)')
                setIsSubmitting(false)
                return
            }

            const res = await api.createQc(entries.map(e => ({
                date: e.date,
                parameter: e.parameter,
                branch: e.branch,
                level: e.level,
                value: e.value
            })))

            if (res.ok) {
                // Clear form
                setEntryForm({ ...entryForm, l1: '', l2: '', l3: '' })

                // Reload data
                const branchId = isTech && userBranch ? userBranch : selectedBranch

                // Reload selected parameter data
                const r1 = await api.listQc({
                    branch_id: branchId,
                    parameter_id: selectedParameter,
                    start: dateRange.start,
                    end: dateRange.end
                })
                if (r1.ok && Array.isArray(r1.json?.items)) {
                    setQcData(r1.json.items as any)
                }

                // Reload recent data
                const r2 = await api.listQc({
                    branch_id: branchId,
                    start: dateRange.start,
                    end: dateRange.end
                })
                if (r2.ok && Array.isArray(r2.json?.items)) {
                    setRecentQcData(r2.json.items as any)
                }
            } else {
                // Handle error response
                const errorDetail = res.json?.detail || 'Failed to create QC entry'
                setSubmitError(errorDetail)
            }
        } catch (err: any) {
            setSubmitError(err.message || 'An unexpected error occurred')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <Plus className="w-5 h-5" />
                    QC Data Entry
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {submitError && (
                        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-2">
                            <div className="flex-shrink-0 mt-0.5">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <p className="font-medium">Error</p>
                                <p className="text-sm">{submitError}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSubmitError(null)}
                                className="flex-shrink-0 text-red-600 hover:text-red-800"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Date</label>
                            <input
                                type="date"
                                value={entryForm.date}
                                onChange={e => setEntryForm({ ...entryForm, date: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Branch</label>
                            <select
                                value={entryForm.branch}
                                onChange={e => setEntryForm({ ...entryForm, branch: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                                disabled={isTech}
                            >
                                {(isTech ? branches.filter(b => b.id === claims?.branch_id) : branches).map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Parameter</label>
                            <select
                                value={entryForm.parameter}
                                onChange={e => setEntryForm({ ...entryForm, parameter: e.target.value })}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                            >
                                {parameters.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {(['l1', 'l2', 'l3'] as const).map((l, idx) => (
                            <div key={l}>
                                <label className="block text-sm font-medium mb-1">L{idx + 1} Value</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={(entryForm as any)[l]}
                                    onChange={(e) => setEntryForm({ ...entryForm, [l]: e.target.value })}
                                    className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                                    placeholder={`Enter L${idx + 1} value`}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={`px-4 py-2 rounded flex items-center gap-2 ${isSubmitting
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700'
                                } text-white`}
                        >
                            <Save className="w-4 h-4" />
                            {isSubmitting ? 'Saving...' : 'Save Entry'}
                        </button>
                    </div>
                </form>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-2">QC Entries ({recentRows.total} in selected date range)</h3>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 text-xs">
                    <input
                        placeholder="Filter Date"
                        value={recentFilters.date}
                        onChange={e => setRecentFilters(f => ({ ...f, date: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Parameter"
                        value={recentFilters.parameter}
                        onChange={e => setRecentFilters(f => ({ ...f, parameter: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Level"
                        value={recentFilters.level}
                        onChange={e => setRecentFilters(f => ({ ...f, level: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Value"
                        value={recentFilters.value}
                        onChange={e => setRecentFilters(f => ({ ...f, value: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Z-Score"
                        value={recentFilters.zScore}
                        onChange={e => setRecentFilters(f => ({ ...f, zScore: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Status"
                        value={recentFilters.status}
                        onChange={e => setRecentFilters(f => ({ ...f, status: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('date')}>Date</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('parameter')}>Parameter</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('level')}>Level</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('value')}>Value</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('zScore')}>Z-Score</th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleRecentSort('status')}>Status</th>
                                <th className="text-left py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentRows.rows.map(e => (
                                <tr key={e.id} className="border-b">
                                    <td className="py-2">{formatDateDisplay(e.date)}</td>
                                    <td className="py-2">{e.parameter}</td>
                                    <td className="py-2">{e.level}</td>
                                    <td className="py-2">
                                        {editingId === String(e.id) ? (
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                className="border rounded px-2 py-1 w-20"
                                                autoFocus
                                            />
                                        ) : (
                                            e.value.toFixed(2)
                                        )}
                                    </td>
                                    <td className="py-2">{e.zScore == null ? '—' : e.zScore.toFixed(2)}</td>
                                    <td className="py-2">
                                        {alerts.some(a =>
                                            a.date === e.date &&
                                            a.level === e.level &&
                                            a.parameter === e.parameter &&
                                            a.branch === e.branch
                                        ) ? (
                                            <span className="text-red-600">Alert</span>
                                        ) : (
                                            <span className="text-green-600">OK</span>
                                        )}
                                    </td>
                                    <td className="py-2">
                                        <div className="flex gap-1">
                                            {editingId === String(e.id) ? (
                                                <>
                                                    <button
                                                        onClick={() => handleSaveEdit(String(e.id))}
                                                        className="p-1 text-green-600 hover:bg-green-50 rounded"
                                                        title="Save"
                                                    >
                                                        <Check size={16} />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelEdit}
                                                        className="p-1 text-gray-600 hover:bg-gray-50 rounded"
                                                        title="Cancel"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => handleStartEdit(e)}
                                                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                                        title="Edit"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(String(e.id))}
                                                        disabled={isDeleting === String(e.id)}
                                                        className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-600">
                            Showing {recentRows.rows.length === 0 ? 0 : ((recentPage - 1) * recentPageSize + 1)} to{' '}
                            {Math.min(recentPage * recentPageSize, recentRows.total)} of {recentRows.total} entries
                        </span>
                        <select
                            value={recentPageSize}
                            onChange={e => {
                                setRecentPageSize(Number(e.target.value))
                                setRecentPage(1) // Reset to first page when changing page size
                            }}
                            className="border rounded px-2 py-1 text-sm"
                        >
                            <option value={10}>10 per page</option>
                            <option value={20}>20 per page</option>
                            <option value={50}>50 per page</option>
                            <option value={100}>100 per page</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setRecentPage(1)}
                            disabled={recentPage === 1}
                            className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                        >
                            First
                        </button>
                        <button
                            onClick={() => setRecentPage(p => Math.max(1, p - 1))}
                            disabled={recentPage === 1}
                            className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                        >
                            Previous
                        </button>
                        <span className="px-2">
                            Page {recentPage} of {recentRows.totalPages || 1}
                        </span>
                        <button
                            onClick={() => setRecentPage(p => Math.min(recentRows.totalPages, p + 1))}
                            disabled={recentPage >= recentRows.totalPages}
                            className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                        >
                            Next
                        </button>
                        <button
                            onClick={() => setRecentPage(recentRows.totalPages)}
                            disabled={recentPage >= recentRows.totalPages}
                            className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                        >
                            Last
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

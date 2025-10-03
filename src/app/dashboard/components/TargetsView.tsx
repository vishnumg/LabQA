import { Settings, Plus, Edit2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Branch, Parameter, TargetForm } from '../types'
import { formatDateDisplay } from '../utils'
import { api } from '../../../lib/api'

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

interface TargetsViewProps {
    targetRows: TargetRow[]
    targetFilters: Record<string, string>
    setTargetFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>
    toggleTargetSort: (key: string) => void
    setShowTargetModal: (show: boolean) => void
    setEditingTarget: (key: string | null) => void
    setTargetForm: React.Dispatch<React.SetStateAction<TargetForm>>
    onTargetUpdated: () => void
}

export default function TargetsView({
    targetRows,
    targetFilters,
    setTargetFilters,
    toggleTargetSort,
    setShowTargetModal,
    setEditingTarget,
    setTargetForm,
    onTargetUpdated
}: TargetsViewProps) {
    const [editingRow, setEditingRow] = useState<string | null>(null)
    const [editValues, setEditValues] = useState<{ mean: string; sd: string }>({ mean: '', sd: '' })
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

    const handleEditClick = (row: TargetRow) => {
        setEditingRow(row.key)
        setEditValues({ mean: String(row.mean), sd: String(row.sd) })
    }

    const handleSaveEdit = async (row: TargetRow) => {
        const mean = parseFloat(editValues.mean)
        const sd = parseFloat(editValues.sd)
        if (isNaN(mean) || isNaN(sd)) {
            alert('Mean and SD must be valid numbers')
            return
        }

        const result = await api.updateTarget(row.branchId, row.parameterId, row.level, row.validFrom, { mean, sd })
        if (result.ok) {
            setEditingRow(null)
            onTargetUpdated()
        } else {
            alert('Failed to update target')
        }
    }

    const handleCancelEdit = () => {
        setEditingRow(null)
        setEditValues({ mean: '', sd: '' })
    }

    const handleDeleteClick = (row: TargetRow) => {
        setDeleteConfirm(row.key)
    }

    const handleConfirmDelete = async (row: TargetRow) => {
        const result = await api.deleteTarget(row.branchId, row.parameterId, row.level, row.validFrom)
        if (result.ok) {
            setDeleteConfirm(null)
            onTargetUpdated()
        } else {
            alert('Failed to delete target')
        }
    }

    const handleCancelDelete = () => {
        setDeleteConfirm(null)
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Settings className="w-5 h-5" />Target Mean & SD Management
                    </h2>
                    <button
                        onClick={() => {
                            setShowTargetModal(true)
                            setEditingTarget(null)
                        }}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />Add Target
                    </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 text-xs">
                    <input
                        placeholder="Filter Branch"
                        value={targetFilters.branch}
                        onChange={e => setTargetFilters(f => ({ ...f, branch: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Parameter"
                        value={targetFilters.parameter}
                        onChange={e => setTargetFilters(f => ({ ...f, parameter: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Level"
                        value={targetFilters.level}
                        onChange={e => setTargetFilters(f => ({ ...f, level: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Mean"
                        value={targetFilters.mean}
                        onChange={e => setTargetFilters(f => ({ ...f, mean: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter SD"
                        value={targetFilters.sd}
                        onChange={e => setTargetFilters(f => ({ ...f, sd: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                    <input
                        placeholder="Filter Valid From"
                        value={targetFilters.validFrom}
                        onChange={e => setTargetFilters(f => ({ ...f, validFrom: e.target.value }))}
                        className="border rounded px-2 py-1"
                    />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('branch')}>
                                    Branch
                                </th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('parameter')}>
                                    Parameter
                                </th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('level')}>
                                    Level
                                </th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('mean')}>
                                    Mean
                                </th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('sd')}>
                                    SD
                                </th>
                                <th className="text-left py-2 cursor-pointer" onClick={() => toggleTargetSort('validFrom')}>
                                    Valid From
                                </th>
                                <th className="text-left py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {targetRows.map(r => (
                                <tr key={r.key} className="border-b hover:bg-gray-50">
                                    <td className="py-2">{r.branchName}</td>
                                    <td className="py-2">{r.parameterName}</td>
                                    <td className="py-2">{r.level}</td>
                                    <td className="py-2">
                                        {editingRow === r.key ? (
                                            <input
                                                type="number"
                                                step="0.001"
                                                value={editValues.mean}
                                                onChange={e => setEditValues(v => ({ ...v, mean: e.target.value }))}
                                                className="border rounded px-2 py-1 w-24"
                                            />
                                        ) : (
                                            r.mean
                                        )}
                                    </td>
                                    <td className="py-2">
                                        {editingRow === r.key ? (
                                            <input
                                                type="number"
                                                step="0.001"
                                                value={editValues.sd}
                                                onChange={e => setEditValues(v => ({ ...v, sd: e.target.value }))}
                                                className="border rounded px-2 py-1 w-24"
                                            />
                                        ) : (
                                            r.sd
                                        )}
                                    </td>
                                    <td className="py-2">{formatDateDisplay(r.validFrom)}</td>
                                    <td className="py-2">
                                        {deleteConfirm === r.key ? (
                                            <div className="flex gap-2">
                                                <button
                                                    className="text-red-600 hover:underline text-xs"
                                                    onClick={() => handleConfirmDelete(r)}
                                                >
                                                    Confirm
                                                </button>
                                                <button
                                                    className="text-gray-600 hover:underline text-xs"
                                                    onClick={handleCancelDelete}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : editingRow === r.key ? (
                                            <div className="flex gap-2">
                                                <button
                                                    className="text-green-600 hover:underline text-xs"
                                                    onClick={() => handleSaveEdit(r)}
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    className="text-gray-600 hover:underline text-xs"
                                                    onClick={handleCancelEdit}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <button
                                                    className="text-blue-600 hover:text-blue-800"
                                                    onClick={() => handleEditClick(r)}
                                                    title="Edit"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    className="text-red-600 hover:text-red-800"
                                                    onClick={() => handleDeleteClick(r)}
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

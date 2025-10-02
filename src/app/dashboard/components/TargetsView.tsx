import { Settings, Plus } from 'lucide-react'
import type { Branch, Parameter, TargetForm } from '../types'
import { formatDateDisplay } from '../utils'

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
}

export default function TargetsView({
    targetRows,
    targetFilters,
    setTargetFilters,
    toggleTargetSort,
    setShowTargetModal,
    setEditingTarget,
    setTargetForm
}: TargetsViewProps) {
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
                                <tr key={r.key} className="border-b">
                                    <td className="py-2">{r.branchName}</td>
                                    <td className="py-2">{r.parameterName}</td>
                                    <td className="py-2">{r.level}</td>
                                    <td className="py-2">{r.mean}</td>
                                    <td className="py-2">{r.sd}</td>
                                    <td className="py-2">{formatDateDisplay(r.validFrom)}</td>
                                    <td className="py-2">
                                        <button
                                            className="text-blue-600 hover:underline"
                                            onClick={() => {
                                                setEditingTarget(r.key)
                                                setShowTargetModal(true)
                                                setTargetForm({
                                                    parameter: r.parameterId,
                                                    level: r.level as 'L1' | 'L2' | 'L3',
                                                    branch: r.branchId,
                                                    mean: String(r.mean),
                                                    sd: String(r.sd),
                                                    validFrom: r.validFrom
                                                })
                                            }}
                                        >
                                            Edit
                                        </button>
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

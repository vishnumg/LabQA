import { X } from 'lucide-react'
import type { Branch, Parameter, TargetForm } from '../types'

interface TargetModalProps {
    editingTarget: string | null
    targetForm: TargetForm
    setTargetForm: React.Dispatch<React.SetStateAction<TargetForm>>
    branches: Branch[]
    parameters: Parameter[]
    handleTargetSubmit: (e: React.FormEvent) => Promise<void>
    setShowTargetModal: (show: boolean) => void
    setEditingTarget: (key: string | null) => void
}

export default function TargetModal({
    editingTarget,
    targetForm,
    setTargetForm,
    branches,
    parameters,
    handleTargetSubmit,
    setShowTargetModal,
    setEditingTarget
}: TargetModalProps) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">
                        {editingTarget ? 'Edit Target Values' : 'Add Target Values'}
                    </h3>
                    <button
                        onClick={() => {
                            setShowTargetModal(false)
                            setEditingTarget(null)
                        }}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <form onSubmit={handleTargetSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Branch</label>
                        <select
                            value={targetForm.branch}
                            onChange={(e) => setTargetForm({ ...targetForm, branch: e.target.value })}
                            className="w-full p-2 border rounded"
                            required
                        >
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Parameter</label>
                        <select
                            value={targetForm.parameter}
                            onChange={(e) => setTargetForm({ ...targetForm, parameter: e.target.value })}
                            className="w-full p-2 border rounded"
                            required
                        >
                            {parameters.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Level</label>
                        <select
                            value={targetForm.level}
                            onChange={(e) => setTargetForm({ ...targetForm, level: e.target.value as 'L1' | 'L2' | 'L3' })}
                            className="w-full p-2 border rounded"
                            required
                        >
                            <option value="L1">L1</option>
                            <option value="L2">L2</option>
                            <option value="L3">L3</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Target Mean</label>
                        <input
                            type="number"
                            step="0.01"
                            value={targetForm.mean}
                            onChange={(e) => setTargetForm({ ...targetForm, mean: e.target.value })}
                            className="w-full p-2 border rounded"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Target SD</label>
                        <input
                            type="number"
                            step="0.01"
                            value={targetForm.sd}
                            onChange={(e) => setTargetForm({ ...targetForm, sd: e.target.value })}
                            className="w-full p-2 border rounded"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Valid From</label>
                        <input
                            type="date"
                            value={targetForm.validFrom}
                            onChange={(e) => setTargetForm({ ...targetForm, validFrom: e.target.value })}
                            className="w-full p-2 border rounded"
                            required
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
                        >
                            {editingTarget ? 'Update' : 'Add'} Target
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setShowTargetModal(false)
                                setEditingTarget(null)
                            }}
                            className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

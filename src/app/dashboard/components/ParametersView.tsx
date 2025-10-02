import React, { useState } from 'react'
import { Plus, Edit2, Trash2, X, Check } from 'lucide-react'
import { api } from '../../../lib/api'

interface Parameter {
    id: string
    name: string
    unit?: string
}

interface DeleteOption {
    id: string
    label: string
    description: string
    checked: boolean
}

interface ParametersViewProps {
    parameters: Parameter[]
    onRefresh: () => void
    setAdminMessage: (msg: string) => void
}

export function ParametersView({ parameters, onRefresh, setAdminMessage }: ParametersViewProps) {
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [editingParam, setEditingParam] = useState<Parameter | null>(null)
    const [deleteModal, setDeleteModal] = useState<{
        isOpen: boolean
        parameter: Parameter | null
        cascadeOptions: DeleteOption[]
        isDeleting: boolean
    }>({ isOpen: false, parameter: null, cascadeOptions: [], isDeleting: false })

    const [createForm, setCreateForm] = useState({ id: '', name: '', unit: '' })
    const [editForm, setEditForm] = useState({ name: '', unit: '' })

    // Create parameter
    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!createForm.id || !createForm.name) {
            setAdminMessage('ID and Name are required')
            return
        }

        const r = await api.adminCreateParameter(
            createForm.id.trim(),
            createForm.name.trim(),
            createForm.unit.trim() || undefined
        )

        if (r.ok) {
            setAdminMessage('Parameter created successfully')
            setCreateForm({ id: '', name: '', unit: '' })
            setShowCreateForm(false)
            onRefresh()
        } else if (r.status === 409) {
            setAdminMessage('Parameter ID already exists')
        } else {
            setAdminMessage(r.json?.detail || 'Failed to create parameter')
        }
    }

    // Update parameter
    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingParam) return

        const r = await api.adminUpdateParameter(editingParam.id, {
            name: editForm.name.trim() || undefined,
            unit: editForm.unit.trim() || null
        })

        if (r.ok) {
            setAdminMessage('Parameter updated successfully')
            setEditingParam(null)
            onRefresh()
        } else {
            setAdminMessage(r.json?.detail || 'Failed to update parameter')
        }
    }

    // Initiate delete with cascade options
    const initiateDelete = (parameter: Parameter) => {
        // Always offer cascade options for targets and QC entries
        const cascadeOptions: DeleteOption[] = [
            {
                id: 'targets',
                label: 'Target Configurations',
                description: 'All target mean/SD values for this parameter across all branches',
                checked: true
            },
            {
                id: 'qc_entries',
                label: 'QC Data Entries',
                description: 'All quality control measurements for this parameter',
                checked: true
            }
        ]

        setDeleteModal({
            isOpen: true,
            parameter,
            cascadeOptions,
            isDeleting: false
        })
    }

    // Confirm delete with selected cascade options
    const confirmDelete = async (selectedOptions: string[]) => {
        if (!deleteModal.parameter) return

        setDeleteModal(prev => ({ ...prev, isDeleting: true }))

        try {
            const r = await api.adminDeleteParameter(deleteModal.parameter.id, selectedOptions)

            if (r.ok) {
                setAdminMessage('Parameter deleted successfully')
                setDeleteModal({ isOpen: false, parameter: null, cascadeOptions: [], isDeleting: false })
                onRefresh()
            } else {
                let errorMsg = 'Delete failed'
                if (r.status === 409) {
                    const detail = r.json?.detail || ''
                    if (detail.startsWith('parameter_in_use:')) {
                        errorMsg = detail.replace('parameter_in_use: ', '❌ Cannot delete parameter: ')
                    } else {
                        errorMsg = detail || 'Parameter has related data that must be handled first.'
                    }
                } else if (r.json?.detail) {
                    errorMsg = r.json.detail
                }
                setAdminMessage(errorMsg)
                setDeleteModal(prev => ({ ...prev, isDeleting: false }))
            }
        } catch (error) {
            setAdminMessage('Delete operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
            setDeleteModal(prev => ({ ...prev, isDeleting: false }))
        }
    }

    return (
        <div className="space-y-4">
            {/* Header with Create Button */}
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">Parameters</h3>
                <button
                    onClick={() => setShowCreateForm(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add Parameter
                </button>
            </div>

            {/* Create Form */}
            {showCreateForm && (
                <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="font-medium text-gray-900">Create New Parameter</h4>
                        <button
                            onClick={() => {
                                setShowCreateForm(false)
                                setCreateForm({ id: '', name: '', unit: '' })
                            }}
                            className="text-gray-500 hover:text-gray-700"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <form onSubmit={handleCreate} className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                ID <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={createForm.id}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, id: e.target.value }))}
                                placeholder="e.g., glucose, hba1c"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                required
                            />
                            <p className="text-xs text-gray-500 mt-1">Lowercase, no spaces (use underscores)</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Name <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={createForm.name}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g., Glucose, HbA1c"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Unit (optional)
                            </label>
                            <input
                                type="text"
                                value={createForm.unit}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, unit: e.target.value }))}
                                placeholder="e.g., mg/dL, %, mmol/L"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="submit"
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                                <Check className="w-4 h-4" />
                                Create
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowCreateForm(false)
                                    setCreateForm({ id: '', name: '', unit: '' })
                                }}
                                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Parameters List */}
            <div className="border border-gray-300 rounded-lg overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">ID</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Unit</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {parameters.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                                    No parameters yet. Create one to get started!
                                </td>
                            </tr>
                        ) : (
                            parameters.map((param) => (
                                <tr key={param.id} className="hover:bg-gray-50">
                                    {editingParam?.id === param.id ? (
                                        // Edit Mode
                                        <>
                                            <td className="px-4 py-3 text-sm text-gray-600 font-mono">{param.id}</td>
                                            <td className="px-4 py-3">
                                                <input
                                                    type="text"
                                                    value={editForm.name}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                                    className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="px-4 py-3">
                                                <input
                                                    type="text"
                                                    value={editForm.unit}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, unit: e.target.value }))}
                                                    placeholder="Optional"
                                                    className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={handleUpdate}
                                                        className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                                                        title="Save"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingParam(null)}
                                                        className="p-1 text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded"
                                                        title="Cancel"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </>
                                    ) : (
                                        // View Mode
                                        <>
                                            <td className="px-4 py-3 text-sm text-gray-600 font-mono">{param.id}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{param.name}</td>
                                            <td className="px-4 py-3 text-sm text-gray-600">{param.unit || '—'}</td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setEditingParam(param)
                                                            setEditForm({ name: param.name, unit: param.unit || '' })
                                                        }}
                                                        className="p-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                                                        title="Edit"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => initiateDelete(param)}
                                                        className="p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Delete Confirmation Modal (similar to DeleteConfirmationModal but inline) */}
            {deleteModal.isOpen && deleteModal.parameter && (
                <DeleteModal
                    parameter={deleteModal.parameter}
                    cascadeOptions={deleteModal.cascadeOptions}
                    isDeleting={deleteModal.isDeleting}
                    onConfirm={confirmDelete}
                    onCancel={() => setDeleteModal({ isOpen: false, parameter: null, cascadeOptions: [], isDeleting: false })}
                />
            )}
        </div>
    )
}

// Inline Delete Modal Component
function DeleteModal({
    parameter,
    cascadeOptions,
    isDeleting,
    onConfirm,
    onCancel
}: {
    parameter: Parameter
    cascadeOptions: DeleteOption[]
    isDeleting: boolean
    onConfirm: (selectedOptions: string[]) => void
    onCancel: () => void
}) {
    const [selectedOptions, setSelectedOptions] = useState<Set<string>>(
        new Set(cascadeOptions.filter(opt => opt.checked).map(opt => opt.id))
    )

    const toggleOption = (id: string) => {
        const newSet = new Set(selectedOptions)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedOptions(newSet)
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Delete Parameter?</h3>
                <p className="text-sm text-gray-700 mb-2">
                    Are you sure you want to delete this parameter?
                </p>
                <p className="text-sm font-semibold text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200 mb-4">
                    {parameter.name} ({parameter.id})
                </p>

                {cascadeOptions.length > 0 && (
                    <div className="mb-6 border-t border-gray-200 pt-4">
                        <p className="text-sm font-medium text-gray-900 mb-3">
                            This parameter has related data. Select what to delete:
                        </p>
                        <div className="space-y-2">
                            {cascadeOptions.map(option => (
                                <label
                                    key={option.id}
                                    className="flex items-start gap-3 p-3 rounded hover:bg-gray-50 cursor-pointer border border-gray-200"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedOptions.has(option.id)}
                                        onChange={() => toggleOption(option.id)}
                                        disabled={isDeleting}
                                        className="mt-0.5 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-gray-900">
                                            {option.label}
                                        </div>
                                        <div className="text-xs text-gray-600 mt-0.5">
                                            {option.description}
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-3 italic">
                            ⚠️ Uncheck items if you want to keep them. Deleting related data is permanent.
                        </p>
                    </div>
                )}

                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onCancel}
                        disabled={isDeleting}
                        className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(Array.from(selectedOptions))}
                        disabled={isDeleting}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        {isDeleting ? (
                            <>
                                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                Deleting...
                            </>
                        ) : (
                            'Delete'
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}

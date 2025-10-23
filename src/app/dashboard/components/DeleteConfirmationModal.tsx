import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'

export interface DeleteOption {
    id: string
    label: string
    description: string
    checked: boolean
}

interface DeleteConfirmationModalProps {
    isOpen: boolean
    title: string
    message: string
    itemName: string
    cascadeOptions?: DeleteOption[]
    onConfirm: (selectedOptions: string[]) => void
    onCancel: () => void
    isDeleting?: boolean
}

export default function DeleteConfirmationModal({
    isOpen,
    title,
    message,
    itemName,
    cascadeOptions = [],
    onConfirm,
    onCancel,
    isDeleting = false
}: DeleteConfirmationModalProps) {
    const [selectedOptions, setSelectedOptions] = useState<Set<string>>(
        new Set(cascadeOptions.filter(opt => opt.checked).map(opt => opt.id))
    )

    if (!isOpen) return null

    const toggleOption = (id: string) => {
        const newSet = new Set(selectedOptions)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedOptions(newSet)
    }

    const handleConfirm = () => {
        onConfirm(Array.from(selectedOptions))
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className="bg-red-100 p-2 rounded-full">
                            <AlertTriangle className="w-6 h-6 text-red-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                    </div>
                    <button
                        onClick={onCancel}
                        disabled={isDeleting}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="mb-4">
                    <p className="text-sm text-gray-700 mb-2">{message}</p>
                    <p className="text-sm font-semibold text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                        {itemName}
                    </p>
                </div>

                {cascadeOptions.length > 0 && (
                    <div className="mb-6 border-t border-gray-200 pt-4">
                        <p className="text-sm font-medium text-gray-900 mb-3">
                            This item has related data. Select what to delete:
                        </p>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
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

                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        disabled={isDeleting}
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isDeleting}
                        className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {isDeleting ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
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

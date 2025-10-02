"use client"

import { useState } from 'react'
import type { Branch, Technician } from '../types'
import { formatDateDisplay } from '../utils'
import { ParametersView } from './ParametersView'

interface AdminViewProps {
    branches: Branch[]
    branchName: (branchId: string) => string
    branchCreateName: string
    setBranchCreateName: React.Dispatch<React.SetStateAction<string>>
    handleBranchCreate: (e: React.FormEvent) => void
    branchEdit: { id: string; name: string } | null
    setBranchEdit: React.Dispatch<React.SetStateAction<{ id: string; name: string } | null>>
    handleBranchUpdate: (e: React.FormEvent) => void
    handleBranchDelete: (id: string) => void
    technicians: Technician[]
    techLoading: boolean
    techCreate: { email: string; password: string; branch_id: string }
    setTechCreate: React.Dispatch<React.SetStateAction<{ email: string; password: string; branch_id: string }>>
    handleTechCreate: (e: React.FormEvent) => void
    techEdit: { id: string; email: string; branch_id: string } | null
    setTechEdit: React.Dispatch<React.SetStateAction<{ id: string; email: string; branch_id: string } | null>>
    handleTechUpdate: (e: React.FormEvent) => void
    handleTechDelete: (id: string) => void
    pwReset: { id: string; password: string } | null
    setPwReset: React.Dispatch<React.SetStateAction<{ id: string; password: string } | null>>
    handlePwReset: (e: React.FormEvent) => void
    adminMessage: string
    parameters: Array<{ id: string; name: string; unit?: string }>
    refreshParameters: () => void
    setAdminMessage: (msg: string) => void
}

export default function AdminView(props: AdminViewProps) {
    const [adminTab, setAdminTab] = useState<'branches' | 'technicians' | 'parameters'>('branches')

    return (
        <div className="space-y-4">
            {/* Admin Sub-tabs */}
            <div className="bg-white border-b">
                <nav className="flex space-x-4 px-4">
                    {[
                        { id: 'branches' as const, name: 'Branches' },
                        { id: 'technicians' as const, name: 'Technicians' },
                        { id: 'parameters' as const, name: 'Parameters' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setAdminTab(tab.id)}
                            className={`py-3 px-1 border-b-2 font-medium text-sm ${adminTab === tab.id
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            {tab.name}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-lg shadow p-6">
                {adminTab === 'branches' && <BranchesTab {...props} />}
                {adminTab === 'technicians' && <TechniciansTab {...props} />}
                {adminTab === 'parameters' && (
                    <ParametersView
                        parameters={props.parameters}
                        onRefresh={props.refreshParameters}
                        setAdminMessage={props.setAdminMessage}
                    />
                )}
            </div>

            {/* Message Display */}
            {props.adminMessage && (
                <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
                    {props.adminMessage}
                </div>
            )}
        </div>
    )
}

// Branches Tab Component
function BranchesTab({
    branches,
    branchCreateName,
    setBranchCreateName,
    handleBranchCreate,
    branchEdit,
    setBranchEdit,
    handleBranchUpdate,
    handleBranchDelete
}: AdminViewProps) {
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">Branch Management</h2>
            {/* Create Branch Form */}
            <form onSubmit={handleBranchCreate} className="flex flex-col md:flex-row gap-2 mb-4">
                <input
                    value={branchCreateName}
                    onChange={e => setBranchCreateName(e.target.value)}
                    placeholder="New branch name"
                    className="border rounded px-3 py-2 flex-1"
                />
                <button className="bg-blue-600 text-white px-4 py-2 rounded">
                    Add Branch
                </button>
            </form>

            {/* Edit Branch Form */}
            {branchEdit && (
                <form onSubmit={handleBranchUpdate} className="flex flex-col md:flex-row gap-2 mb-4 bg-blue-50 p-3 rounded">
                    <input
                        value={branchEdit.name}
                        onChange={e => setBranchEdit({ ...branchEdit, name: e.target.value })}
                        className="border rounded px-3 py-2 flex-1"
                    />
                    <div className="flex gap-2">
                        <button className="bg-green-600 text-white px-4 py-2 rounded">Save</button>
                        <button type="button" onClick={() => setBranchEdit(null)} className="px-4 py-2 rounded border">
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            {/* Branches Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b">
                            <th className="text-left py-2">Name</th>
                            <th className="text-left py-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {branches.map(b => (
                            <tr key={b.id} className="border-b">
                                <td className="py-2">{b.name}</td>
                                <td className="py-2 flex gap-2">
                                    <button
                                        className="text-blue-600 hover:underline"
                                        onClick={() => setBranchEdit({ id: b.id, name: b.name })}
                                    >
                                        Rename
                                    </button>
                                    <button
                                        className="text-red-600 hover:underline"
                                        onClick={() => handleBranchDelete(b.id)}
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// Technicians Tab Component
function TechniciansTab({
    branches,
    branchName,
    technicians,
    techLoading,
    techCreate,
    setTechCreate,
    handleTechCreate,
    techEdit,
    setTechEdit,
    handleTechUpdate,
    handleTechDelete,
    pwReset,
    setPwReset,
    handlePwReset
}: AdminViewProps) {
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">Technician Management</h2>

            {/* Create Technician Form */}
            <form onSubmit={handleTechCreate} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
                <input
                    value={techCreate.email}
                    onChange={e => setTechCreate(c => ({ ...c, email: e.target.value }))}
                    placeholder="Email"
                    className="border rounded px-3 py-2"
                />
                <input
                    value={techCreate.password}
                    onChange={e => setTechCreate(c => ({ ...c, password: e.target.value }))}
                    placeholder="Password"
                    type="password"
                    className="border rounded px-3 py-2"
                />
                <select
                    value={techCreate.branch_id}
                    onChange={e => setTechCreate(c => ({ ...c, branch_id: e.target.value }))}
                    className="border rounded px-3 py-2"
                >
                    <option value="">(No Branch)</option>
                    {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
                <button className="bg-blue-600 text-white px-4 py-2 rounded">
                    Add Technician
                </button>
            </form>

            {/* Edit Technician Form */}
            {techEdit && (
                <form onSubmit={handleTechUpdate} className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4 bg-blue-50 p-3 rounded">
                    <input
                        value={techEdit.email}
                        onChange={e => setTechEdit(t => t ? { ...t, email: e.target.value } : t)}
                        className="border rounded px-3 py-2"
                    />
                    <select
                        value={techEdit.branch_id}
                        onChange={e => setTechEdit(t => t ? { ...t, branch_id: e.target.value } : t)}
                        className="border rounded px-3 py-2"
                    >
                        <option value="">(No Branch)</option>
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                    <div className="flex gap-2 col-span-1 md:col-span-2">
                        <button className="bg-green-600 text-white px-4 py-2 rounded" type="submit">
                            Save
                        </button>
                        <button type="button" className="px-4 py-2 rounded border" onClick={() => setTechEdit(null)}>
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            {/* Password Reset Form */}
            {pwReset && (
                <form onSubmit={handlePwReset} className="flex flex-col md:flex-row gap-2 mb-4 bg-amber-50 p-3 rounded">
                    <input
                        value={pwReset.password}
                        onChange={e => setPwReset(p => p ? { ...p, password: e.target.value } : p)}
                        placeholder="New password"
                        type="password"
                        className="border rounded px-3 py-2 flex-1"
                    />
                    <div className="flex gap-2">
                        <button className="bg-purple-600 text-white px-4 py-2 rounded">Change</button>
                        <button type="button" onClick={() => setPwReset(null)} className="px-4 py-2 rounded border">
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            {/* Technicians Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b">
                            <th className="text-left py-2">Email</th>
                            <th className="text-left py-2">Branch</th>
                            <th className="text-left py-2">Created</th>
                            <th className="text-left py-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {techLoading ? (
                            <tr>
                                <td colSpan={4} className="py-4 text-center text-gray-500">
                                    Loading…
                                </td>
                            </tr>
                        ) : (
                            technicians.map(t => (
                                <tr key={t.id} className="border-b">
                                    <td className="py-2">{t.email}</td>
                                    <td className="py-2">{branchName(t.branch_id || '') || '—'}</td>
                                    <td className="py-2">
                                        {t.created_at ? formatDateDisplay(t.created_at.split('T')[0]) : ''}
                                    </td>
                                    <td className="py-2 flex flex-wrap gap-2">
                                        <button
                                            className="text-blue-600 hover:underline"
                                            onClick={() => setTechEdit({ id: t.id, email: t.email, branch_id: t.branch_id || '' })}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="text-indigo-600 hover:underline"
                                            onClick={() => setPwReset({ id: t.id, password: '' })}
                                        >
                                            Password
                                        </button>
                                        <button
                                            className="text-red-600 hover:underline"
                                            onClick={() => handleTechDelete(t.id)}
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

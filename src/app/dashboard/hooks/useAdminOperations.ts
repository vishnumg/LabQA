import { useState, useEffect } from 'react'
import { api } from '../../../lib/api'
import type { DeleteOption } from '../components/DeleteConfirmationModal'
import { parseTargetKey } from '../targetKeyHelpers'

interface Technician {
    id: string
    email: string
    branch_id?: string | null
    created_at?: string
}

interface DeleteModalState {
    isOpen: boolean
    type: 'branch' | 'technician' | null
    item: { id: string; name: string } | null
    cascadeOptions: DeleteOption[]
    isDeleting: boolean
}

export const useAdminOperations = (
    isAdmin: boolean,
    currentTab: string,
    targetVersions: Record<string, any[]>,
    recentQcData: any[]
) => {
    const [technicians, setTechnicians] = useState<Technician[]>([])
    const [techLoading, setTechLoading] = useState(false)
    const [branchCreateName, setBranchCreateName] = useState('')
    const [branchEdit, setBranchEdit] = useState<{ id: string; name: string } | null>(null)
    const [techCreate, setTechCreate] = useState<{
        email: string
        password: string
        branch_id: string | ''
    }>({ email: '', password: '', branch_id: '' })
    const [techEdit, setTechEdit] = useState<{
        id: string
        email: string
        branch_id: string | ''
    } | null>(null)
    const [pwReset, setPwReset] = useState<{ id: string; password: string } | null>(null)
    const [adminMessage, setAdminMessage] = useState<string | null>(null)
    const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
        isOpen: false,
        type: null,
        item: null,
        cascadeOptions: [],
        isDeleting: false
    })

    // Load technicians when admin tab is selected
    useEffect(() => {
        if (!isAdmin || currentTab !== 'admin') return
        let cancelled = false
        const loadTechs = async () => {
            setTechLoading(true)
            const r = await api.adminListTechnicians()
            if (!cancelled) {
                if (r.ok && Array.isArray(r.json?.items)) {
                    setTechnicians(r.json.items)
                }
                setTechLoading(false)
            }
        }
        loadTechs()
        return () => { cancelled = true }
    }, [currentTab, isAdmin])

    // Refresh functions
    const refreshTechnicians = async () => {
        if (!isAdmin) return
        const r = await api.adminListTechnicians()
        if (r.ok && Array.isArray(r.json?.items)) {
            setTechnicians(r.json.items)
        }
    }

    // Branch cascade options calculator
    const getBranchCascadeOptions = (branchId: string): DeleteOption[] => {
        const options: DeleteOption[] = []

        const qcCount = recentQcData.filter(q => q.branch === branchId).length
        options.push({
            id: 'qc_entries',
            label: qcCount > 0 ? `${qcCount}+ QC Data Entries` : 'QC Data Entries (if any)',
            description: `All quality control measurements for this branch (across all dates)`,
            checked: true
        })

        const targetCount = Object.keys(targetVersions).filter(k => {
            const { branchId: keyBranchId } = parseTargetKey(k)
            return keyBranchId === branchId
        }).length
        options.push({
            id: 'targets',
            label: targetCount > 0 ? `${targetCount} Target Configurations` : 'Target Configurations (if any)',
            description: `Target mean and SD values for parameters`,
            checked: true
        })

        const techCount = technicians.filter(t => t.branch_id === branchId).length
        if (techCount > 0) {
            options.push({
                id: 'technicians',
                label: `${techCount} Technician${techCount > 1 ? 's' : ''}`,
                description: `Users assigned to this branch will be unlinked (not deleted)`,
                checked: false
            })
        }

        return options
    }

    // Technician cascade options calculator
    const getTechnicianCascadeOptions = (techId: string): DeleteOption[] => {
        return []
    }

    // Branch handlers
    const handleBranchCreate = async (e: React.FormEvent, onSuccess: () => void) => {
        e.preventDefault()
        if (!branchCreateName.trim()) return
        const r = await api.adminCreateBranch(branchCreateName.trim())
        if (r.ok) {
            setBranchCreateName('')
            setAdminMessage('Branch created')
            onSuccess()
        } else {
            setAdminMessage('Failed to create branch')
        }
    }

    const handleBranchUpdate = async (e: React.FormEvent, onSuccess: () => void) => {
        e.preventDefault()
        if (!branchEdit) return
        const r = await api.adminUpdateBranch(branchEdit.id, branchEdit.name.trim())
        if (r.ok) {
            setAdminMessage('Branch updated')
            setBranchEdit(null)
            onSuccess()
        } else {
            setAdminMessage('Failed to update branch')
        }
    }

    const handleBranchDelete = (branch: { id: string; name: string }) => {
        const cascadeOptions = getBranchCascadeOptions(branch.id)
        setDeleteModal({
            isOpen: true,
            type: 'branch',
            item: branch,
            cascadeOptions,
            isDeleting: false
        })
    }

    // Technician handlers
    const handleTechCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!techCreate.email || !techCreate.password) return
        const r = await api.adminCreateTechnician(
            techCreate.email,
            techCreate.password,
            techCreate.branch_id || undefined
        )
        if (r.ok) {
            setTechCreate({ email: '', password: '', branch_id: '' })
            setAdminMessage('Technician created')
            refreshTechnicians()
        } else {
            setAdminMessage('Failed to create technician')
        }
    }

    const handleTechUpdate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!techEdit) return
        const r = await api.adminUpdateTechnician(techEdit.id, {
            email: techEdit.email,
            branch_id: techEdit.branch_id || null
        })
        if (r.ok) {
            setTechEdit(null)
            setAdminMessage('Technician updated')
            refreshTechnicians()
        } else {
            setAdminMessage('Update failed')
        }
    }

    const handleTechDelete = (tech: { id: string; email: string }) => {
        const cascadeOptions = getTechnicianCascadeOptions(tech.id)
        setDeleteModal({
            isOpen: true,
            type: 'technician',
            item: { id: tech.id, name: tech.email },
            cascadeOptions,
            isDeleting: false
        })
    }

    const handlePwReset = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!pwReset) return
        const r = await api.adminChangeTechnicianPassword(pwReset.id, pwReset.password)
        if (r.ok) {
            setPwReset(null)
            setAdminMessage('Password changed')
        } else {
            setAdminMessage('Password change failed')
        }
    }

    // Delete confirmation
    const confirmDelete = async (selectedOptions: string[], onSuccess: () => void) => {
        if (!deleteModal.item) return

        setDeleteModal(prev => ({ ...prev, isDeleting: true }))

        try {
            if (deleteModal.type === 'branch') {
                const r = await api.adminDeleteBranch(deleteModal.item.id, selectedOptions)
                if (r.ok) {
                    setAdminMessage('Branch deleted successfully')
                    onSuccess()
                    setDeleteModal({
                        isOpen: false,
                        type: null,
                        item: null,
                        cascadeOptions: [],
                        isDeleting: false
                    })
                } else {
                    let errorMsg = 'Delete failed'
                    if (r.status === 409) {
                        errorMsg = 'Cannot delete branch: ' + (r.json?.detail || 'Conflict')
                    } else if (r.json?.detail) {
                        errorMsg = r.json.detail
                    }
                    setAdminMessage(errorMsg)
                    setDeleteModal(prev => ({ ...prev, isDeleting: false }))
                }
            } else if (deleteModal.type === 'technician') {
                const r = await api.adminDeleteTechnician(deleteModal.item.id, selectedOptions)
                if (r.ok) {
                    setAdminMessage('Technician deleted successfully')
                    refreshTechnicians()
                    setDeleteModal({
                        isOpen: false,
                        type: null,
                        item: null,
                        cascadeOptions: [],
                        isDeleting: false
                    })
                } else {
                    let errorMsg = 'Delete failed'
                    if (r.status === 409 && r.json?.detail === 'technician_in_use') {
                        errorMsg = 'Cannot delete technician: still referenced'
                    } else if (r.json?.detail) {
                        errorMsg = r.json.detail
                    }
                    setAdminMessage(errorMsg)
                    setDeleteModal(prev => ({ ...prev, isDeleting: false }))
                }
            }
        } catch (error) {
            setAdminMessage('Delete operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
            setDeleteModal(prev => ({ ...prev, isDeleting: false }))
        }
    }

    const cancelDelete = () => {
        setDeleteModal({
            isOpen: false,
            type: null,
            item: null,
            cascadeOptions: [],
            isDeleting: false
        })
    }

    return {
        technicians,
        techLoading,
        branchCreateName,
        setBranchCreateName,
        branchEdit,
        setBranchEdit,
        techCreate,
        setTechCreate,
        techEdit,
        setTechEdit,
        pwReset,
        setPwReset,
        adminMessage,
        setAdminMessage,
        deleteModal,
        refreshTechnicians,
        handleBranchCreate,
        handleBranchUpdate,
        handleBranchDelete,
        handleTechCreate,
        handleTechUpdate,
        handleTechDelete,
        handlePwReset,
        confirmDelete,
        cancelDelete
    }
}

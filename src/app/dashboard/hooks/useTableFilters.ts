import { useState } from 'react'

interface UseTableFiltersOptions {
    initialSortKey?: string
    initialSortDir?: 'asc' | 'desc'
    initialFilters?: Record<string, string>
}

/**
 * Generic hook for managing table filtering and sorting state
 */
export const useTableFilters = (options: UseTableFiltersOptions = {}) => {
    const {
        initialSortKey = 'date',
        initialSortDir = 'desc',
        initialFilters = {}
    } = options

    const [sortKey, setSortKey] = useState<string>(initialSortKey)
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir)
    const [filters, setFilters] = useState<Record<string, string>>(initialFilters)

    const toggleSort = (key: string) => {
        if (sortKey === key) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
        } else {
            setSortKey(key)
            setSortDir('asc')
        }
    }

    return {
        sortKey,
        sortDir,
        filters,
        setFilters,
        toggleSort
    }
}

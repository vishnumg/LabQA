/**
 * Helper functions for safely creating and parsing target keys
 * These functions handle parameter IDs that contain underscores or other special characters
 */

export interface TargetKey {
    branchId: string
    parameterId: string
    level: string
}

// Use a delimiter that won't appear in IDs
const KEY_DELIMITER = '|::|'

/**
 * Create a composite key from branch, parameter, and level IDs
 * This key is safe to use even if the IDs contain underscores or other special characters
 */
export const makeTargetKey = (branchId: string, parameterId: string, level: string): string => {
    return `${branchId}${KEY_DELIMITER}${parameterId}${KEY_DELIMITER}${level}`
}

/**
 * Parse a composite key back into its component parts
 */
export const parseTargetKey = (key: string): TargetKey => {
    const [branchId, parameterId, level] = key.split(KEY_DELIMITER)
    return { branchId, parameterId, level }
}

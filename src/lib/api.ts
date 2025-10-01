export const api = {
    async login(email: string, password: string) {
        try {
            const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
            if (r.ok) {
                const data = await r.json()
                if (data?.token) { localStorage.setItem('token', data.token); return { ok: true as const } }
            }
            return { ok: false as const, error: 'Invalid credentials' }
        } catch {
            return { ok: false as const, error: 'Network error' }
        }
    },
    token(): string | null { if (typeof window === 'undefined') return null; return localStorage.getItem('token') },
    async fetchJSON(path: string, init: RequestInit = {}) {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
        const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as any) }
        if (token) headers['Authorization'] = `Bearer ${token}`
        const r = await fetch(path, { ...init, headers })
        const json = await r.json().catch(() => null)
        return { status: r.status, ok: r.ok, json }
    },
    async example() { return this.fetchJSON('/api/example') },
    async getBranches() { return this.fetchJSON('/api/branches') },
    async getParameters() { return this.fetchJSON('/api/parameters') },
    async getTargets() { return this.fetchJSON('/api/targets') },
    async upsertTarget(body: { branch_id: string; parameter_id: string; level: string; mean: number; sd: number; validFrom: string; }) { return this.fetchJSON('/api/targets', { method: 'PUT', body: JSON.stringify(body) }) },
    async listQc(params: { branch_id?: string; parameter_id?: string; start?: string; end?: string; }) {
        const q = new URLSearchParams()
        if (params.branch_id) q.set('branch_id', params.branch_id)
        if (params.parameter_id) q.set('parameter_id', params.parameter_id)
        if (params.start) q.set('start', params.start)
        if (params.end) q.set('end', params.end)
        const qs = q.toString()
        return this.fetchJSON('/api/qc' + (qs ? `?${qs}` : ''))
    },
    async createQc(entries: Array<{ date: string; parameter: string; branch: string; level: string; value: number; }>) {
        return this.fetchJSON('/api/qc', { method: 'POST', body: JSON.stringify({ entries }) })
    },
    // --- Admin: Branch Management ---
    async adminCreateBranch(name: string) { return this.fetchJSON('/api/admin/branches', { method: 'POST', body: JSON.stringify({ name }) }) },
    async adminUpdateBranch(id: string, name: string) { return this.fetchJSON(`/api/admin/branches/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }) },
    async adminDeleteBranch(id: string) { return this.fetchJSON(`/api/admin/branches/${id}`, { method: 'DELETE' }) },
    // --- Admin: Technician Management ---
    async adminListTechnicians() { return this.fetchJSON('/api/admin/technicians') },
    async adminCreateTechnician(email: string, password: string, branch_id?: string | null) { return this.fetchJSON('/api/admin/technicians', { method: 'POST', body: JSON.stringify({ email, password, branch_id }) }) },
    async adminUpdateTechnician(id: string, data: { email?: string; branch_id?: string | null }) { return this.fetchJSON(`/api/admin/technicians/${id}`, { method: 'PUT', body: JSON.stringify(data) }) },
    async adminDeleteTechnician(id: string) { return this.fetchJSON(`/api/admin/technicians/${id}`, { method: 'DELETE' }) },
    async adminChangeTechnicianPassword(id: string, password: string) { return this.fetchJSON(`/api/admin/technicians/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }) }
}

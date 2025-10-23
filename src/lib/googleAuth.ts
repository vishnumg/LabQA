// Lightweight Google OAuth client helper (stateless)
// Handles popup flow, token persistence, refresh, and retrieval.

export type GoogleTokens = {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    token_type?: string
    id_token?: string
    obtained_at: number // epoch ms when stored
}

const LS_KEY = 'gdrive_oauth_tokens'
const STATE_KEY = 'gdrive_oauth_state'

export function loadTokens(): GoogleTokens | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return null
        return JSON.parse(raw)
    } catch { return null }
}

export function saveTokens(t: Partial<GoogleTokens> & { access_token: string }): GoogleTokens {
    const merged: GoogleTokens = {
        access_token: t.access_token,
        refresh_token: t.refresh_token || loadTokens()?.refresh_token,
        expires_in: t.expires_in ?? loadTokens()?.expires_in,
        scope: t.scope ?? loadTokens()?.scope,
        token_type: t.token_type ?? loadTokens()?.token_type,
        id_token: t.id_token ?? loadTokens()?.id_token,
        obtained_at: Date.now()
    }
    localStorage.setItem(LS_KEY, JSON.stringify(merged))
    return merged
}

export function clearTokens() {
    if (typeof window === 'undefined') return
    localStorage.removeItem(LS_KEY)
}

export function tokenExpiresAt(tokens: GoogleTokens | null): number | null {
    if (!tokens) return null
    if (!tokens.expires_in) return null
    return tokens.obtained_at + tokens.expires_in * 1000
}

export function isTokenNearExpiry(tokens: GoogleTokens | null, skewMs = 60_000): boolean {
    const exp = tokenExpiresAt(tokens)
    if (!exp) return false // treat as non-expiring (not ideal, but OK if Google omitted expires_in)
    return Date.now() > (exp - skewMs)
}

function randomState(len = 32) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let out = ''
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
    return out
}

export async function startGoogleOAuth(apiBase: string): Promise<void> {
    const state = randomState()
    localStorage.setItem(STATE_KEY, state)
    const urlResp = await fetch(`${apiBase}/api/google/oauth/start?state=${encodeURIComponent(state)}`)
    if (!urlResp.ok) throw new Error('Failed to initiate OAuth')
    const { url } = await urlResp.json()
    const w = window.open(url, 'gdrive_oauth', 'width=520,height=640')
    if (!w) throw new Error('Popup blocked')
}

export async function ensureGoogleAccessToken(apiBase: string): Promise<string | null> {
    let tokens = loadTokens()
    if (!tokens) return null
    if (isTokenNearExpiry(tokens) && tokens.refresh_token) {
        try {
            const r = await fetch(`${apiBase}/api/google/oauth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: tokens.refresh_token })
            })
            if (r.ok) {
                const j = await r.json()
                tokens = saveTokens({ ...j, access_token: j.access_token })
            }
        } catch {
            // ignore; use existing token (may still work briefly)
        }
    }
    return tokens?.access_token || null
}

export function initOAuthMessageListener(onUpdate: () => void) {
    if (typeof window === 'undefined') return
    const handler = (ev: MessageEvent) => {
        // If FRONTEND_ORIGIN is configured backend may restrict; here we just accept same-origin or wildcard dev
        if (!ev.data || typeof ev.data !== 'object') return
        if ('state' in ev.data) {
            const expected = localStorage.getItem(STATE_KEY)
            if (expected && ev.data.state !== expected) return
            if (ev.data.ok && ev.data.tokens) {
                const t = ev.data.tokens
                saveTokens({
                    access_token: t.access_token,
                    refresh_token: t.refresh_token,
                    expires_in: t.expires_in,
                    scope: t.scope,
                    token_type: t.token_type,
                    id_token: t.id_token
                })
                onUpdate()
            } else if (ev.data.error) {
                console.warn('OAuth error', ev.data.error)
            }
        }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
}

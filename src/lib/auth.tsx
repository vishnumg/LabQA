"use client"
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type Claims = { sub: string; role?: string; branch_id?: string; exp?: number }

type AuthContextType = { token: string | null; claims: Claims | null; setToken: (t: string | null) => void; logout: () => void; ready: boolean }

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setTokenState] = useState<string | null>(null)
    const [claims, setClaims] = useState<Claims | null>(null)
    const [ready, setReady] = useState(false)

    // Helper to check if token is expired
    const isTokenExpired = (claims: Claims | null): boolean => {
        if (!claims || !claims.exp) return false
        return claims.exp * 1000 < Date.now()
    }

    useEffect(() => {
        const t = typeof window !== 'undefined' ? localStorage.getItem('token') : null
        if (t) {
            setTokenState(t)
            try {
                const [, payload] = t.split('.')
                const json = JSON.parse(atob(payload)) as Claims
                // Check if token is expired
                if (isTokenExpired(json)) {
                    console.log('Token expired, clearing...')
                    setTokenState(null)
                    setClaims(null)
                    if (typeof window !== 'undefined') localStorage.removeItem('token')
                } else {
                    setClaims(json)
                }
            } catch {
                setClaims(null)
            }
        } else {
            setTokenState(null)
            setClaims(null)
        }
        setReady(true)
    }, [])

    useEffect(() => {
        if (token) {
            try {
                const [, payload] = token.split('.')
                const json = JSON.parse(atob(payload)) as Claims
                // Check if token is expired
                if (isTokenExpired(json)) {
                    console.log('Token expired, clearing...')
                    setTokenState(null)
                    setClaims(null)
                    if (typeof window !== 'undefined') localStorage.removeItem('token')
                } else {
                    setClaims(json)
                    localStorage.setItem('token', token)
                }
            } catch {
                setClaims(null)
            }
        } else {
            setClaims(null)
            if (typeof window !== 'undefined') localStorage.removeItem('token')
        }
    }, [token])
    const value = useMemo<AuthContextType>(() => ({ token, claims, setToken: (t) => setTokenState(t), logout: () => setTokenState(null), ready }), [token, claims, ready])
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error('useAuth must be used within AuthProvider'); return ctx }

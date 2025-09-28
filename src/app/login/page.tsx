"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../../lib/api'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [msg, setMsg] = useState<string | null>(null)
    const router = useRouter()

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setMsg(null)
        const res = await api.login(email, password)
        if (res.ok) { setMsg('Logged in'); router.push('/dashboard') }
        else setMsg(res.error || 'Login failed')
    }

    return (
        <main className="min-h-screen flex items-center justify-center p-4">
            <div className="bg-white shadow rounded p-6 w-full max-w-sm space-y-4">
                <h1 className="text-xl font-semibold">Login</h1>
                <form onSubmit={onSubmit} className="space-y-3">
                    <div>
                        <label className="block text-sm mb-1">Email</label>
                        <input className="w-full border rounded px-3 py-2" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Password</label>
                        <input className="w-full border rounded px-3 py-2" type="password" value={password} onChange={e => setPassword(e.target.value)} />
                    </div>
                    <button className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700" type="submit">Sign in</button>
                </form>
                {msg && <p className="text-sm text-gray-700">{msg}</p>}
            </div>
        </main>
    )
}

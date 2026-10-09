import { useEffect, useState } from 'react'

/** useState that remembers its value in localStorage (merged over the default, so new keys appear). */
export function usePersistentState<T>(key: string, initial: T) {
  const storageKey = `hunt-ranker:${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        return typeof initial === 'object' && initial && !Array.isArray(initial) ? { ...initial, ...parsed } : parsed
      }
    } catch {
      // storage unavailable or corrupt: fall back to the default
    }
    return initial
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // ignore
    }
  }, [storageKey, value])
  return [value, setValue] as const
}

/** The drilled-into hunt, kept in the URL (#hunt=<id>) so it can be bookmarked or shared. */
export function useHashSelection() {
  const read = () => new URLSearchParams(location.hash.slice(1)).get('hunt')
  const [id, setId] = useState<string | null>(read)
  useEffect(() => {
    const onHash = () => setId(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const select = (next: string | null) => {
    setId(next)
    history.replaceState(null, '', next ? `#hunt=${encodeURIComponent(next)}` : location.pathname + location.search)
  }
  return [id, select] as const
}

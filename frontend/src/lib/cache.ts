import { useCallback, useEffect, useRef, useState } from 'react'

interface CacheEntry<T> {
  data: T
  ts: number
}

const cache = new Map<string, CacheEntry<unknown>>()

/**
 * Tiny module-level TTL cache for GET-style fetches that get re-triggered by
 * remounting components (e.g. MapView re-fetching cameras/density every time
 * you navigate back to a page). Serves cached data immediately on remount
 * within `ttlMs`, instead of showing an empty state while re-fetching.
 */
export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 20000,
): { data: T | null; loading: boolean; error: unknown; refresh: () => void } {
  const cached = cache.get(key) as CacheEntry<T> | undefined
  const isFresh = !!cached && Date.now() - cached.ts < ttlMs

  const [data, setData] = useState<T | null>(cached?.data ?? null)
  const [loading, setLoading] = useState(!isFresh)
  const [error, setError] = useState<unknown>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(() => {
    setLoading(true)
    fetcherRef.current()
      .then(result => {
        cache.set(key, { data: result, ts: Date.now() })
        setData(result)
        setError(null)
      })
      .catch(err => setError(err))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const entry = cache.get(key) as CacheEntry<T> | undefined
    if (entry && Date.now() - entry.ts < ttlMs) {
      setData(entry.data)
      setLoading(false)
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load])

  return { data, loading, error, refresh: load }
}

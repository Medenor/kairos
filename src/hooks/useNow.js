import { useEffect, useState } from 'react'

const MINUTE_MS = 60000

// One shared "now" for everything that counts days (recommendation, reset countdowns, surplus
// evaluation, FR-038). It is refreshed every minute and when the window gets focus again, so a page left
// open across local midnight shows the right day counts. Timers are injectable for tests.
export function useNow({ intervalMs = MINUTE_MS, getNow = () => new Date(), setTimer = setInterval, clearTimer = clearInterval } = {}) {
  const [now, setNow] = useState(getNow)

  useEffect(() => {
    const refresh = () => setNow(getNow())
    const timer = setTimer(refresh, intervalMs)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimer(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, getNow, setTimer, clearTimer])

  return now
}

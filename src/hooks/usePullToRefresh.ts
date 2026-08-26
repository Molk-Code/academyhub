import { useEffect, useRef } from 'react'

const PULL_THRESHOLD = 64
const MAX_PULL = 88

export function usePullToRefresh(onRefresh: () => void) {
  const mainRef      = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const pullStartY   = useRef<number | null>(null)
  const pullCurrent  = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const el        = mainRef.current!
    const indicator = indicatorRef.current!
    if (!el || !indicator) return

    function applyPull(y: number) {
      const progress    = Math.min(y / PULL_THRESHOLD, 1)
      const isTriggered = progress >= 1

      el.style.transform  = y > 0 ? `translateY(${y}px)` : ''
      el.style.transition = 'none'

      indicator.style.display = y > 4 ? 'flex' : 'none'
      indicator.style.opacity = String(Math.min(progress * 1.4, 1))

      const arrow  = indicator.querySelector<HTMLElement>('[data-pull-arrow]')
      const circle = indicator.querySelector<HTMLElement>('[data-pull-circle]')
      if (arrow)  arrow.style.transform  = `rotate(${progress * 180}deg)`
      if (circle) {
        circle.style.background  = isTriggered ? '#f26419' : ''
        circle.style.borderColor = isTriggered ? '#d44e0a' : ''
      }
    }

    function snapBack() {
      el.style.transition = 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)'
      el.style.transform  = ''
      el.addEventListener('transitionend', () => { el.style.transition = '' }, { once: true })
      indicator.style.display = 'none'
      pullCurrent.current = 0
    }

    function onStart(e: TouchEvent) {
      if (el.scrollTop > 2) return
      if ((e.target as Element).closest?.('.fc')) return
      pullStartY.current  = e.touches[0].clientY
      pullCurrent.current = 0
    }

    function onMove(e: TouchEvent) {
      if (pullStartY.current === null) return
      const dy = e.touches[0].clientY - pullStartY.current
      if (dy > 0) {
        // Actively pulling — prevent browser scroll and update position
        e.preventDefault()
        pullCurrent.current = Math.min(dy * 0.52, MAX_PULL)
      } else {
        // Finger moved back up — shrink pull but keep the gesture alive
        pullCurrent.current = 0
      }
      applyPull(pullCurrent.current)
    }

    function onEnd() {
      if (pullStartY.current === null) return
      pullStartY.current = null
      if (pullCurrent.current >= PULL_THRESHOLD) {
        snapBack()
        onRefreshRef.current()
      } else {
        snapBack()
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove',  onMove,  { passive: false })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove',  onMove)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [])

  return { mainRef, indicatorRef }
}

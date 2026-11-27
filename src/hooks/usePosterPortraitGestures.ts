import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

const MOVE_X_LIMIT = 16
const MOVE_Y_LIMIT = 13
const MIN_ZOOM = 70
const MAX_ZOOM = 140

type Point = { x: number; y: number }
type Position = { scalePercent: number; xOffsetPercent: number; yOffsetPercent: number }
type Gesture = { position: Position; center: Point; distance: number }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function measureGesture(pointers: Map<number, Point>) {
  const [first, second] = pointers.values()
  if (!first) return null
  if (!second) return { center: first, distance: 0 }
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(first.x - second.x, first.y - second.y),
  }
}

export function usePosterPortraitGestures(
  canvasRef: RefObject<HTMLCanvasElement>,
  portraitRef: RefObject<HTMLCanvasElement>,
  enabled: boolean,
  position: Position,
  setPosition: (position: Position) => void,
) {
  const [selected, setSelected] = useState(false)
  const active = enabled && selected
  const pointers = useRef(new Map<number, Point>())
  const start = useRef<Gesture | null>(null)
  const latestPosition = useRef(position)
  latestPosition.current = position

  function select(next: boolean) {
    setSelected(next)
    if (next) return
    pointers.current.clear()
    start.current = null
  }

  function update(next: Position) {
    const previous = latestPosition.current
    if (next.scalePercent === previous.scalePercent && next.xOffsetPercent === previous.xOffsetPercent
      && next.yOffsetPercent === previous.yOffsetPercent) return
    latestPosition.current = next
    setPosition(next)
  }

  function beginGesture() {
    const measurement = measureGesture(pointers.current)
    start.current = measurement && { ...measurement, position: latestPosition.current }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!enabled || event.button !== 0 || pointers.current.size >= 2) return
    if (!active) {
      const layer = portraitRef.current
      const rect = event.currentTarget.getBoundingClientRect()
      const x = Math.floor((event.clientX - rect.left) / rect.width * (layer?.width ?? 0))
      const y = Math.floor((event.clientY - rect.top) / rect.height * (layer?.height ?? 0))
      const pixel = layer?.getContext('2d')?.getImageData(x, y, 1, 1).data
      if (!pixel || pixel[3] < 48) return
      select(true)
    }
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    beginGesture()
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!start.current || !pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const current = measureGesture(pointers.current)
    if (!current) return
    const { position: initial, center, distance } = start.current
    const { width, height } = event.currentTarget.getBoundingClientRect()
    update({
      xOffsetPercent: clamp(Math.round(initial.xOffsetPercent + (current.center.x - center.x) / width * 100), -MOVE_X_LIMIT, MOVE_X_LIMIT),
      yOffsetPercent: clamp(Math.round(initial.yOffsetPercent + (current.center.y - center.y) / height * 100), -MOVE_Y_LIMIT, MOVE_Y_LIMIT),
      scalePercent: distance > 0
        ? clamp(Math.round(initial.scalePercent * current.distance / distance), MIN_ZOOM, MAX_ZOOM)
        : initial.scalePercent,
    })
  }

  function endPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointers.current.delete(event.pointerId)) beginGesture()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!active || !canvas) return
    function zoom(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return
      event.preventDefault()
      const position = latestPosition.current
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1)
      const step = Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / 12))
      const next = { ...position, scalePercent: clamp(position.scalePercent - step, MIN_ZOOM, MAX_ZOOM) }
      if (next.scalePercent === position.scalePercent) return
      latestPosition.current = next
      setPosition(next)
    }
    canvas.addEventListener('wheel', zoom, { passive: false })
    return () => canvas.removeEventListener('wheel', zoom)
  }, [active, canvasRef, setPosition])

  return { active, select, onPointerDown, onPointerMove, endPointer }
}

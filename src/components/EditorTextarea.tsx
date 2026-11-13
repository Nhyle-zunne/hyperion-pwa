import { useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string }

/** Fit short editor fields to their content without hiding longer questions. */
export default function EditorTextarea({ value, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = useCallback(() => {
    const input = ref.current
    if (!input) return
    const maximum = Number.parseFloat(getComputedStyle(input).maxHeight) || 180
    input.style.height = 'auto'
    input.style.height = `${Math.min(maximum, input.scrollHeight + 2)}px`
    input.style.overflowY = input.scrollHeight + 2 > maximum ? 'auto' : 'hidden'
  }, [])
  useLayoutEffect(fit, [value, fit])
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    let width = parent.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const next = parent.getBoundingClientRect().width
      if (next !== width) { width = next; fit() }
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [fit])
  return <textarea {...props} value={value} ref={ref} rows={1} className="admin-qb-textarea" />
}

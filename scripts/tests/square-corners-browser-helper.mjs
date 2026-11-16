import assert from 'node:assert/strict'

export async function assertSquareCorners(page) {
  const rounded = await page.evaluate(() => {
    const properties = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
    const failures = []
    for (const element of document.querySelectorAll('*')) {
      if (!element.getClientRects().length) continue
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo)
        if (pseudo && (style.content === 'none' || style.content === 'normal')) continue
        if (properties.some(key => style[key].split(/\s+/).some(value => parseFloat(value) !== 0))) {
          failures.push(element.tagName + '#' + element.id + '.' + element.classList.toString() + (pseudo || ''))
        }
      }
    }
    return failures.slice(0, 12)
  })
  assert.deepEqual(rounded, [], 'Every rendered PWA surface, control and pseudo-element uses square corners')
}

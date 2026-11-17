import { createElement } from 'react'

/**
 * Loads the pinwright overlay in `next dev`; renders nothing anywhere else.
 * Put it in the root layout's <body> (app router) or in pages/_document (pages router).
 */
export function Pinwright() {
  const src = process.env.PINWRIGHT_SRC
  if (!src) return null
  return createElement('script', { src, defer: true, 'data-pinwright': '' })
}

export default Pinwright

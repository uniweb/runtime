/**
 * Background
 *
 * A section's background in the browser: the one the prerender draws (`../background.js`, one copy
 * for both renderers), plus the one thing only a browser does — playing a video background once it
 * has mounted.
 */

import React, { useEffect, useState } from 'react'
import { Background as Layer, VideoPoster, VideoElement, videoMoves } from '../background.js'

/** The visitor's `prefers-reduced-motion`; false where it cannot be read (old webviews, no DOM). */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A video background: its poster first — the prerendered page's, so the render that replaces that
 * page draws the same — and the playing video once mounted (`videoMoves`).
 */
function MovingVideo({ video }) {
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    setMoving(videoMoves(video, prefersReducedMotion()))
  }, [video])
  return moving ? <VideoElement video={video} /> : <VideoPoster video={video} />
}

/**
 * @param {Object} props - `block.background`'s fields (`mode`, `color`, `gradient`, `image`, `video`,
 *   `overlay`), and a `className` for the layer
 */
export default function Background(props) {
  return <Layer {...props} Video={MovingVideo} />
}

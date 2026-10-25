/**
 * A section's background — the layer the runtime draws behind a section's content: a color, a
 * gradient, an image or a video, under an optional overlay. It reads `block.background`, which core
 * normalizes once (`Block.normalizeBackground`).
 *
 * ⭐ ONE COPY, FOR BOTH RENDERERS: the browser's (`components/Background.jsx`) and the prerender's
 * (`ssr-renderer.js`, behind `uniweb build` and a host's prerender alike). It needs no hooks, no
 * Router and no DOM, so it is written with `createElement` and both draw it — the L3 twins exist for
 * code that needs those (`default-layout.js` is the same rule).
 * ⛔ Until 2026-10-25 each renderer wrote its own, and they had drifted: the prerender read an
 * overlay's `angle: 0` and `endPosition: 0` as unset (`||`), drew no video background at all, and
 * dropped the `className` kit's `SectionBackground` passes. Each showed as the page changing when
 * the browser rendered it in place of the prerendered one. Pinned by `tests/page-parity.test.js`.
 *
 * ⭐ A VIDEO IS ITS POSTER UNTIL THE BROWSER HAS MOUNTED IT. Both renderers draw the poster
 * (`VideoPoster`); the browser then swaps in the playing `<video>` (`components/Background.jsx`),
 * unless the visitor prefers reduced motion and there is a poster to keep (`videoMoves`). That
 * preference is the one thing here that needs the DOM, so it is read in an effect, never in the first
 * render: read there, it made the browser's first render differ from the prerendered page for exactly
 * those visitors.
 *
 * ⭐ An unset value is `undefined` or `null`, never a falsy one: `0` is an angle, a position and an
 * opacity like any other (`??`, not `||`).
 */

import React from 'react'
import { siteUrl, withOpacity } from './background-shared.js'

const h = React.createElement

/** The box every layer fills: the section's, behind its content (`BlockRenderer.jsx`). */
const FILL = { position: 'absolute', inset: 0 }

function ColorLayer({ color }) {
  if (!color) return null
  return h('div', { className: 'background-color', style: { ...FILL, backgroundColor: color }, 'aria-hidden': 'true' })
}

function GradientLayer({ gradient }) {
  if (!gradient) return null

  // A CSS gradient as written ("linear-gradient(to bottom, #000, #333)")
  if (typeof gradient === 'string') {
    return h('div', { className: 'background-gradient', style: { ...FILL, background: gradient }, 'aria-hidden': 'true' })
  }

  const start = gradient.start ?? 'transparent'
  const end = gradient.end ?? 'transparent'
  const startOpacity = gradient.startOpacity ?? 1
  const endOpacity = gradient.endOpacity ?? 1
  const startColor = startOpacity < 1 ? withOpacity(start, startOpacity) : start
  const endColor = endOpacity < 1 ? withOpacity(end, endOpacity) : end
  const background =
    `linear-gradient(${gradient.angle ?? 0}deg, ` +
    `${startColor} ${gradient.startPosition ?? 0}%, ${endColor} ${gradient.endPosition ?? 100}%)`

  return h('div', { className: 'background-gradient', style: { ...FILL, background }, 'aria-hidden': 'true' })
}

function ImageLayer({ image }) {
  if (!image?.src) return null
  const style = {
    ...FILL,
    backgroundImage: `url(${siteUrl(image.src)})`,
    backgroundPosition: image.position ?? 'center',
    backgroundSize: image.size ?? 'cover',
    backgroundRepeat: 'no-repeat',
  }
  return h('div', { className: 'background-image', style, 'aria-hidden': 'true' })
}

/**
 * A video background as both renderers first draw it: its poster, as an image layer — or nothing,
 * when it has none. The browser replaces it with `VideoElement` once mounted.
 */
export function VideoPoster({ video }) {
  if (!video?.src || !video.poster) return null
  return h(ImageLayer, { image: { src: video.poster, size: 'cover', position: 'center' } })
}

/**
 * Whether a mounted video background plays: always, unless the visitor prefers reduced motion and
 * there is a poster to show instead.
 *
 * @param {Object} video - `background.video`
 * @param {boolean} reducedMotion - the visitor's `prefers-reduced-motion`
 * @returns {boolean}
 */
export function videoMoves(video, reducedMotion) {
  if (!video?.src) return false
  return !(reducedMotion && video.poster)
}

/** The playing video, which only the browser draws, once mounted (`components/Background.jsx`). */
export function VideoElement({ video }) {
  if (!video?.src) return null
  const sources = (video.sources || inferSources(video.src)).map((s) => ({ ...s, src: siteUrl(s.src) }))
  return h(
    'video',
    {
      className: 'background-video',
      style: { ...FILL, width: '100%', height: '100%', objectFit: 'cover' },
      autoPlay: true,
      loop: video.loop ?? true,
      muted: video.muted ?? true,
      playsInline: true,
      poster: siteUrl(video.poster),
      'aria-hidden': 'true',
    },
    sources.map(({ src, type }, index) => h('source', { key: index, src, type })),
  )
}

/**
 * The formats to offer for a single `src`: an `.mp4` is offered as `.webm` first (better
 * compression), and the reverse; the browser plays the first it supports.
 */
function inferSources(src) {
  const ext = src.split('.').pop()?.toLowerCase()
  const base = src.slice(0, src.lastIndexOf('.'))
  if (ext === 'mp4') return [{ src: `${base}.webm`, type: 'video/webm' }, { src, type: 'video/mp4' }]
  if (ext === 'webm') return [{ src, type: 'video/webm' }, { src: `${base}.mp4`, type: 'video/mp4' }]
  const type = src.endsWith('.ogg') || src.endsWith('.ogv') ? 'video/ogg' : 'video/mp4'
  return [{ src, type }]
}

function Overlay({ overlay }) {
  if (!overlay?.enabled) return null
  const opacity = overlay.opacity ?? 0.5

  if (overlay.gradient) {
    const g = overlay.gradient
    const background =
      `linear-gradient(${g.angle ?? 180}deg, ${g.start ?? 'rgba(0,0,0,0.7)'} ${g.startPosition ?? 0}%, ` +
      `${g.end ?? 'rgba(0,0,0,0)'} ${g.endPosition ?? 100}%)`
    return h('div', {
      className: 'background-overlay background-overlay--gradient',
      style: { ...FILL, background, opacity, pointerEvents: 'none' },
      'aria-hidden': 'true',
    })
  }

  const base = overlay.type === 'light' ? '255, 255, 255' : '0, 0, 0'
  return h('div', {
    className: 'background-overlay background-overlay--solid',
    style: { ...FILL, backgroundColor: `rgba(${base}, ${opacity})`, pointerEvents: 'none' },
    'aria-hidden': 'true',
  })
}

/**
 * The background layer: `block.background`'s fields, and a `className` for the layer (kit's
 * `SectionBackground` passes one).
 *
 * @param {Object} props
 * @param {string} props.mode - 'color' | 'gradient' | 'image' | 'video'; nothing is drawn without one
 * @param {string} [props.color]
 * @param {string|Object} [props.gradient]
 * @param {Object} [props.image]
 * @param {Object} [props.video]
 * @param {Object} [props.overlay]
 * @param {string} [props.className]
 * @param {Function} [props.Video] - how a video background is drawn: its poster (the default, and the
 *   prerender's), or the browser's, which plays it once mounted
 * @returns {React.ReactElement|null}
 */
export function Background({ mode, color, gradient, image, video, overlay, className = '', Video = VideoPoster }) {
  if (!mode) return null
  return h(
    'div',
    {
      className: `background background--${mode} ${className}`.trim(),
      style: { ...FILL, overflow: 'hidden', zIndex: 0 },
      'aria-hidden': 'true',
    },
    mode === 'color' ? h(ColorLayer, { color }) : null,
    mode === 'gradient' ? h(GradientLayer, { gradient }) : null,
    mode === 'image' ? h(ImageLayer, { image }) : null,
    mode === 'video' ? h(Video, { video }) : null,
    h(Overlay, { overlay }),
  )
}

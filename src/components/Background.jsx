/**
 * Background
 *
 * Renders section backgrounds (color, gradient, image, video) with optional overlay.
 * Positioned absolutely behind content with proper z-index stacking.
 *
 * @module @uniweb/runtime/components/Background
 */

import React from 'react'

/**
 * Background modes
 */
const MODES = {
  COLOR: 'color',
  GRADIENT: 'gradient',
  IMAGE: 'image',
  VIDEO: 'video',
}

/**
 * Default overlay colors
 */
const OVERLAY_COLORS = {
  light: 'rgba(255, 255, 255, 0.5)',
  dark: 'rgba(0, 0, 0, 0.5)',
}

/**
 * Render gradient overlay
 */
function GradientOverlay({ gradient, opacity = 0.5 }) {
  const {
    start = 'rgba(0,0,0,0.7)',
    end = 'rgba(0,0,0,0)',
    angle = 180,
    startPosition = 0,
    endPosition = 100,
  } = gradient

  const style = {
    position: 'absolute',
    inset: 0,
    background: `linear-gradient(${angle}deg, ${start} ${startPosition}%, ${end} ${endPosition}%)`,
    opacity,
    pointerEvents: 'none',
  }

  return <div className="background-overlay background-overlay--gradient" style={style} aria-hidden="true" />
}

/**
 * Render solid overlay
 */
function SolidOverlay({ type = 'dark', opacity = 0.5 }) {
  const baseColor = type === 'light' ? '255, 255, 255' : '0, 0, 0'

  const style = {
    position: 'absolute',
    inset: 0,
    backgroundColor: `rgba(${baseColor}, ${opacity})`,
    pointerEvents: 'none',
  }

  return <div className="background-overlay background-overlay--solid" style={style} aria-hidden="true" />
}

/**
 * Render overlay (gradient or solid)
 */
function Overlay({ overlay }) {
  if (!overlay?.enabled) return null

  if (overlay.gradient) {
    return <GradientOverlay gradient={overlay.gradient} opacity={overlay.opacity} />
  }

  return <SolidOverlay type={overlay.type} opacity={overlay.opacity} />
}

/**
 * Color background
 */
function ColorBackground({ color }) {
  if (!color) return null

  const style = {
    position: 'absolute',
    inset: 0,
    backgroundColor: color,
  }

  return <div className="background-color" style={style} aria-hidden="true" />
}

/**
 * Gradient background
 */
function GradientBackground({ gradient }) {
  if (!gradient) return null

  const {
    start = 'transparent',
    end = 'transparent',
    angle = 0,
    startPosition = 0,
    endPosition = 100,
    startOpacity = 1,
    endOpacity = 1,
  } = gradient

  // Convert colors to rgba if opacity is specified
  const startColor = startOpacity < 1 ? withOpacity(start, startOpacity) : start
  const endColor = endOpacity < 1 ? withOpacity(end, endOpacity) : end

  const style = {
    position: 'absolute',
    inset: 0,
    background: `linear-gradient(${angle}deg, ${startColor} ${startPosition}%, ${endColor} ${endPosition}%)`,
  }

  return <div className="background-gradient" style={style} aria-hidden="true" />
}

/**
 * Convert hex color to rgba with opacity
 */
function withOpacity(color, opacity) {
  // Handle hex colors
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  // Handle rgb/rgba
  if (color.startsWith('rgb')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`
    }
  }
  // Fallback - return as is
  return color
}

/**
 * Image background
 */
function ImageBackground({ image }) {
  if (!image?.src) return null

  const {
    src,
    position = 'center',
    size = 'cover',
    lazy = true,
  } = image

  const style = {
    position: 'absolute',
    inset: 0,
    backgroundImage: `url(${src})`,
    backgroundPosition: position,
    backgroundSize: size,
    backgroundRepeat: 'no-repeat',
  }

  // For lazy loading, we could use an img tag with loading="lazy"
  // But for backgrounds, CSS is more appropriate
  // The lazy prop could be used for future intersection observer optimization

  return <div className="background-image" style={style} aria-hidden="true" />
}

/**
 * Check if user prefers reduced motion
 */
function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Video background
 *
 * Supports multiple source formats with automatic fallback.
 * Respects prefers-reduced-motion by showing poster image instead.
 */
function VideoBackground({ video }) {
  if (!video?.src) return null

  const {
    src,
    sources,      // Array of { src, type } for multiple formats
    poster,
    loop = true,
    muted = true,
  } = video

  // Respect reduced motion preference - show poster image instead
  if (prefersReducedMotion() && poster) {
    return <ImageBackground image={{ src: poster, size: 'cover', position: 'center' }} />
  }

  const style = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  }

  // Build source list: explicit sources array, or infer from src
  const sourceList = sources || inferSources(src)

  return (
    <video
      className="background-video"
      style={style}
      autoPlay
      loop={loop}
      muted={muted}
      playsInline
      poster={poster}
      aria-hidden="true"
    >
      {sourceList.map(({ src: sourceSrc, type }, index) => (
        <source key={index} src={sourceSrc} type={type} />
      ))}
    </video>
  )
}

/**
 * Infer multiple source formats from a single src
 *
 * If given "video.mp4", also tries "video.webm" (better compression)
 * Browser will use first supported format
 */
function inferSources(src) {
  const sources = []
  const ext = src.split('.').pop()?.toLowerCase()
  const basePath = src.slice(0, src.lastIndexOf('.'))

  // Prefer webm (better compression), fall back to original
  if (ext === 'mp4') {
    sources.push({ src: `${basePath}.webm`, type: 'video/webm' })
    sources.push({ src, type: 'video/mp4' })
  } else if (ext === 'webm') {
    sources.push({ src, type: 'video/webm' })
    sources.push({ src: `${basePath}.mp4`, type: 'video/mp4' })
  } else {
    // Single source for other formats
    sources.push({ src, type: getVideoMimeType(src) })
  }

  return sources
}

/**
 * Get video MIME type from URL
 */
function getVideoMimeType(src) {
  if (src.endsWith('.webm')) return 'video/webm'
  if (src.endsWith('.ogg') || src.endsWith('.ogv')) return 'video/ogg'
  return 'video/mp4'
}

/**
 * Background component
 *
 * @param {Object} props
 * @param {string} props.mode - Background mode: 'color', 'gradient', 'image', 'video'
 * @param {string} props.color - Color value (for color mode)
 * @param {Object} props.gradient - Gradient configuration
 * @param {Object} props.image - Image configuration
 * @param {Object} props.video - Video configuration
 * @param {Object} props.overlay - Overlay configuration
 * @param {string} props.className - Additional CSS class
 */
export default function Background({
  mode,
  color,
  gradient,
  image,
  video,
  overlay,
  className = '',
}) {
  // No background to render
  if (!mode) return null

  const containerStyle = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    zIndex: 0,
  }

  return (
    <div
      className={`background background--${mode} ${className}`.trim()}
      style={containerStyle}
      aria-hidden="true"
    >
      {/* Render background based on mode */}
      {mode === MODES.COLOR && <ColorBackground color={color} />}
      {mode === MODES.GRADIENT && <GradientBackground gradient={gradient} />}
      {mode === MODES.IMAGE && <ImageBackground image={image} />}
      {mode === MODES.VIDEO && <VideoBackground video={video} />}

      {/* Overlay on top of background */}
      <Overlay overlay={overlay} />
    </div>
  )
}

/**
 * Export background modes for external use
 */
export { MODES as BackgroundModes }

/**
 * Runtime Shell Entry Point
 *
 * Standalone browser app that boots a Uniweb site from __DATA__ injected
 * by a dynamic backend (unicloud, PHP, etc.).
 *
 * This calls the same start() function that all sites use. When no
 * __FOUNDATION_CONFIG__ is embedded in the page, start() checks for
 * __DATA__ (the dynamic backend protocol) and boots from that.
 *
 * See: kb/plans/runtime-shell-and-cdn.md
 */

import { start } from '../index.jsx'

start({ config: null })

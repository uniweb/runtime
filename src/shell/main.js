/**
 * Runtime Shell Entry Point
 *
 * Standalone browser app that boots a Uniweb site from __DATA__ injected
 * by a dynamic backend (a Uniweb backend, PHP, anything that can render a
 * page shell).
 *
 * This calls the same start() function that all sites use. When no
 * __FOUNDATION_CONFIG__ is embedded in the page, start() checks for
 * __DATA__ (the dynamic backend protocol) and boots from that.
 */

import { start } from '../index.jsx'

start({ config: null })

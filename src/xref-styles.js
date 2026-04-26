/**
 * Cross-reference style catalog.
 *
 * Cross-references are framework-managed (parallel to citestyle's nine
 * citation styles, but framework-internal because there's no CSL-for-
 * xrefs standard). Foundations pick a preset; documents may override
 * per-kind.
 *
 * Each preset is a map from kind name to:
 *   {
 *     label,         // singular label, e.g. "Figure"
 *     labelPlural,   // plural label, e.g. "Figures"
 *     counter,       // 'arabic' | 'hierarchical' | null (no counter)
 *     sep,           // separator between label and counter ("" | " ")
 *   }
 *
 * The catalog ships four presets:
 *   - humanities   (default — "Figure 3", "§3.2", "Equation 1")
 *   - engineering  ("Fig. 3", "Sec. 3.2", "Eq. 1")
 *   - german       ("Abb. 3", "Abschn. 3.2", "Gl. 1")
 *   - plain        (counters only — "3", "3.2", "1")
 *
 * Foundations override the preset by declaring `xref.kinds` in
 * foundation.js (additive: new kinds and overrides for existing kinds).
 * Documents override per-kind via `book.xref.<kind>:` in document.yml.
 */

const HUMANITIES = {
  figure:   { label: 'Figure',   labelPlural: 'Figures',   counter: 'arabic', sep: ' ' },
  equation: { label: 'Equation', labelPlural: 'Equations', counter: 'arabic', sep: ' ' },
  section:  { label: '§',        labelPlural: '§§',        counter: 'hierarchical', sep: '' },
  table:    { label: 'Table',    labelPlural: 'Tables',    counter: 'arabic', sep: ' ' },
}

const ENGINEERING = {
  figure:   { label: 'Fig.',     labelPlural: 'Figs.',     counter: 'arabic', sep: ' ' },
  equation: { label: 'Eq.',      labelPlural: 'Eqs.',      counter: 'arabic', sep: ' ' },
  section:  { label: 'Sec.',     labelPlural: 'Secs.',     counter: 'hierarchical', sep: ' ' },
  table:    { label: 'Tab.',     labelPlural: 'Tabs.',     counter: 'arabic', sep: ' ' },
}

const GERMAN = {
  figure:   { label: 'Abb.',     labelPlural: 'Abb.',      counter: 'arabic', sep: ' ' },
  equation: { label: 'Gl.',      labelPlural: 'Gl.',       counter: 'arabic', sep: ' ' },
  section:  { label: 'Abschn.',  labelPlural: 'Abschn.',   counter: 'hierarchical', sep: ' ' },
  table:    { label: 'Tab.',     labelPlural: 'Tab.',      counter: 'arabic', sep: ' ' },
}

const PLAIN = {
  figure:   { label: '',         labelPlural: '',          counter: 'arabic', sep: '' },
  equation: { label: '',         labelPlural: '',          counter: 'arabic', sep: '' },
  section:  { label: '',         labelPlural: '',          counter: 'hierarchical', sep: '' },
  table:    { label: '',         labelPlural: '',          counter: 'arabic', sep: '' },
}

export const XREF_STYLES = {
  humanities: HUMANITIES,
  engineering: ENGINEERING,
  german: GERMAN,
  plain: PLAIN,
}

export const DEFAULT_XREF_STYLE = 'humanities'

/**
 * Resolve the active xref-style for a document. Reads:
 *   - `book.xrefStyle:` in document config (preset name).
 *   - `book.xref.<kind>:` per-kind overrides on top of the preset.
 *   - Foundation-declared kinds (`foundation.xref.kinds`) extend the
 *     preset with whatever the foundation provides.
 *
 * Returns a plain map keyed by kind name; per-kind values are merged
 * objects (preset + foundation extensions + document overrides).
 */
export function resolveXrefStyle(presetName, config) {
  const preset = XREF_STYLES[presetName] || XREF_STYLES[DEFAULT_XREF_STYLE]
  const merged = { ...preset }

  // Foundation extensions: kinds declared by the foundation (e.g.
  // theorem, lemma, proof for a math foundation).
  const foundationKinds = globalThis.uniweb?.foundationConfig?.xref?.kinds
  if (foundationKinds && typeof foundationKinds === 'object') {
    for (const [kind, meta] of Object.entries(foundationKinds)) {
      merged[kind] = { ...merged[kind], ...meta }
    }
  }

  // Document overrides: `book.xref.<kind>:` granular tweaks.
  const docOverrides = config?.book?.xref || config?.xref || null
  if (docOverrides && typeof docOverrides === 'object') {
    for (const [kind, meta] of Object.entries(docOverrides)) {
      if (meta && typeof meta === 'object') {
        merged[kind] = { ...merged[kind], ...meta }
      }
    }
  }

  return merged
}

export function getKindMeta(style, kind) {
  return style?.[kind] || null
}

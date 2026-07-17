/**
 * Resolves the ordered list of summary field selectors for a content document.
 * Precedence: override config map (by component name) → schema annotations
 * (`_adapt.summary`, ordered by its optional `order`) → `['body', 'instruction']`.
 * @param {Object} schema Built Schema instance (has a walk method)
 * @param {Object} data Content document
 * @param {String} componentName The doc's _component (may be undefined)
 * @param {Object} [summaryFields] Config map of componentName → [selectors]
 * @return {Array<String>} Ordered dot-path selectors; array segments use `[]`
 * @memberof content
 */
export default function resolveSummaryFields (schema, data, componentName, summaryFields = {}) {
  const override = componentName && summaryFields?.[componentName]
  if (Array.isArray(override) && override.length) return override

  const matches = schema.walk(data, field => field?._adapt?.summary)
  if (matches.length) {
    const seen = new Set()
    return matches
      .map(match => ({ selector: pathToSelector(match.path), order: orderOf(match.schemaField) }))
      .sort((a, b) => a.order - b.order)
      .reduce((selectors, { selector }) => {
        if (!seen.has(selector)) {
          seen.add(selector)
          selectors.push(selector)
        }
        return selectors
      }, [])
  }
  return ['body', 'instruction']
}

/**
 * Converts a slash-delimited instance path from Schema.walk (e.g. `_items/0/text`)
 * to a summary selector (`_items[].text`); numeric segments become the `[]` marker.
 */
function pathToSelector (path) {
  return path.split('/').reduce((selector, segment) => {
    if (/^\d+$/.test(segment)) return `${selector}[]`
    return selector ? `${selector}.${segment}` : segment
  }, '')
}

function orderOf (schemaField) {
  const order = schemaField?._adapt?.summary?.order
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER
}

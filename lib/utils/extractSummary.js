import resolveSummaryFields from './resolveSummaryFields.js'
import reduceToCell from './reduceToCell.js'
import inferCellKind from './inferCellKind.js'

const ITEM_FIELD_PRIORITY = ['text', 'title', 'body']

/**
 * Builds the `_summary` cell array for a content document: resolves the ordered
 * selectors, then resolves each against the schema and data into a leaf or
 * collection cell. Selectors reference schema leaves directly (Schema.walk descends
 * through arrays, so it cannot return an array as a single node) — this direct
 * resolution is what surfaces `collection` cells.
 * @param {Object} schema Built Schema instance
 * @param {Object} data Content document
 * @param {String} componentName The doc's _component
 * @param {Object} [summaryFields] Config map of componentName → [selectors]
 * @return {Array<Object>} Ordered summary cells
 * @memberof content
 */
export default function extractSummary (schema, data, componentName, summaryFields = {}) {
  const properties = schema?.built?.properties ?? {}
  return resolveSummaryFields(schema, data, componentName, summaryFields)
    .map(selector => buildCell(selector, properties, data))
    .filter(Boolean)
}

function buildCell (selector, properties, data) {
  if (selector.includes('[]')) return buildCollectionCell(selector, properties, data)
  const keys = selector.split('.')
  const field = resolveField(properties, keys)
  if (inferCellKind(field) === 'collection') return buildCollectionCell(`${selector}[]`, properties, data)
  const value = resolveValue(data, keys)
  if (value === undefined || value === null || value === '') return null
  const cell = reduceToCell(value, field, { label: labelFor(field, keys) })
  cell.field = keys[keys.length - 1]
  return cell
}

function buildCollectionCell (selector, properties, data) {
  const [arrPath, subPath = ''] = selector.split('[]')
  const arrKeys = arrPath.split('.').filter(Boolean)
  const subKeys = subPath.split('.').filter(Boolean)
  const arrField = resolveField(properties, arrKeys)
  const arr = resolveValue(data, arrKeys)
  if (!Array.isArray(arr) || !arr.length) return null

  const itemProps = arrField?.items?.properties ?? {}
  const itemKeys = subKeys.length ? subKeys : pickItemField(itemProps)
  const itemField = itemKeys && resolveField(itemProps, itemKeys)
  const items = itemKeys
    ? arr
      .map(item => {
        const value = resolveValue(item, itemKeys)
        if (value === undefined || value === null || value === '') return null
        return reduceToCell(value, itemField, { leafOnly: true })
      })
      .filter(Boolean)
    : []
  return { kind: 'collection', field: arrKeys[arrKeys.length - 1], label: labelFor(arrField, arrKeys), count: arr.length, items }
}

function resolveField (properties, keys) {
  let field = properties?.[keys[0]]
  for (let i = 1; i < keys.length && field; i++) field = field.properties?.[keys[i]]
  return field
}

function resolveValue (data, keys) {
  return keys.reduce((value, key) => (value == null ? undefined : value[key]), data)
}

function labelFor (field, keys) {
  return field?.title ?? keys[keys.length - 1]
}

function pickItemField (itemProps) {
  const preferred = ITEM_FIELD_PRIORITY.find(key => itemProps[key])
  if (preferred) return [preferred]
  const firstLeaf = Object.keys(itemProps).find(key => {
    const backboneForms = itemProps[key]?._backboneForms
    return itemProps[key]?.type === 'string' || backboneForms?.type === 'Asset' || backboneForms === 'Asset'
  })
  return firstLeaf ? [firstLeaf] : null
}

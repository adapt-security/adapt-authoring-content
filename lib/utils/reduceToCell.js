import inferCellKind from './inferCellKind.js'
import stripText from './stripText.js'

/**
 * Reduces a single (non-array) field value to one summary cell. Asset cells store
 * the id only — the serve URL is deterministic, so the UI builds it. With leafOnly
 * (collection items), non-asset kinds collapse to text so a collection never nests.
 * @param {*} value The field value
 * @param {Object} schemaField Resolved schema field for the value
 * @param {Object} [options]
 * @param {String} [options.label] Cell label
 * @param {Boolean} [options.leafOnly] Coerce non-asset kinds to text
 * @return {Object} A cell: { kind, label?, ...payload }
 * @memberof content
 */
export default function reduceToCell (value, schemaField, { label, leafOnly = false } = {}) {
  let kind = inferCellKind(schemaField)
  if (leafOnly && kind !== 'asset') kind = 'text'
  const cell = { kind }
  if (label) cell.label = label
  switch (kind) {
    case 'asset':
      cell.assetId = value != null ? String(value) : ''
      break
    case 'boolean':
      cell.value = !!value
      break
    case 'number':
      cell.value = value
      break
    default:
      cell.text = stripText(value)
  }
  return cell
}

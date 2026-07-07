/**
 * Infers the summary cell kind for a schema field from its primitives, so new or
 * third-party components fall into an existing kind without per-component logic.
 * @param {Object} schemaField Resolved schema field definition
 * @return {String} One of 'asset' | 'collection' | 'boolean' | 'number' | 'text'
 * @memberof content
 */
export default function inferCellKind (schemaField) {
  const backboneForms = schemaField?._backboneForms
  if (backboneForms?.type === 'Asset' || backboneForms === 'Asset') return 'asset'
  switch (schemaField?.type) {
    case 'array': return 'collection'
    case 'boolean': return 'boolean'
    case 'number':
    case 'integer': return 'number'
    default: return 'text'
  }
}

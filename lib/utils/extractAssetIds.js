/**
 * Extracts unique asset IDs from a content document by walking its schema
 * for Asset-type fields and collecting non-URL values.
 * @param {Object} schema The built Schema instance (must have a walk method)
 * @param {Object} data The data object to search for asset values
 * @return {Array<String>} Unique array of asset IDs found in the data
 * @memberof content
 */
export function extractAssetIds (schema, data) {
  const isAssetField = (field) =>
    field?._backboneForms?.type === 'Asset' || field?._backboneForms === 'Asset'

  return [...new Set(
    schema.walk(data, isAssetField)
      .map(match => match.value?.toString())
      .filter(v => v && !v.startsWith('http://') && !v.startsWith('https://'))
  )]
}

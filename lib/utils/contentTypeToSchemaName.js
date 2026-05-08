/**
 * Maps a content _type to its corresponding schema name.
 * 'page' and 'menu' both map to 'contentobject'; all other types map to themselves.
 * @param {String} _type Content type (e.g. 'page', 'menu', 'article', 'block')
 * @return {String}
 */
export default function contentTypeToSchemaName (_type) {
  return _type === 'page' || _type === 'menu' ? 'contentobject' : _type
}

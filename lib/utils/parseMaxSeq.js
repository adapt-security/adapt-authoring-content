/**
 * Parses friendly ID strings from content docs and returns the highest sequence number.
 * For non-course types the raw number is divided by idInterval to recover the counter value.
 * @param {Array<Object>} docs Array of objects with a `_friendlyId` property
 * @param {String} _type Content type (e.g. 'course', 'block')
 * @param {Number} idInterval Multiplier used for non-course IDs
 * @return {Number}
 */
export default function parseMaxSeq (docs, _type, idInterval) {
  let maxNum = 0
  for (const doc of docs) {
    const match = doc._friendlyId?.match(/(\d+)/)
    if (match) {
      const num = parseInt(match[1])
      if (num > maxNum) maxNum = num
    }
  }
  return _type === 'course' ? maxNum : Math.floor(maxNum / idInterval)
}

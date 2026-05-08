/**
 * Parses friendly ID strings from content docs and returns the highest sequence number.
 * @param {Array<Object>} docs Array of objects with a `_friendlyId` property
 * @return {Number}
 */
export default function parseMaxSeq (docs) {
  let maxNum = 0
  for (const doc of docs) {
    const match = doc._friendlyId?.match(/(\d+)/)
    if (match) {
      const num = parseInt(match[1])
      if (num > maxNum) maxNum = num
    }
  }
  return maxNum
}

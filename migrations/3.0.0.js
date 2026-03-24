export default function (migration) {
  migration.describe('Backfill _friendlyId and _assetIds on existing content documents')
  migration.runCommand(backfillFriendlyIds)
  migration.runCommand(backfillAssetIds)
}

/**
 * Generates _friendlyId for content documents that don't have one.
 * Uses the same format as ContentModule.generateFriendlyIds:
 * - course: "course-{n}" or "course-{n}-{lang}"
 * - config: "config"
 * - page/menu: "p-{n*interval}"
 * - article: "a-{n*interval}"
 * - block: "b-{n*interval}"
 * - component: "c-{n*interval}"
 */
async function backfillFriendlyIds (db) {
  const content = db.collection('content')
  const ID_INTERVAL = 5
  const TYPE_PREFIX = { page: 'p', menu: 'p', article: 'a', block: 'b', component: 'c' }

  const missing = await content.find({
    $or: [
      { _friendlyId: { $exists: false } },
      { _friendlyId: '' }
    ]
  }).toArray()

  if (missing.length === 0) {
    console.log('No content documents missing _friendlyId, skipping')
    return
  }
  console.log(`Backfilling _friendlyId for ${missing.length} document(s)`)

  // Group by _courseId + _type to allocate sequential IDs per group
  const groups = new Map()
  for (const doc of missing) {
    const courseId = doc._courseId?.toString() ?? 'none'
    const type = doc._type
    const key = `${courseId}:${type}`
    if (!groups.has(key)) groups.set(key, { courseId, type, docs: [] })
    groups.get(key).docs.push(doc)
  }

  for (const { courseId, type, docs } of groups.values()) {
    if (type === 'config') {
      for (const doc of docs) {
        await content.updateOne({ _id: doc._id }, { $set: { _friendlyId: 'config' } })
      }
      continue
    }

    // Find the current max sequence number for this type+course
    const prefix = TYPE_PREFIX[type]
    const isCourse = type === 'course'
    const query = {
      _type: type,
      _friendlyId: { $exists: true, $ne: '' }
    }
    if (!isCourse && courseId !== 'none') {
      query._courseId = docs[0]._courseId
    }

    const existing = await content.find(query, { projection: { _friendlyId: 1 } }).toArray()
    let maxSeq = 0
    for (const doc of existing) {
      const match = doc._friendlyId?.match(/(\d+)/)
      if (match) {
        const num = parseInt(match[1])
        const seq = isCourse ? num : Math.floor(num / ID_INTERVAL)
        if (seq > maxSeq) maxSeq = seq
      }
    }

    let nextSeq = maxSeq + 1
    for (const doc of docs) {
      let friendlyId
      if (isCourse) {
        friendlyId = doc._language ? `course-${nextSeq}-${doc._language}` : `course-${nextSeq}`
      } else {
        friendlyId = `${prefix}-${nextSeq * ID_INTERVAL}`
      }
      await content.updateOne({ _id: doc._id }, { $set: { _friendlyId: friendlyId } })
      nextSeq++
    }
  }
  console.log(`Backfilled _friendlyId for ${missing.length} document(s)`)
}

/**
 * Populates _assetIds on content documents by scanning for asset-type values.
 * Uses a simple string-match approach against the assets collection rather than
 * schema traversal, since schemas are not available during migration.
 */
async function backfillAssetIds (db) {
  const content = db.collection('content')
  const assets = db.collection('assets')

  const docsToUpdate = await content.find({
    $or: [
      { _assetIds: { $exists: false } },
      { _assetIds: null }
    ]
  }).toArray()

  if (docsToUpdate.length === 0) {
    console.log('No content documents missing _assetIds, skipping')
    return
  }

  // Build a set of all asset ID strings for fast lookup
  const assetIds = await assets.distinct('_id')
  const assetIdStrings = assetIds.map(id => id.toString())

  if (assetIdStrings.length === 0) {
    // No assets in the DB — set all to empty array
    await content.updateMany(
      { $or: [{ _assetIds: { $exists: false } }, { _assetIds: null }] },
      { $set: { _assetIds: [] } }
    )
    console.log(`Set _assetIds to [] for ${docsToUpdate.length} document(s) (no assets in DB)`)
    return
  }

  console.log(`Backfilling _assetIds for ${docsToUpdate.length} document(s) against ${assetIdStrings.length} known asset(s)`)

  let updated = 0
  const ops = []
  for (const doc of docsToUpdate) {
    const docStr = JSON.stringify(doc)
    const foundIds = assetIdStrings.filter(id => docStr.includes(id))
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { _assetIds: foundIds } }
      }
    })
    if (ops.length >= 500) {
      await content.bulkWrite(ops, { ordered: false })
      updated += ops.length
      ops.length = 0
    }
  }
  if (ops.length > 0) {
    await content.bulkWrite(ops, { ordered: false })
    updated += ops.length
  }
  console.log(`Backfilled _assetIds for ${updated} document(s)`)
}

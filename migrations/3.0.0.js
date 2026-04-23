import { ObjectId } from 'mongodb'
import formatFriendlyId from '../lib/utils/formatFriendlyId.js'
import parseMaxSeq from '../lib/utils/parseMaxSeq.js'

export default function (migration) {
  migration.describe('Backfill _friendlyId and _assetIds on existing content documents')
  migration.runCommand(backfillFriendlyIds)
  migration.runCommand(backfillAssetIds)
}

async function backfillFriendlyIds (db, log) {
  const content = db.collection('content')

  const missing = await content.find({
    $or: [
      { _friendlyId: { $exists: false } },
      { _friendlyId: '' }
    ]
  }).toArray()

  if (missing.length === 0) {
    log('info', 'migrations', 'No content documents missing _friendlyId, skipping')
    return
  }
  log('info', 'migrations', `Backfilling _friendlyId for ${missing.length} document(s)`)

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
        await content.updateOne({ _id: doc._id }, { $set: { _friendlyId: formatFriendlyId('config') } })
      }
      continue
    }

    const isCourse = type === 'course'
    const query = {
      _type: type,
      _friendlyId: { $exists: true, $ne: '' }
    }
    if (!isCourse && courseId !== 'none') {
      query._courseId = docs[0]._courseId
    }

    const existing = await content.find(query, { projection: { _friendlyId: 1 } }).toArray()
    const maxSeq = parseMaxSeq(existing)

    let nextSeq = maxSeq + 1
    for (const doc of docs) {
      const friendlyId = formatFriendlyId(type, nextSeq, doc._language)
      await content.updateOne({ _id: doc._id }, { $set: { _friendlyId: friendlyId } })
      nextSeq++
    }
  }
  log('info', 'migrations', `Backfilled _friendlyId for ${missing.length} document(s)`)
}

async function backfillAssetIds (db, log) {
  const content = db.collection('content')
  const assets = db.collection('assets')

  const docsToUpdate = await content.find({
    $or: [
      { _assetIds: { $exists: false } },
      { _assetIds: null }
    ]
  }).toArray()

  if (docsToUpdate.length === 0) {
    log('info', 'migrations', 'No content documents missing _assetIds, skipping')
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
    log('info', 'migrations', `Set _assetIds to [] for ${docsToUpdate.length} document(s) (no assets in DB)`)
    return
  }

  log('info', 'migrations', `Backfilling _assetIds for ${docsToUpdate.length} document(s) against ${assetIdStrings.length} known asset(s)`)

  let updated = 0
  const ops = []
  for (const doc of docsToUpdate) {
    const docStr = JSON.stringify(doc)
    const foundIds = assetIdStrings
      .filter(id => docStr.includes(id))
      .map(id => new ObjectId(id))
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
  log('info', 'migrations', `Backfilled _assetIds for ${updated} document(s)`)
}

import { App } from 'adapt-authoring-core'

export default function (migration) {
  migration.describe('Backfill _summary on existing component documents')
  migration.runCommand(backfillSummary)
}

async function backfillSummary (db, log) {
  const content = await App.instance.waitForModule('content')
  const components = await db.collection('content')
    .find({ _type: 'component', $or: [{ _summary: { $exists: false } }, { _summary: null }] })
    .toArray()
  if (!components.length) {
    log('info', 'migrations', 'No component documents missing _summary, skipping')
    return
  }
  log('info', 'migrations', `Backfilling _summary for ${components.length} component(s)`)

  const collection = db.collection('content')
  const ops = []
  let failed = 0
  for (const doc of components) {
    let summary = []
    try {
      summary = await content.computeSummary(doc)
    } catch (e) {
      failed++
      log('warn', 'migrations', `Could not compute _summary for ${doc._id}, set to []: ${e.message}`)
    }
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { _summary: summary } } } })
    if (ops.length >= 500) {
      await collection.bulkWrite(ops, { ordered: false })
      ops.length = 0
    }
  }
  if (ops.length) await collection.bulkWrite(ops, { ordered: false })

  log('info', 'migrations', `Backfilled _summary for ${components.length - failed} component(s)`)
  if (failed) log('warn', 'migrations', `${failed} component(s) could not be summarised and were set to []`)
}

export default function (migration) {
  migration.describe('Add an empty _summary array to existing component documents')
  migration.runCommand(floorSummary)
}

// Migrations run during boot with only a raw db handle — the per-component schema
// resolution needed to compute real summaries is not available here (waiting on a
// module deadlocks boot). So this only floors the field to []; accurate summaries
// are computed at write time (ContentModule.computeSummary) the next time each
// component is edited.
async function floorSummary (db, log) {
  const content = db.collection('content')
  const filter = { _type: 'component', $or: [{ _summary: { $exists: false } }, { _summary: null }] }
  const count = await content.countDocuments(filter)
  if (!count) {
    log('info', 'migrations', 'No component documents missing _summary, skipping')
    return
  }
  await content.updateMany(filter, { $set: { _summary: [] } })
  log('info', 'migrations', `Floored _summary to [] on ${count} component(s); real values compute on next edit`)
}

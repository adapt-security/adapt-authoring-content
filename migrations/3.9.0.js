import stripText from '../lib/utils/stripText.js'

export default function (migration) {
  migration.describe('Backfill _summary (body + instruction) on existing container content documents')
  migration.runCommand(backfillContainerSummaries)
}

// Containers (page/article/block/menu/course) gained a display summary — the same
// `['body', 'instruction']` default the live write path now applies to every type.
// Migrations run against a bare mongo connection with no schema module, but a
// container carries no schema summary annotations, so a direct body+instruction
// build matches the pipeline output exactly. Components are left untouched: their
// stored _summary is already correct for their schema and picks up the new
// instruction default on next edit (recomputing them would need schemas we lack here).
async function backfillContainerSummaries (db, log) {
  const content = db.collection('content')
  const docs = await content
    .find(
      {
        _type: { $nin: ['component', 'config'] },
        $or: [
          { body: { $type: 'string', $ne: '' } },
          { instruction: { $type: 'string', $ne: '' } }
        ]
      },
      { projection: { _id: 1, body: 1, instruction: 1 } }
    )
    .toArray()
  if (!docs.length) {
    log('info', 'migrations', 'No container documents with body/instruction found, skipping')
    return
  }

  const ops = docs
    .map(doc => ({ _id: doc._id, cells: buildCells(doc) }))
    .filter(({ cells }) => cells.length)
    .map(({ _id, cells }) => ({ updateOne: { filter: { _id }, update: { $set: { _summary: cells } } } }))

  for (let i = 0; i < ops.length; i += 500) {
    await content.bulkWrite(ops.slice(i, i + 500), { ordered: false })
  }
  log('info', 'migrations', `backfilled _summary on ${ops.length} container document(s)`)
}

function buildCells (doc) {
  return [['body', 'Body'], ['instruction', 'Instruction']]
    .map(([field, label]) => {
      const text = stripText(doc[field])
      return text ? { kind: 'text', field, label, text } : null
    })
    .filter(Boolean)
}

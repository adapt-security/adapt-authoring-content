import { ObjectId } from 'mongodb'

export default function (migration) {
  migration.describe('Normalise content._shareWithUsers entries to ObjectId form')
  migration.runCommand(normaliseShareWithUsers)
}

async function normaliseShareWithUsers (db, log) {
  const content = db.collection('content')
  const docs = await content
    .find({ _shareWithUsers: { $elemMatch: { $type: 'string' } } }, { projection: { _id: 1, _shareWithUsers: 1 } })
    .toArray()
  if (!docs.length) {
    log('info', 'migrations', 'No content documents with string _shareWithUsers entries, skipping')
    return
  }

  const ops = []
  let unconvertible = 0
  for (const doc of docs) {
    const next = []
    for (const u of doc._shareWithUsers) {
      if (u instanceof ObjectId) {
        next.push(u)
      } else if (typeof u === 'string' && ObjectId.isValid(u)) {
        next.push(new ObjectId(u))
      } else {
        next.push(u)
        unconvertible++
      }
    }
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { _shareWithUsers: next } } } })
  }

  for (let i = 0; i < ops.length; i += 500) {
    await content.bulkWrite(ops.slice(i, i + 500), { ordered: false })
  }
  log('info', 'migrations', `normalised _shareWithUsers on ${docs.length} content document(s)`)
  if (unconvertible) log('warn', 'migrations', `${unconvertible} _shareWithUsers entr(ies) could not be coerced to ObjectId and were left as-is`)
}

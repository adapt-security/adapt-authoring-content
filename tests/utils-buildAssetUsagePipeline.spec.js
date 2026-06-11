import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import buildAssetUsagePipeline from '../lib/utils/buildAssetUsagePipeline.js'

const GROUP = { $group: { _id: '$_assetIds', courses: { $addToSet: '$_courseId' } } }
const PROJECT = { $project: { courseCount: { $size: '$courses' } } }

describe('buildAssetUsagePipeline', () => {
  for (const [name, input] of [
    ['no argument', undefined],
    ['null', null],
    ['empty array', []]
  ]) {
    it(`counts all assets when given ${name} (no $match, single $unwind)`, () => {
      const pipeline = buildAssetUsagePipeline(input)
      assert.deepEqual(pipeline, [
        { $unwind: '$_assetIds' },
        GROUP,
        PROJECT
      ])
      assert.equal(pipeline.filter(s => s.$match).length, 0)
    })
  }

  it('scopes with a $match before and after $unwind when asset ids are given', () => {
    const ids = ['id-a', 'id-b']
    const pipeline = buildAssetUsagePipeline(ids)
    const expectedMatch = { $match: { _assetIds: { $in: ids } } }
    assert.deepEqual(pipeline, [
      expectedMatch,
      { $unwind: '$_assetIds' },
      expectedMatch,
      GROUP,
      PROJECT
    ])
  })

  it('places the pre-$unwind $match first so the _assetIds index can be used', () => {
    const pipeline = buildAssetUsagePipeline(['id-a'])
    assert.ok(pipeline[0].$match, 'first stage should be a $match')
    assert.equal(pipeline[1].$unwind, '$_assetIds')
  })

  it('counts distinct courses (uses $addToSet on _courseId, not a document count)', () => {
    const group = buildAssetUsagePipeline().find(s => s.$group)
    assert.deepEqual(group.$group.courses, { $addToSet: '$_courseId' })
  })
})

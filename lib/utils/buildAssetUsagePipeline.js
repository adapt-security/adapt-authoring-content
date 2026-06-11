/**
 * Builds the aggregation pipeline that counts, per asset, how many distinct courses reference it.
 *
 * Operates on the content collection's indexed `_assetIds` field (maintained on every content
 * insert/update). The leading `$match` lets the query use the `_assetIds` index when scoped; the
 * post-`$unwind` `$match` discards the other asset ids carried by matched documents so only the
 * requested assets remain. Counting distinct `_courseId` via `$addToSet` (rather than documents)
 * means an asset referenced by many content items within one course still counts as one course.
 *
 * Pure helper extracted from {@link ContentModule#handleAssetUsage} so it can be unit-tested without
 * booting the app. Asset ids must already be coerced to ObjectId — `getCollection().aggregate()` is
 * the raw driver and does not normalise ObjectId strings the way the module query layer does.
 *
 * @param {Array} [assetIds] Asset ObjectIds to scope the counts to. Omit/empty to count all assets.
 * @returns {Array<Object>} Aggregation pipeline producing `{ _id: <assetId>, courseCount }` rows
 * @memberof content
 */
export default function buildAssetUsagePipeline (assetIds) {
  const match = Array.isArray(assetIds) && assetIds.length > 0
    ? { $match: { _assetIds: { $in: assetIds } } }
    : null
  return [
    ...(match ? [match] : []),
    { $unwind: '$_assetIds' },
    ...(match ? [match] : []),
    { $group: { _id: '$_assetIds', courses: { $addToSet: '$_courseId' } } },
    { $project: { courseCount: { $size: '$courses' } } }
  ]
}

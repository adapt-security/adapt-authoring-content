/**
 * Partitions a course's asset ids into those safe to delete alongside the course and those that must
 * be kept. `courseCounts` maps an asset id to the number of distinct courses referencing it (from the
 * asset-usage aggregation). An id used by more than one course is `shared` (kept); anything else —
 * used only by this course, or absent from the map — is `deletable`.
 * @param {Array<String>} assetIds Asset ids referenced by the course being deleted
 * @param {Object<String, Number>} courseCounts Map of asset id to distinct-course count
 * @return {{ deletable: Array<String>, shared: Array<String> }}
 * @memberof content
 */
export default function partitionCourseAssets (assetIds, courseCounts = {}) {
  const deletable = []
  const shared = []
  for (const id of assetIds) {
    ;((courseCounts[id] ?? 0) > 1 ? shared : deletable).push(id)
  }
  return { deletable, shared }
}

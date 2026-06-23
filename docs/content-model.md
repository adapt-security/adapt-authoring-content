# Content model

`adapt-authoring-content` stores every piece of authored course content as a flat
collection of documents (`collectionName = 'content'`). It extends
`AbstractApiModule`, so it inherits standard REST CRUD plus the access/hook
machinery, and layers on the tree structure, friendly IDs, asset indexing and
build-time validation described here.

Source: `lib/ContentModule.js`, `lib/ContentTree.js`, `lib/utils/*`.

## Hierarchy

Content forms a tree whose nodes are distinguished by `_type`:

```
course
├── config            (one per course, a childless sibling — not a tree child)
├── menu              (optional; a menu can nest pages/menus)
└── page
    └── article
        └── block
            └── component   (leaf node)
```

The recursive scaffold order is hard-coded in `insertRecursive`
(`ContentModule.js`):

```js
['course', 'page', 'article', 'block', 'component']
```

`menu` is inserted as a special case (when `req.body._type === 'menu'`); `config`
replaces `course` in the chain when a new course is created.

Every `_type` maps to a JSON schema via `contentTypeToSchemaName`
(`lib/utils/contentTypeToSchemaName.js`): `page` and `menu` both resolve to
`contentobject`; all other types map to a schema of the same name. A `component`
is special — its schema is derived from its plugin's `targetAttribute`
(see `getSchemaName`), e.g. `adapt-contrib-text` → `text-component`.

## Linking fields

Items are joined by ID references, not nesting:

- `_parentId` — the immediate parent item. `config` has none; `course` has none.
- `_courseId` — the owning course. Set on every descendant. A `course` document
  gets its own `_id` written back as `_courseId` after insert (see `insert`),
  so a single `{ _courseId }` query returns the whole course incl. the course doc.

Indexes built in `init` reflect the common access paths:

```js
{ _courseId: 1, _parentId: 1, _type: 1 }
{ _parentId: 1 }
{ _type: 1, _courseId: 1 }
{ _assetIds: 1 }
{ _courseId: 1, _friendlyId: 1 }   // unique, partial (string & non-empty)
```

## ContentTree

`lib/ContentTree.js` is a pure, DB-free structure over a flat array of items
(one course's worth). It builds O(1) lookup maps on construction (`byId`,
`byParent`, `byType`) and exposes `course`/`config` directly. It runs on both
server and client.

Key methods:

| Method | Returns |
| --- | --- |
| `getById(id)` | item, O(1) |
| `getChildren(parentId)` | direct children, O(1) |
| `getByType(type)` | all items of a type, O(1) |
| `getDescendants(rootId)` | all descendants (BFS), O(n) |
| `getAncestors(itemId)` | parent chain upward, O(depth) |
| `getSiblings(itemId)` | siblings excluding self |
| `getEmptyContainers()` | childless non-`component`/non-`config` items |
| `isReachable(itemId)` | whether the `_parentId` chain ends at the course root |
| `getUnreachableItems()` | orphans — items whose chain never reaches the course |
| `getComponentNames()` | unique `_component` values in the course |

`getUnreachableItems` returns `[]` when the tree has no `course` node (reachability
is undecidable without a root).

The module builds a `ContentTree` internally for delete, clone, sort-order and
plugin-list maintenance — anywhere it needs the whole course in memory.

## Tree endpoint

`GET /api/content/tree/:_courseId` (`handleTree`, `routes.json`) returns a
lightweight projection of every item in a course for rendering tree/list views
without fetching full documents. Permission: `read:content`.

Projected fields (`treeFields` in `handleTree`):

```
_id, _parentId, _courseId, _type, _sortOrder, title, displayTitle,
_friendlyId, _component, _layout, _menu, _theme, _enabledPlugins,
_colorLabel, _language, heroImage, updatedAt
```

Each returned item also carries a `_children` array of child `_id`s, computed
from the in-memory tree.

Caching is via a **weak ETag**, not `Last-Modified` (despite the `routes.json`
OpenAPI `meta` still describing `If-Modified-Since`). `treeEtag`
(`lib/utils/treeEtag.js`) folds the course `updatedAt` and a hash of the
projected field list together, so the cache busts both when the course changes
*and* when the response shape changes — a field added to the projection won't
stay missing for unedited courses. If `If-None-Match` matches, the handler
returns `304`.

The course `updatedAt` is bumped on any descendant change via `touchCourse`,
tapped into `postInsertHook`/`postUpdateHook`/`postDeleteHook` (`init`). The
handler also enforces course-level access itself (owner / `_isShared` /
`_shareWithUsers` / shared group), returning `404` rather than `403` so it
doesn't leak existence; supers are exempt.

## CRUD, scaffold, clone, reorder

### insert
On insert (`insert`): `validateParent` runs first — a `_parentId` that doesn't
resolve to an existing item in the same course throws `INVALID_PARENT` (400),
which stops orphans being created by a delete/insert race or a stale client
reference. Then a `_friendlyId` is generated if absent, `_assetIds` is
computed if absent, and `super.insert` runs. A new `course` gets its `_courseId`
written back. Otherwise `updateSortOrder` and `updateEnabledPlugins` run unless
disabled via the `updateSortOrder: false` / `updateEnabledPlugins: false`
options. A duplicate-key error is rethrown as `DUPL_FRIENDLY_ID` (409).
`update` applies the same `validateParent` check when a write reparents an item
(`_parentId` present in the update data).

### insertRecursive
`POST /api/content/insertrecursive` (`handleInsertRecursive` → `insertRecursive`)
bootstraps a parent plus all required children in one call. With no `rootId` it
creates a course (+ config + a default page/article/block/text-component);
with a `rootId` it fills in the missing descendant types below that parent.
Defaults (titles, the default `adapt-contrib-text` component body) are pulled
from langpack strings via `req.translate('app.…')`. On any failure all
just-created items are rolled back. Sort-order/plugin side effects run once for
the topmost new item.

### clone
`POST /api/content/clone` (`handleClone` → `clone`) duplicates an item and all
descendants in a single bulk `insertMany`. It pre-generates new `ObjectId`s
(old→new map), remaps `_parentId`/`_courseId`, bulk-allocates friendly IDs per
type, then fires `preInsertHook`/`postInsertHook` per payload and
`preCloneHook`/`postCloneHook` per item. Cloning a `course` also clones its
`config`. `clone` accepts `_parentId` for re-homing; an invalid parent throws
`INVALID_PARENT`.

Clone-specific hooks (created in `init`):

- `preCloneHook` — mutable; invoked per source item before cloning.
- `postCloneHook` — invoked per item with `(originalItem, newDoc)`.

### delete
`delete` cascades: it builds the course tree, collects `getDescendants`, bulk-
deletes them via raw mongodb (avoiding per-item hook storms), deletes the target
via `super.delete` (to trigger delete middleware), then invokes `postDeleteHook`
once with the full descendants list. Deleting a `course` also removes its
`config` and its friendly-ID counters (`deleteCounters`). Sort-order and the
course plugin list are recalculated afterwards.

### Reordering — `_sortOrder`
Siblings under one parent are ordered by an integer `_sortOrder` starting at 1.
`updateSortOrder` re-fetches siblings sorted by `_sortOrder` and delegates to
`computeSortOrderOps` (`lib/utils/computeSortOrderOps.js`), which splices the
moved/inserted item to its target index and emits the minimal set of
`updateOne` ops to renumber. `course` and `config` (and any parentless item)
are exempt. On `update`, sort recalculation only runs when `_sortOrder` or
`_parentId` is in the update data.

## `_friendlyId`

A human-readable per-course identifier (`formatFriendlyId`,
`lib/utils/formatFriendlyId.js`):

- `course` → `course-<n>` (with `-<language>` suffix when `_language` is given)
- `config` → `config`
- everything else → `<first-letter-of-type>-<n>`, e.g. `p-3`, `b-12`, `c-40`

IDs are unique per course (enforced by the partial unique index above).
Sequence numbers come from an atomic counter collection
(`contentcounters`, keyed `{ _type, _courseId }`). `generateFriendlyIds`
reserves a range in one `$inc`, seeding the counter from existing content
(`findMaxSeq` → `parseMaxSeq`, which extracts the numeric part of existing IDs)
on first use.

## `_assetIds`

Each content document carries `_assetIds`: the unique IDs of assets it
references. The field is added by extending the `content` schema with
`contentassets` (`schema/contentassets.schema.json`; `editorOnly`, hidden in
the UI), wired in `init` via `jsonschema.extendSchema('content', 'contentassets')`.

`computeAssetIds` → `extractAssetIds` (`lib/utils/extractAssetIds.js`) walks the
item's built schema for `_backboneForms` `Asset`-type fields and collects their
non-URL values. `_assetIds` is computed on insert and **recomputed on every
update** from the full merged document (stored as `ObjectId`s to match query
coercion).

Two consumers:

- `assets.preDeleteHook` → `enforceAssetNotInUse`: refuses to delete an asset
  still referenced by content, throwing `RESOURCE_IN_USE` with the affected
  course titles.
- `POST /api/content/assetusage` (`handleAssetUsage`): returns a map of asset
  `_id` → distinct-course count, via `buildAssetUsagePipeline`
  (`lib/utils/buildAssetUsagePipeline.js`). An optional `assetIds` body array
  scopes the counts; assets with no usage are omitted. Counting distinct
  `_courseId` (`$addToSet`) means many references within one course count once.

## `_enabledPlugins`

The course `config` document holds `_enabledPlugins` — the list of content
plugins (components, the menu, the theme, extensions) in use. `updateEnabledPlugins`
recomputes it from the tree's component names plus `config._menu`/`config._theme`,
preserving existing extensions. When new plugins are added it re-validates the
affected content types (`menu`/`page` for `contentobject`-targeted schemas) to
apply their schema defaults. It runs on insert/clone and on updates that touch
`_component`, `_menu`, `_theme` or `_enabledPlugins`.

`getSchema` reads `config._enabledPlugins` for the course so it only merges the
schemas of enabled plugins; built schemas are cached per
`schemaName + enabledPlugins` key (`_schemaCache`), cleared on
`jsonschema.registerSchemasHook`.

## Build-time validation

When `adaptframework` is available, the module taps its `preBuildHook` with
`enforceNoEmptyContainers` (`init`). This builds a `ContentTree` for the course
(via the same flat `_courseId` query the build itself uses) and:

1. **Prunes orphans.** `getUnreachableItems()` returns items whose `_parentId`
   chain never reaches the course root — left behind by an interrupted delete,
   invisible in the editor (which only renders the reachable tree) yet still
   carried into the build, where they break it. These are deleted and the count
   is recorded on `build.prunedOrphans` so the caller can surface it; a `warn`
   is logged with the pruned `_id`s.
2. **Blocks on genuine gaps.** Among the remaining reachable items, any
   non-`component`, non-`config` container with no children (an empty
   page/article/block, or empty menu/course) throws `EMPTY_CONTAINERS` (400).
   The error data lists each offending item's `_id`, `_type`, `title` and
   `_parentId`.

`content` depends on `adaptframework`'s hook (not vice-versa), so the tap is
deferred via `waitForModule(...).then(...)` rather than awaited in `init`.

## Configuration

`conf/config.schema.json` exposes only pagination options (inherited API
behaviour); there are no content-domain config keys:

```json
{
  "defaultPageSize": { "type": "number", "default": 500 },
  "maxPageSize":     { "type": "number", "default": 500 }
}
```

## Errors

`errors/errors.json`: `INVALID_PARENT` (400), `DUPL_FRIENDLY_ID` (409),
`RESOURCE_IN_USE` (400), `EMPTY_CONTAINERS` (400).

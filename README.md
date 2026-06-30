# adapt-authoring-content

Manages Adapt course content. Exposes the REST API for the content hierarchy — course > page > article > block > component — with documents linked by `_parentId` and `_courseId`.

Extends `AbstractApiModule` from [adapt-authoring-core](../adapt-authoring-core); content documents are stored via the mongodb module and validated against the relevant content schemas.

## Documentation

- [Content model](docs/content-model.md) — the content hierarchy and how documents relate

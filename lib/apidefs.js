export default {
  clone: {
    post: {
      summary: 'Clones a content item',
      description: 'Duplicates a content item as well as all its children.',
      responses: {
        201: {
          description: 'The newly cloned data',
          content: {
            'application/json': {
              schema: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'array',
                items: { $ref: '#components/schemas/content' }
              }
            }
          }
        }
      }
    }
  },
  insertrecursive: {
    post: {
      summary: 'Insert hierarchical content data',
      description: 'Recursively inserts content data',
      parameters: [{ name: 'rootId', in: 'path', description: 'The parent content item _id', required: true }],
      requestBody: {
        content: {
          'application/json': {
            schema: { $ref: '#components/schemas/content' }
          }
        }
      },
      responses: {
        201: {
          description: 'The newly inserted data',
          content: {
            'application/json': {
              schema: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'array',
                items: { $ref: '#components/schemas/content' }
              }
            }
          }
        }
      }
    }
  }
}

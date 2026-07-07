import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import inferCellKind from '../lib/utils/inferCellKind.js'

describe('inferCellKind()', () => {
  const cases = [
    ['asset from _backboneForms.type', { _backboneForms: { type: 'Asset' } }, 'asset'],
    ['asset from _backboneForms string', { _backboneForms: 'Asset' }, 'asset'],
    ['collection from array type', { type: 'array' }, 'collection'],
    ['boolean from boolean type', { type: 'boolean' }, 'boolean'],
    ['number from number type', { type: 'number' }, 'number'],
    ['number from integer type', { type: 'integer' }, 'number'],
    ['text from string type', { type: 'string' }, 'text'],
    ['text from enum (folds into text)', { type: 'string', enum: ['a', 'b'] }, 'text'],
    ['text for unknown type', { type: 'weird' }, 'text'],
    ['text for undefined field', undefined, 'text'],
    ['asset wins over array type', { type: 'array', _backboneForms: { type: 'Asset' } }, 'asset']
  ]
  for (const [name, field, expected] of cases) {
    it(name, () => assert.equal(inferCellKind(field), expected))
  }
})

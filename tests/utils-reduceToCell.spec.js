import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import reduceToCell from '../lib/utils/reduceToCell.js'

describe('reduceToCell()', () => {
  it('builds an asset cell storing the id only', () => {
    assert.deepEqual(
      reduceToCell('abc123', { _backboneForms: 'Asset' }),
      { kind: 'asset', assetId: 'abc123' }
    )
  })

  it('builds a boolean cell', () => {
    assert.deepEqual(reduceToCell(1, { type: 'boolean' }), { kind: 'boolean', value: true })
  })

  it('builds a number cell preserving the value', () => {
    assert.deepEqual(reduceToCell(7, { type: 'number' }), { kind: 'number', value: 7 })
  })

  it('builds a text cell with HTML stripped', () => {
    assert.deepEqual(reduceToCell('<p>hi</p>', { type: 'string' }), { kind: 'text', text: 'hi' })
  })

  it('includes a label when supplied', () => {
    assert.deepEqual(
      reduceToCell('hi', { type: 'string' }, { label: 'Body' }),
      { kind: 'text', label: 'Body', text: 'hi' }
    )
  })

  it('leafOnly coerces a number to a text cell', () => {
    assert.deepEqual(reduceToCell(7, { type: 'number' }, { leafOnly: true }), { kind: 'text', text: '7' })
  })

  it('leafOnly keeps assets as assets', () => {
    assert.deepEqual(
      reduceToCell('a1', { _backboneForms: 'Asset' }, { leafOnly: true }),
      { kind: 'asset', assetId: 'a1' }
    )
  })
})

export default class MockAdaptError extends Error {
  constructor (code) {
    super(code)
    this.code = code
    this.meta = { description: code }
  }

  setData (data) { this.data = data; return this }
}

export function mockErrors (codes = []) {
  return Object.fromEntries(codes.map(code => [code, new MockAdaptError(code)]))
}

import { describe, expect, test } from 'vitest'
import { es } from './index.mjs'

describe('plain, directly evaluated ECMAScript', () => {
  test('primitives are returned as-is', () => {
    expect(es('null')).toBe(null)
    expect(es('undefined')).toBe(undefined)
    expect(es('1')).toBe(1)
    expect(es('"hello"')).toBe('hello')
    expect(es('true')).toBe(true)
    expect(es('[]')).toEqual([])
    expect(es('{}')).toEqual({})
  })
})

describe('Whitelisting', () => {
  test('Standard APIs are not available unless whitelisted', () => {
    expect(() => es('JSON.stringify(null)')).toThrow(TypeError)
    expect(es('JSON.stringify(null)', { whitelist: ['JSON'] })).toBe('null')
  })
})

describe('Function binding', () => {
  test('User defined this arg can be passed, defaulting to empty object', () => {
    expect(es('this')).toEqual({})
    expect(es('this', { thisArg: { a: 1 } })).toEqual({ a: 1 })
  })
  test("User defined this arg can't be null or undefined", () => {
    expect(es('this', { thisArg: null })).toEqual({})
    expect(es('this', { thisArg: undefined })).toEqual({})
    expect(es('this', { thisArg: [][1] })).toEqual({}) // no tricks possible?
    expect(es('this', { thisArg: false })).toEqual(new Boolean(false)) // no fallbacks on nullish
  })
})

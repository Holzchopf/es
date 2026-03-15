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

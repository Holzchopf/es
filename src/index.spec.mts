import { describe, expect, test } from 'vitest'
import { ES, es, STANDARD_ECMASCRIPT } from './index.mjs'

describe('Simple expressions using built-in features only', () => {
  test('primitives are returned as-is', () => {
    expect(es('null')).toBe(null)
    expect(es('undefined')).toBe(undefined)
    expect(es('1')).toBe(1)
    expect(es('"hello"')).toBe('hello')
    expect(es('true')).toBe(true)
    expect(es('[]')).toEqual([])
    expect(es('{}')).toEqual({})
  })
  test('arithmetics return value', () => {
    expect(es('1+1')).toBe(2)
  })
  test('operators return value', () => {
    expect(es('typeof null')).toBe('object')
  })
})

describe('Whitelisting', () => {
  test('Standard APIs are not available unless whitelisted', () => {
    expect(() => es('JSON.stringify(null)')).toThrow(TypeError)
    expect(es('JSON.stringify(null)', { whitelist: ['JSON'] })).toBe('null')
    expect(es('JSON.stringify(null)', { whitelist: STANDARD_ECMASCRIPT })).toBe(
      'null',
    )
  })
})

describe('Custom APIs', () => {
  test('Custom APIs can be provided', () => {
    const myAPI = { trigger: () => 42 }
    expect(es('myAPI.trigger()', { customAPIs: { myAPI } })).toBe(42)
  })
  test('Custom APIs override whitelisted APIs', () => {
    const myJSON = { stringify: (_arg: unknown) => 42 }
    expect(
      es('JSON.stringify(2)', {
        whitelist: ['JSON'],
        customAPIs: { JSON: myJSON },
      }),
    ).toBe(42)
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

describe('Prepared es', () => {
  test('prepared es returns same value as directly invoked es', () => {
    const str = '1337 + 1'
    const prepared = new ES(str)
    expect(prepared.execute()).toBe(es(str))
  })
  test('prepared es can be invoked with new argValues', () => {
    const prepared = new ES('`hello ${who}${punctuation}`', {
      args: { who: 'world', punctuation: '!' },
    })
    // fall-back to defaults
    expect(prepared.execute()).toBe('hello world!')
    // override
    expect(prepared.execute({ args: { who: 'updog' } })).toBe('hello updog!')
    expect(prepared.execute({ argValues: ['cat'] })).toBe('hello cat!')
    // no fall-back to defaults where value explicitly set to undefined
    expect(prepared.execute({ args: { who: undefined } })).toBe(
      'hello undefined!',
    )
    expect(prepared.execute({ argValues: [undefined] })).toBe(
      'hello undefined!',
    )
    // named arguments don't mess up order
    expect(
      prepared.execute({ argNames: ['punctuation'], argValues: ['...'] }),
    ).toBe('hello world...')
    // fall-back again to check nothing was overwritten in prepared object
    expect(prepared.execute()).toBe('hello world!')
  })
  test('prepared es can be invoked with new thisArg', () => {
    const prepared = new ES('this', {
      thisArg: { a: 1 },
    })
    // fall-back to defaults
    expect(prepared.execute()).toEqual({ a: 1 })
    // override
    expect(prepared.execute({ thisArg: { b: 7 } })).toEqual({ b: 7 })
    // fall-back again to check nothing was overwritten in prepared object
    expect(prepared.execute()).toEqual({ a: 1 })
  })
})

describe('Error reporting', () => {
  test('SyntaxError', () => {
    const error = (() => {
      try {
        es('3 * (1 - 0')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(SyntaxError)
    expect(error?.message).toBe("Unexpected token '}'")
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>: "3 \* \(1 - 0"/)
  })
  test('ReferenceError', () => {
    const error = (() => {
      try {
        es('2 + a')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(ReferenceError)
    expect(error?.message).toBe('a is not defined')
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>:1:5: /)
  })
  test('ReferenceError in multi-line IIFE', () => {
    const error = (() => {
      try {
        es(`
(() => {
  2 + a
})()
`)
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(ReferenceError)
    expect(error?.message).toBe('a is not defined')
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>:3:7: /)
  })
  test('TypeError in multi-line IIFE', () => {
    const error = (() => {
      try {
        es(`
(() => {
  const a = undefined
  2 + a.property
})()
`)
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(TypeError)
    expect(error?.message).toBe(
      "Cannot read properties of undefined (reading 'property')",
    )
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>:4:9: /)
  })
})

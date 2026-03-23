import { describe, expect, test } from 'vitest'
import { ES, EsError, es } from './index.mjs'

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

describe('Standard and custom APIs', () => {
  test('Standard APIs are always available', () => {
    expect(es('JSON.stringify(null)')).toBe('null')
  })
  test('Custom APIs can be provided', () => {
    const myAPI = { trigger: () => 42 }
    expect(es('myAPI.trigger()', { customAPIs: { myAPI } })).toBe(42)
  })
  test('Custom APIs override whitelisted APIs', () => {
    const myJSON = { stringify: (_arg: unknown) => 42 }
    expect(
      es('JSON.stringify(2)', {
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
    // fall back to defaults
    expect(prepared.execute()).toBe('hello world!')
    // override
    expect(prepared.execute({ args: { who: 'updog' } })).toBe('hello updog!')
    expect(prepared.execute({ argValues: ['cat'] })).toBe('hello cat!')
    // do not fall back to defaults where value explicitly set to undefined
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
    // fall back again to check nothing was overwritten in prepared object
    expect(prepared.execute()).toBe('hello world!')
  })
  test('prepared es can be invoked with new thisArg', () => {
    const prepared = new ES('this', {
      thisArg: { a: 1 },
    })
    // fall back to defaults
    expect(prepared.execute()).toEqual({ a: 1 })
    // override
    expect(prepared.execute({ thisArg: { b: 7 } })).toEqual({ b: 7 })
    // fall back again to check nothing was overwritten in prepared object
    expect(prepared.execute()).toEqual({ a: 1 })
  })
})

describe('Error reporting', () => {
  test('TypeError', () => {
    const error = (() => {
      try {
        // @ts-expect-error
        es(null)
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(TypeError)
    expect(error?.message).toBe('Invalid argument type (str must be string)')
  })
  test('SyntaxError', () => {
    const error = (() => {
      try {
        es('3 * (1 - 0')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(EsError)
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
    expect(error).toBeInstanceOf(EsError)
    expect(error?.message).toBe('a is not defined')
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>:1:5: /)
  })
  test('RangeError', () => {
    const error = (() => {
      try {
        es('new Array(-1)')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(EsError)
    expect(error?.message).toBe('Invalid array length')
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>:1:1: /)
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
    expect(error).toBeInstanceOf(EsError)
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
    expect(error).toBeInstanceOf(EsError)
    expect(error?.message).toBe(
      "Cannot read properties of undefined (reading 'property')",
    )
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>:4:9: /)
  })

  test('User-defined thrown objects are passed through', () => {
    const myError = { message: 'hello' }
    const error = (() => {
      try {
        es('(() => {throw myError})()', { customAPIs: { myError } })
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(EsError)
    expect(error?.cause).toBe(myError)
  })
  test('User-defined thrown errors are passed through', () => {
    const error = (() => {
      try {
        es(`(() => {throw new Error("hello")})()`)
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(EsError)
    expect(error?.cause).toBeInstanceOf(Error)
    expect((error?.cause as Error).message).toBe('hello')
  })
  test('User-defined errors do not interfere with es error handling', () => {
    const error = (() => {
      try {
        es(
          `(() => {const error = new RangeError("hello"); error.stack=undefined; throw error;})()`,
        )
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(EsError)
    expect(error?.cause).toBeInstanceOf(Error)
    expect((error?.cause as Error).message).toBe('hello')
  })
  test('User-defined errors do not interfere with es error handling Ⅱ', () => {
    const error = (() => {
      try {
        es(
          `(() => {const error = new RangeError("hello"); error.stack='empty'; throw error;})()`,
        )
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(EsError)
    expect(error?.cause).toBeInstanceOf(Error)
    expect((error?.cause as Error).message).toBe('hello')
  })
})

describe('Nesting', () => {
  describe('`eval` is `es` per default', () => {
    test('nested `es` is invoked', () => {
      // built-in eval allows other-than-string inputs, `es` will throw
      expect(() => es('eval(null)')).toThrow(EsError)
    })
    test('nested `es` is executed', () => {
      expect(es('eval("1 + 2")')).toBe(3)
    })
    test('nested `es` has outer `es` context', () => {
      expect(es('eval("a")', { args: { a: 42 } })).toBe(42)
    })
  })
  describe('`eval` can be customized', () => {
    test('nested `eval` can be anything', () => {
      expect(es('eval("hello")', { customAPIs: { eval: () => 50 } })).toBe(50)
    })
    test('nested `es` can have different defaults', () => {
      expect(
        es('a + eval("a")', {
          customAPIs: { eval: (str: string) => es(str, { args: { a: 42 } }) },
          args: { a: 'the answer is: ' },
        }),
      ).toBe('the answer is: 42')
    })
  })

  test('Errors in nested `es` are propagated correctly', () => {
    const error = (() => {
      try {
        es('eval("2 + a")')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    expect(error).toBeInstanceOf(EsError)
    expect(error?.message).toBe('a is not defined')
    expect(error?.stack?.split('\n')[1]).toMatch(/<user input>: /)
  })
})

describe('Reasons why not to run user input', () => {
  // There are tons of ways how to break out of scope, but the one that most
  // certainly can't be caught or suppressed is the following:
  // * Access the constructor of a built-in function
  //   * e.g. the one of String.toString() ("".toString.constructor)
  //   * You now have access to the `Function` constructor
  // * Create a new instance of that class
  //   * The `Function` constructor takes an arbitrary string of ECMAScript as
  //     its function body.
  //   * That code will be evaluated in global scope.
  // * You can now pollute the global scope.
  // * You now have access to APIs that weren't supposed to be whitelisted.
  test('global scope pollution', () => {
    // Create an IIFE with a body that creates and calls a new `Function` where
    // global a will be set.
    es('(() => {(new ("".toString.constructor)("a=67"))()})()')
    // @ts-expect-error `a` was set at run-time by above code.
    expect(a).toBe(67)
  })
  test('access non-whitelisted APIs', () => {
    // JSON.stringify available although JSON is not whitelisted.
    expect(
      es(
        '(() => (new ("".toString.constructor)("return JSON.stringify(67)"))())()',
      ),
    ).toBe('67')
  })
})

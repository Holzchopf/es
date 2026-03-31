import assert from 'node:assert'
import { suite, test } from 'node:test'
import { ES, EsError, es } from './index.mts'

// declare a user global for API test
declare global {
  var myGlobalAPI: { toString: () => string }
}

globalThis.myGlobalAPI = {
  toString: () => 'hello',
}

suite('Simple expressions using built-in features only', () => {
  test('primitives are returned as-is', () => {
    assert.strictEqual(es('null'), null)
    assert.strictEqual(es('undefined'), undefined)
    assert.strictEqual(es('1'), 1)
    assert.strictEqual(es('"hello"'), 'hello')
    assert.strictEqual(es('true'), true)
    assert.deepStrictEqual(es('[]'), [])
    assert.deepStrictEqual(es('{}'), {})
  })
  test('arithmetics return value', () => {
    assert.strictEqual(es('1+1'), 2)
  })
  test('operators return value', () => {
    assert.strictEqual(es('typeof null'), 'object')
  })
})

suite('API customization', () => {
  test('Standard ECMAScript', (t) => {
    const testStr = 'JSON.stringify(null)'
    t.test('ECMAScript globals are available per default', () => {
      assert.strictEqual(es(testStr), 'null')
    })
    t.test('ECMAScript globals can be suppressed', () => {
      assert.throws(() => es(testStr, { whitelistECMAScript: false }))
    })
  })
  test('User defined whitelist', (t) => {
    const testStr = 'myGlobalAPI.toString()'
    t.test('User globals are not available per default', () => {
      assert.throws(() => es(testStr), EsError)
    })
    t.test('User globals can be white listed', () => {
      assert.strictEqual(
        es(testStr, { whitelist: ['myGlobalAPI'] }),
        myGlobalAPI.toString(),
      )
    })
  })
  test('Custom APIs', (t) => {
    t.test('Custom APIs can be provided', () => {
      const myAPI = { trigger: () => 42 }
      assert.strictEqual(es('myAPI.trigger()', { customAPIs: { myAPI } }), 42)
    })
    t.test('Custom APIs override whitelisted APIs', () => {
      const myJSON = { stringify: (_arg: unknown) => 42 }
      assert.strictEqual(
        es('JSON.stringify(2)', {
          customAPIs: { JSON: myJSON },
        }),
        42,
      )
    })
  })
})

suite('Function binding', () => {
  test('User defined this arg can be passed, defaulting to empty object', () => {
    assert.deepStrictEqual(es('this'), {})
    assert.deepStrictEqual(es('this', { thisArg: { a: 1 } }), { a: 1 })
  })
  test("User defined this arg can't be null or undefined", () => {
    assert.deepStrictEqual(es('this', { thisArg: null }), {})
    assert.deepStrictEqual(es('this', { thisArg: undefined }), {})
    assert.deepStrictEqual(es('this', { thisArg: [][1] }), {}) // no tricks possible?
    assert.deepStrictEqual(es('this', { thisArg: false }), new Boolean(false)) // no fallbacks on nullish
  })
})

suite('Prepared es', () => {
  test('prepared es returns same value as directly invoked es', () => {
    const str = '1337 + 1'
    const prepared = new ES(str)
    assert.strictEqual(prepared.execute(), es(str))
  })
  test('prepared es can be invoked with new argValues', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template is eval'ed
    const prepared = new ES('`hello ${who}${punctuation}`', {
      args: { who: 'world', punctuation: '!' },
    })
    // fall back to defaults
    assert.strictEqual(prepared.execute(), 'hello world!')
    // override
    assert.strictEqual(
      prepared.execute({ args: { who: 'updog' } }),
      'hello updog!',
    )
    assert.strictEqual(prepared.execute({ argValues: ['cat'] }), 'hello cat!')
    // do not fall back to defaults where value explicitly set to undefined
    assert.strictEqual(
      prepared.execute({ args: { who: undefined } }),
      'hello undefined!',
    )
    assert.strictEqual(
      prepared.execute({ argValues: [undefined] }),
      'hello undefined!',
    )
    // named arguments don't mess up order
    assert.strictEqual(
      prepared.execute({ argNames: ['punctuation'], argValues: ['...'] }),
      'hello world...',
    )
    // fall back again to check nothing was overwritten in prepared object
    assert.strictEqual(prepared.execute(), 'hello world!')
  })
  test('prepared es can be invoked with new thisArg', () => {
    const prepared = new ES('this', {
      thisArg: { a: 1 },
    })
    // fall back to defaults
    assert.deepStrictEqual(prepared.execute(), { a: 1 })
    // override
    assert.deepStrictEqual(prepared.execute({ thisArg: { b: 7 } }), { b: 7 })
    // fall back again to check nothing was overwritten in prepared object
    assert.deepStrictEqual(prepared.execute(), { a: 1 })
  })
})

suite('Error reporting', () => {
  test('TypeError', () => {
    const error = (() => {
      try {
        // @ts-expect-error
        es(null)
      } catch (error) {
        return error
      }
    })() as Error | undefined
    assert.ok(error instanceof TypeError)
    assert.strictEqual(
      error?.message,
      'Invalid argument type (str must be string)',
    )
  })
  test('SyntaxError', () => {
    const error = (() => {
      try {
        es('3 * (1 - 0')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    assert.ok(error instanceof EsError)
    assert.strictEqual(error?.message, "Unexpected token '}'")
    assert.match(
      error?.stack?.split('\n')[1] ?? '',
      /<user input>: "3 \* \(1 - 0"/,
    )
  })
  test('ReferenceError', () => {
    const error = (() => {
      try {
        es('2 + a')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    assert.ok(error instanceof EsError)
    assert.strictEqual(error?.message, 'a is not defined')
    assert.match(error?.stack?.split('\n')[1] ?? '', /<user input>:1:5: /)
  })
  test('RangeError', () => {
    const error = (() => {
      try {
        es('new Array(-1)')
      } catch (error) {
        return error
      }
    })() as Error | undefined
    assert.ok(error instanceof EsError)
    assert.strictEqual(error?.message, 'Invalid array length')
    assert.match(error?.stack?.split('\n')[1] ?? '', /<user input>:1:1: /)
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
    assert.ok(error instanceof EsError)
    assert.strictEqual(error?.message, 'a is not defined')
    assert.match(error?.stack?.split('\n')[1] ?? '', /<user input>:3:7: /)
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
    assert.ok(error instanceof EsError)
    assert.strictEqual(
      error?.message,
      "Cannot read properties of undefined (reading 'property')",
    )
    assert.match(error?.stack?.split('\n')[1] ?? '', /<user input>:4:9: /)
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
    assert.ok(error instanceof EsError)
    assert.deepStrictEqual(error?.cause, myError)
  })
  test('User-defined thrown errors are passed through', () => {
    const error = (() => {
      try {
        es(`(() => {throw new Error("hello")})()`)
      } catch (error) {
        return error
      }
    })() as Error | undefined
    assert.ok(error instanceof EsError)
    assert.ok(error?.cause instanceof Error)
    assert.strictEqual((error?.cause as Error).message, 'hello')
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
    assert.ok(error instanceof EsError)
    assert.ok(error?.cause instanceof Error)
    assert.strictEqual((error?.cause as Error).message, 'hello')
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
    assert.ok(error instanceof EsError)
    assert.ok(error?.cause instanceof Error)
    assert.strictEqual((error?.cause as Error).message, 'hello')
  })
})

suite('Nesting', () => {
  test('`eval` is `es` per default', (t) => {
    t.test('nested `es` is invoked', () => {
      // built-in eval allows other-than-string inputs, `es` will throw
      assert.throws(() => es('eval(null)'), EsError)
    })
    t.test('nested `es` is executed', () => {
      assert.strictEqual(es('eval("1 + 2")'), 3)
    })
    t.test('nested `es` has outer `es` context', () => {
      assert.strictEqual(es('eval("a")', { args: { a: 42 } }), 42)
    })
  })
  test('`eval` can be customized', (t) => {
    t.test('nested `eval` can be anything', () => {
      assert.strictEqual(
        es('eval("hello")', { customAPIs: { eval: () => 50 } }),
        50,
      )
    })
    t.test('nested `es` can have different defaults', () => {
      assert.strictEqual(
        es('a + eval("a")', {
          customAPIs: { eval: (str: string) => es(str, { args: { a: 42 } }) },
          args: { a: 'the answer is: ' },
        }),
        'the answer is: 42',
      )
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
    assert.ok(error instanceof EsError)
    assert.strictEqual(error?.message, 'a is not defined')
    assert.match(error?.stack?.split('\n')[1] ?? '', /<user input>: /)
  })
})

suite('Reasons why not to run user input', () => {
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
    assert.strictEqual(a, 67)
  })
  test('access non-whitelisted APIs', () => {
    // JSON.stringify available although JSON is not whitelisted.
    assert.strictEqual(
      es(
        '(() => (new ("".toString.constructor)("return JSON.stringify(67)"))())()',
      ),
      '67',
    )
  })
})

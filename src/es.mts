const _this = this

// At runtime, the execution parameters are passed as object with this name.
// Name collisions should not matter, since the param object is obfuscated for
// the user code scope.
const esExecuteParamName = 'esExecuteParam'

export type EsOptionsArguments =
  | {
      args?: Record<string, unknown>
      argNames?: undefined
      argValues?: undefined
    }
  | {
      args?: undefined
      argNames?: string[]
      argValues?: unknown[]
    }

export type EsExecuteOptions = {
  thisArg?: unknown
} & EsOptionsArguments

export type EsOptions = {
  whitelist?: string[]
  customAPIs?: Record<string, unknown>
} & EsExecuteOptions

/**
 * Prepared `es` function.
 */
export class ES {
  public userLineOffset = 0
  private readonly whitelist: string[]
  private readonly customAPIs: Record<string, unknown>
  private readonly thisArg: unknown
  private readonly argNames: string[]
  private readonly argValues: unknown[]

  private func: (options?: EsOptions, ...apis: unknown[]) => unknown

  /**
   * Prepares `es` function for given string and options.
   * @param {string} str string to evaluate
   * @param {EsOptions} options `EsOptions` to set whitelist, customAPIs and argNames as well as fall-back values for `thisArg` and `argValues`
   */
  constructor(str: string, options?: EsOptions) {
    this.whitelist = options?.whitelist ?? []
    this.customAPIs = options?.customAPIs ?? {}
    this.thisArg = options?.thisArg
    this.argNames = options?.argNames ?? Object.keys(options?.args ?? {})
    this.argValues = options?.argValues ?? Object.values(options?.args ?? {})

    const bodyLines: string[] = []

    // Use strict to prevent auto-assigning undeclared variables in global scope.
    // (Also forbids to use 'arguments' and 'eval' as identifier)
    // bodyLines.push('"use strict";')

    // Set undefined to computed undefined value, it's [[writable]] prior to
    // ECMAScript edition 5 and not a reserved keyword (could be anything).
    bodyLines.push('const undefined=[][0];')

    const autoWhiteList = [...this.argNames]
    autoWhiteList.push(...Object.keys(this.customAPIs))

    // Obfuscate all global properties plus constructor.
    // Exempt 'undefined' as that's already been fixed to something really undefined.
    const evilKeywords = Object.getOwnPropertyNames(_this)
      .concat(['constructor'])
      .filter((k) => !['undefined'].includes(k))
      .filter((k) => !autoWhiteList.includes(k))

    for (const key of evilKeywords) {
      if (!this.whitelist.includes(key)) {
        bodyLines.push(`const ${key}=undefined;`)
      }
    }
    // for (const key of ['globalThis']) {
    //   body += `${key} = undefined;\n`
    // }

    // pack string to evaluate in nested IIFE with strict mode (to prevent assignment of globals) and apply undefined to hide "this"

    // User line offset for error reporting
    // + 1 because there's an extra line for the wrapper IIFE
    // + 1 because there's an extra line break in the return statement to reset the char position
    // + 1 because the Function constructor prepends "function anonymous( ... ) {\n"
    // const userLineOffset = bodyLines.length + 4 // + 1 because there's an extra line break in the return statement to reset char offset, + 1 because the function constructor will prepend the line function
    // body += 'return (function () {"use strict";return(\n// user code\n'
    // body += str
    // body += '\n)}).apply(undefined);'

    // Wrap in IIFE and apply `this` to pass later passed `this` arg.
    // `"use strict"` in IIFE to prevent auto-assigning undeclared variables in
    // global scope.
    // Fence the user string and put it on new line to reset char position for
    // error reporting.

    bodyLines.push(`return (function (${this.argNames.join(',')}) {`)
    bodyLines.push('"use strict";')
    // Instead of trying to obfuscate the identifier for the options argument,
    // simply prepare for the case there is an actual name collision in context.
    // (I.e. only set to `undefined` if there's no name collision and otherwise
    // let it be as the argument will have precedence (closer scope))
    if (!Object.keys(this.argNames).includes(esExecuteParamName)) {
      bodyLines.push(`const ${esExecuteParamName}=undefined;`)
    }
    bodyLines.push('return(')
    this.userLineOffset = 1 + bodyLines.length
    bodyLines.push(str)
    bodyLines.push(')')
    bodyLines.push(`}).apply(this, ${esExecuteParamName}.argValues)`)

    const body = bodyLines.join('\n')

    this.func = (() => {
      try {
        // create a function with str as body, taking all context keys as args
        return new Function(
          esExecuteParamName,
          ...Object.keys(this.customAPIs),
          body,
        ) as (options?: EsOptions) => unknown //.bind("hello", { inject: {eval: () => {console.log('inner eval called')}}, context })
      } catch (error) {
        console.error(error)
        if (error instanceof Error) {
          console.error(error.cause)
          console.dir(error)
          // TODO: do something with body to find syntax error maybe? or unsafe?
          throw new SyntaxError(error.message)
        }
        throw error
      }
    })()

    // console.log(this.func.toString())
  }

  /**
   * Executes prepared `es` function with specified options.
   * @param {EsExecuteOptions} options Overrides for `thisArg` and argument values
   * @returns
   */
  execute(options?: EsExecuteOptions) {
    // The passed `thisArg` when calling func must not be nullish, otherwise
    // invocation is made with `globalThis` as `this` argument.
    const thisArg = options?.thisArg ?? this.thisArg ?? {}

    // Override provided argument values.
    // If `argNames` and `argValues` are passed separately, merge into object so
    // the key => value relation is kept intact.
    const args =
      options?.args ??
      // Rebuild for passed values rather than passed names.
      // If `options.argNames` is missing, fall back to `this.argNames`, assume
      // order still matches.
      Object.fromEntries(
        options?.argValues?.map((value, i) => [
          (options?.argNames ?? this.argNames).at(i),
          value,
        ]) ?? [],
      )
    const argValues = this.argNames.map(
      // If name was explicitly stated in `options.argNames` and its value is
      // undefined, use undefined instead of fall-back value.
      (name, i) => (name in args ? args[name] : this.argValues[i]),
    )

    return this.func.call(
      thisArg,
      {
        argNames: this.argNames,
        argValues,
      },
      ...Object.values(this.customAPIs),
    )
  }
}

/**
 * Evaluate string.
 * @param {string} str string to evaluate
 * @param {EsOptions} options `EsOptions` object
 * @returns {unknown} result from evaluation
 */
export function es(str: string, options?: EsOptions) {
  const preparedEs = new ES(str, options)

  //... and call it to evaluate, given all context values
  try {
    return preparedEs.execute(options)
  } catch (error) {
    console.error(error)
    if (error instanceof Error) {
      console.dir(error.stack)
      const sourceLines = error.stack?.split('\n').map((line) => line.trim())
      // Stack is not standardized. Assume first line containing lineNo:charNo is culprit
      const userSourceLine = sourceLines?.find((line) =>
        line.match(/(\d+):(\d+)/),
      )
      console.log(userSourceLine)
      if (userSourceLine) {
        // TODO: only correct line numbering if not already happened

        // Assume the last occurrence of lineNo:charNo is the error source.
        // Can't be nullish since userSourceLine must contain pattern to reach this code.
        /** @type {RegExpExecArray} */
        // biome-ignore lint: code would be unreachable if pattern was missing
        const source = Array.from(userSourceLine.matchAll(/(\d+):(\d+)/g)).at(
          -1,
        )!
        const lineNo = parseInt(source[1]) - preparedEs.userLineOffset
        const charNo = parseInt(source[2])
        console.log(lineNo, charNo, str)
        const newError = new (error.constructor as typeof Error)(error.message)
        newError.name = error.name
        newError.stack = `${lineNo}:${charNo}`
        throw newError
      }
    }
  }
}

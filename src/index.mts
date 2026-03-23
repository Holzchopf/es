export class EsError extends Error {}

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
  customAPIs?: Record<string, unknown>
} & EsExecuteOptions

/**
 * Prepared `es` function.
 */
export class ES {
  public userLineOffset = 0
  private readonly str: string
  private readonly customAPIs: Record<string, unknown>
  private readonly thisArg: unknown
  private readonly argNames: string[]
  private readonly argValues: unknown[]

  private func: (options?: EsOptions, ...apis: unknown[]) => unknown

  /**
   * Prepares `es` function for given string and options.
   * @param {string} str string to evaluate
   * @param {EsOptions} options `EsOptions` to set customAPIs and argNames as well as fall-back values for `thisArg` and `argValues`
   */
  constructor(str: string, options?: EsOptions) {
    if (typeof str !== 'string') {
      throw new TypeError('Invalid argument type (str must be string)')
    }

    this.str = str
    this.customAPIs = options?.customAPIs ?? {}
    this.thisArg = options?.thisArg
    this.argNames = options?.argNames ?? Object.keys(options?.args ?? {})
    this.argValues = options?.argValues ?? Object.values(options?.args ?? {})

    // Per default, use plain `es` for `eval`
    if (!Object.keys(this.customAPIs).includes('eval')) {
      this.customAPIs['eval'] = (str: string) =>
        es(str, {
          customAPIs: this.customAPIs,
          thisArg: this.thisArg,
          argNames: this.argNames,
          argValues: this.argValues,
        })
    }

    const bodyLines: string[] = []

    // Set undefined to computed undefined value, it's [[writable]] prior to
    // ECMAScript edition 5 and not a reserved keyword (could be anything).
    bodyLines.push('const undefined=[][0];')

    const autoWhiteList = [...this.argNames]
    autoWhiteList.push(...Object.keys(this.customAPIs))

    // Randomize esExecuteParamName to prevent name collisions (with `argNames`
    // and `customAPIs`)
    const esExecuteParamName = (() => {
      let name: string
      do {
        name = `esExParam_${(Math.random() * 99999).toFixed(0)}`
      } while (autoWhiteList.includes(name))
      return name
    })()

    // Wrap in IIFE and apply `this` to pass later passed `this` arg.
    // Fence the user string and put it on new line to reset char position for
    // error reporting.
    // `"use strict"` to prevent accidentally auto-assigning undeclared
    // variables in global scope.

    bodyLines.push(`return (function (${this.argNames.join(',')}) {`)
    bodyLines.push(`const ${esExecuteParamName}=undefined;`)
    bodyLines.push('"use strict";')
    bodyLines.push('return(')
    // + 1 for the function header the `Function` constructor prepends
    // + 1 because it's 1-based
    this.userLineOffset = bodyLines.length + 2
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
        ) as (options?: EsOptions) => unknown
      } catch (error) {
        throw this.esifyError(error)
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

    try {
      return this.func.call(
        thisArg,
        {
          argNames: this.argNames,
          argValues,
        },
        ...Object.values(this.customAPIs),
      )
    } catch (error) {
      // console.log(this.func.toString())
      throw this.esifyError(error)
    }
  }

  private guessErrorSourceInUserSpaceFromStackTrace(
    error: unknown,
  ): [number, number] | undefined {
    if (!(error instanceof Error)) return undefined
    // SyntaxErrors do not contain error source - for others, try to infer it.
    if (error instanceof SyntaxError) return undefined
    if (!error.stack) return undefined
    // Assume first line containing pattern `:<number>:<number>` is relevant
    // trace line with the last occurrence of pattern being in user input.
    const relevantMatch = error.stack.match(/:(\d+):(\d+).?$/m)
    if (!relevantMatch) return undefined
    return [
      parseInt(relevantMatch[1]) - this.userLineOffset,
      parseInt(relevantMatch[2]),
    ]
  }

  private esifyError(error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    const errorSource = (() => {
      const source = this.guessErrorSourceInUserSpaceFromStackTrace(error)
      return source ? `:${source[0]}:${source[1]}` : ''
    })()
    // For reporting, report a bit of lib code as well since some errors
    // may only occur after user code.
    const newError = new EsError(errorMessage)
    newError.cause = error
    newError.stack = [
      `${newError.name}: ${newError.message}`,
      `    in <user input>${errorSource}: ${JSON.stringify(this.str)}`,
      `    in <library code>: ${JSON.stringify(`(() => {return(${this.str})()`)}`,
    ].join('\n')
    return newError
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
  return preparedEs.execute(options)
  // try {

  // } catch (error) {
  //   console.error(error)
  //   if (error instanceof Error) {
  //     console.dir(error.stack)
  //     const sourceLines = error.stack?.split('\n').map((line) => line.trim())
  //     // Stack is not standardized. Assume first line containing lineNo:charNo is culprit
  //     const userSourceLine = sourceLines?.find((line) =>
  //       line.match(/(\d+):(\d+)/),
  //     )
  //     console.log(userSourceLine)
  //     if (userSourceLine) {
  //       // TODO: only correct line numbering if not already happened

  //       // Assume the last occurrence of lineNo:charNo is the error source.
  //       // Can't be nullish since userSourceLine must contain pattern to reach this code.
  //       /** @type {RegExpExecArray} */
  //       // biome-ignore lint: code would be unreachable if pattern was missing
  //       const source = Array.from(userSourceLine.matchAll(/(\d+):(\d+)/g)).at(
  //         -1,
  //       )!
  //       const lineNo = parseInt(source[1]) - preparedEs.userLineOffset
  //       const charNo = parseInt(source[2])
  //       console.log(lineNo, charNo, str)
  //       const newError = new (error.constructor as typeof Error)(error.message)
  //       newError.name = error.name
  //       newError.stack = `${lineNo}:${charNo}`
  //       throw newError
  //     }
  //   }
  // }
}

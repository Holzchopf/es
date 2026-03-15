const _this = this

export interface EsOptions {
  whitelist?: string[]
  thisArg?: unknown
  context?: Record<string, unknown>
}

/**
 * Evaluates `str`.
 */
export function es(str: string, options?: EsOptions) {
  const whitelist = options?.whitelist ?? []
  const context = options?.context ?? {}
  let thisArg = options?.thisArg
  if (thisArg === null || typeof thisArg === 'undefined') thisArg = {}

  const bodyLines: string[] = []

  // Use strict to prevent auto-assigning undeclared variables in global scope.
  // (Also forbids to use 'arguments' and 'eval' as identifier)
  // bodyLines.push('"use strict";')

  // Set undefined to computed undefined value, it's [[writable]] prior to ECMAScript edition 5
  bodyLines.push('const undefined=[][0];')

  const autoWhiteList = Object.keys(context)

  // Obfuscate all global properties plus constructor.
  // Exempt 'undefined' as that's already been fixed to something really undefined.
  const evilKeywords = Object.getOwnPropertyNames(_this)
    .concat(['constructor'])
    .filter((k) => !['undefined'].includes(k))
    .filter((k) => !autoWhiteList.includes(k))

  for (const key of evilKeywords) {
    if (!whitelist.includes(key)) {
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

  // Wrap in IIFE and apply this to pass later passed this arg.
  // "use strict" in IIFE to prevent auto-assigning undeclared variables in global scope.
  // Fence the user string and put it on new line to reset char position.

  bodyLines.push('return (function () {')
  bodyLines.push('"use strict";')
  bodyLines.push('return(')
  const userLineOffset = 1 + bodyLines.length
  bodyLines.push(str)
  bodyLines.push(')')
  bodyLines.push('}).call(this)')

  // bodyLines.push(`return (function () {\n"use strict";\nreturn(\n${str}\n)}).call(this)`)

  const body = bodyLines.join('\n')
  console.log(body)
  console.log(context)

  const func = (() => {
    try {
      // create a function with str as body, taking all context keys as args
      return new Function(...Object.keys(context), body) //.bind("hello", { inject: {eval: () => {console.log('inner eval called')}}, context })
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

  //... and call it to evaluate, given all context values
  try {
    console.log(func.toString())
    return func.call(thisArg, ...Object.values(context))
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
        const lineNo = parseInt(source[1]) - userLineOffset
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

# ES

[`eval()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval) but
- isolated from global object
- customizable API
- able to be prepared once, executed multiple times

## Examples

Basic arithmetics

```ts
es('1+1') // returns 2
```

Isolation:

```ts
let a = 2
es('a + 1') // throws EsError: a is not defined
```

Custom API:

```ts
let a = 2
es('a + 1', { customAPIs: { a } }) // returns 3
```

Prepared statements:

```ts
let a = 0
const prepared = new ES('a + 1', { args: { a } })
a = 2
prepared.execute({ args: { a }}) // returns 3
a = 3
prepared.execute({ args: { a }}) // returns 4
```

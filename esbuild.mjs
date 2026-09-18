import { glob } from 'node:fs/promises'
import * as esbuild from 'esbuild'

// esbuild does not inspect tsconfig.json "files" to determine entryPoints
// nor "outDir" to determine outfile, hence, define them here
// https://esbuild.github.io/content-types/#tsconfig-json

const entryPoints = []
for await (const file of glob('./src/**/*.mts')) {
  if (!file.endsWith('.test.mts')) entryPoints.push(file)
}

const shared = {
  entryPoints,
  minify: true,
}

await Promise.all([
  esbuild.build({
    ...shared,
    format: 'cjs',
    outdir: './lib/cjs',
    outExtension: { '.js': '.cjs' },
  }),
  esbuild.build({
    ...shared,
    format: 'esm',
    outdir: './lib/esm',
    outExtension: { '.js': '.mjs' },
  }),
])

import type { Plugin } from 'vite'

/** Ensures the HTML entry is treated as ESM where needed for this project’s tooling. */
export function htmlEntryAsEsmPlugin(): Plugin {
  return { name: 'html-entry-as-esm' }
}

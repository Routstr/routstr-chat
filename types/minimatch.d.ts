// Minimal shim to satisfy TS when a dependency expects 'minimatch' types.
// If you later add proper types via `@types/minimatch` or upgrade minimatch
// to a version that ships its own types, you can remove this file.

declare module "minimatch" {
  export interface IMinimatchOptions {
    debug?: boolean;
    nobrace?: boolean;
    noglobstar?: boolean;
    dot?: boolean;
    noext?: boolean;
    nocase?: boolean;
    nonull?: boolean;
    matchBase?: boolean;
    nocomment?: boolean;
    nonegate?: boolean;
    flipNegate?: boolean;
  }

  export function minimatch(
    path: string,
    pattern: string,
    options?: IMinimatchOptions,
  ): boolean;
  export function filter(
    pattern: string,
    options?: IMinimatchOptions,
  ): (path: string) => boolean;
  export function makeRe(
    pattern: string,
    options?: IMinimatchOptions,
  ): RegExp | null;

  export class Minimatch {
    constructor(pattern: string, options?: IMinimatchOptions);
    set: string[][];
    regexp: RegExp | false;
    negate: boolean;
    comment: boolean;
    empty: boolean;
    makeRe(): RegExp | false;
    match(f: string, partial?: boolean): boolean;
    matchOne(files: string[], pattern: string[], partial: boolean): boolean;
  }

  export default minimatch;
}

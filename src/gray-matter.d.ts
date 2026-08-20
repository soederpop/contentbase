// gray-matter's shipped types omit `cache`, even though passing any options
// object (including `{ cache: false }`) bypasses its internal parse cache —
// see gray-matter's `matter()`: it only reads/writes `matter.cache` when no
// options argument is given at all. Declared here so call sites can opt out
// of that shared cache explicitly instead of passing an empty `{}`.
//
// gray-matter is an `export = matter` module whose function and namespace are
// merged, so the augmented interface goes directly in the module body. Nesting
// it in `namespace matter { ... }` declares an unrelated namespace and the
// `cache` property never reaches the real `GrayMatterOption`.
import "gray-matter";

declare module "gray-matter" {
  interface GrayMatterOption<I extends Input, O extends GrayMatterOption<I, O>> {
    cache?: boolean;
  }
}

// gray-matter's shipped types omit `cache`, even though passing any options
// object (including `{ cache: false }`) bypasses its internal parse cache —
// see gray-matter's `matter()`: it only reads/writes `matter.cache` when no
// options argument is given at all. Declared here so call sites can opt out
// of that shared cache explicitly instead of passing an empty `{}`.
import "gray-matter";

declare module "gray-matter" {
  namespace matter {
    interface GrayMatterOption<I extends Input, O extends GrayMatterOption<I, O>> {
      cache?: boolean;
    }
  }
}

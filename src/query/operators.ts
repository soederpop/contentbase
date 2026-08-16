export type Operator =
  | "eq"
  | "neq"
  | "in"
  | "notIn"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "regex"
  | "exists";

export const operators: Record<
  Operator,
  (actual: any, expected: any) => boolean
> = {
  eq: (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  neq: (a, b) => !operators.eq(a, b),
  // For array-valued fields (e.g. tags), "in" means overlap: any element in the list
  in: (a, b) =>
    Array.isArray(b) &&
    (Array.isArray(a) ? a.some((x) => b.includes(x)) : b.includes(a)),
  notIn: (a, b) => Array.isArray(b) && !operators.in(a, b),
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
  // Strings: substring. Arrays: membership (tags contains "urgent")
  contains: (a, b) =>
    typeof a === "string" ? a.includes(b) : Array.isArray(a) && a.includes(b),
  startsWith: (a, b) => typeof a === "string" && a.startsWith(b),
  endsWith: (a, b) => typeof a === "string" && a.endsWith(b),
  regex: (a, b) =>
    b instanceof RegExp
      ? b.test(String(a))
      : new RegExp(b).test(String(a)),
  exists: (a, b) =>
    b ? a !== undefined && a !== null : a === undefined || a === null,
};

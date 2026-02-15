const IRREGULAR: Record<string, string> = {
  person: "people",
  child: "children",
  man: "men",
  woman: "women",
  mouse: "mice",
  goose: "geese",
  ox: "oxen",
  datum: "data",
  index: "indices",
  matrix: "matrices",
  vertex: "vertices",
};

const UNCOUNTABLE = new Set([
  "sheep",
  "fish",
  "deer",
  "series",
  "species",
  "money",
  "rice",
  "information",
  "equipment",
  "media",
  "data",
]);

export function pluralize(word: string): string {
  const lower = word.toLowerCase();

  if (UNCOUNTABLE.has(lower)) return word;
  if (IRREGULAR[lower]) {
    return word[0] + IRREGULAR[lower].slice(1);
  }

  if (/s$/i.test(word)) return word;
  if (/([^aeiou])y$/i.test(word)) return word.replace(/y$/i, "ies");
  if (/(x|ch|ss|sh)$/i.test(word)) return word + "es";

  return word + "s";
}

export function singularize(word: string): string {
  const lower = word.toLowerCase();

  if (UNCOUNTABLE.has(lower)) return word;

  const irregularEntry = Object.entries(IRREGULAR).find(
    ([, v]) => v === lower
  );
  if (irregularEntry) {
    return word[0] + irregularEntry[0].slice(1);
  }

  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/ses$/i.test(word) || /xes$/i.test(word) || /ches$/i.test(word) || /shes$/i.test(word)) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

export function kebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^\w-]/g, "")
    .toLowerCase();
}

export function camelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

export function upperFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

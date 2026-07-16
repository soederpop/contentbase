import { inspect } from 'util'

const BUILTIN_TYPES = new Set(['Object', 'Array', 'Map', 'Set', 'Date', 'RegExp', 'Promise', 'Error', 'Number', 'String', 'Boolean'])

export function displayResult(value: any) {
	if (typeof value !== 'object' || value === null) {
		console.log(value)
		return
	}

	const hasCustomInspect = typeof value[Symbol.for('nodejs.util.inspect.custom')] === 'function'
	const ctorName = value.constructor?.name
	const isClassInstance = ctorName && !BUILTIN_TYPES.has(ctorName)

	// Objects with custom inspect or builtins: use standard inspect
	if (hasCustomInspect || !isClassInstance) {
		console.log(inspect(value, { colors: true, depth: 4 }))
		return
	}

	// Class instances: show clean data (no _ props, no functions)
	const data: Record<string, any> = {}
	for (const [k, v] of Object.entries(value)) {
		if (k.startsWith('_') || typeof v === 'function') continue
		data[k] = v
	}
	const body = inspect(data, { colors: true, depth: 3 })
	console.log(`${ctorName} ${body}`)

	// Collect methods and getters from own + prototype chain
	const methods: string[] = []
	const getters: string[] = []

	for (const [k, v] of Object.entries(value)) {
		if (k.startsWith('_')) continue
		if (typeof v === 'function') methods.push(k)
	}

	let proto = Object.getPrototypeOf(value)
	while (proto && proto !== Object.prototype) {
		for (const k of Object.getOwnPropertyNames(proto)) {
			if (k === 'constructor' || k.startsWith('_')) continue
			const desc = Object.getOwnPropertyDescriptor(proto, k)
			if (!desc) continue
			if (desc.get && !getters.includes(k)) getters.push(k)
			else if (typeof desc.value === 'function' && !methods.includes(k)) methods.push(k)
		}
		proto = Object.getPrototypeOf(proto)
	}

	if (getters.length || methods.length) {
		const parts: string[] = []
		if (getters.length) parts.push(`  \x1b[36mgetters:\x1b[0m ${getters.sort().join(', ')}`)
		if (methods.length) parts.push(`  \x1b[36mmethods:\x1b[0m ${methods.sort().map(m => m + '()').join(', ')}`)
		console.log(parts.join('\n'))
	}
}

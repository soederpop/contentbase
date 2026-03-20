import {
  defineModel,
  section,
  hasMany,
  belongsTo,
  AstQuery,
  z,
} from "contentbase";

export const Idea = defineModel("Idea", {
	prefix: "ideas",
	description: 'Ideas are used to capture thoughts for new features, apis, etc',
	meta: z.object({
		goal: z.string().optional().describe("Slug of the goal this idea is aligned to"),
		tags: z.array(z.string()).default([]).describe("Arbitrary tags for categorizing the idea"),
		status: z.enum(["spark", "exploring", "parked", "promoted"]).default("spark").describe("spark is a new raw idea, exploring means actively thinking about it, parked means on hold, promoted means it became a plan"),
	}),
});

export const Tutorial = defineModel("Tutorial", {
	prefix: "tutorials",
	pattern: ['tutorials/:slug', 'tutorials/:category/:slug'],
	meta: z.object({
		tags: z.array(z.string()).default([]).describe("Arbitrary tags for categorizing the tutorial"),
		category: z.string().default('contentbase')
	}),
})

export const Report = defineModel("Report", {
	prefix: "reports",
	meta: z.object({
		tags: z.array(z.string()).default([]).describe("Arbitrary tags for categorizing the report"),
	}),
})

export const Example = defineModel("Example", {
	prefix: "examples",
	meta: z.object({
		tags: z.array(z.string()).default([]).describe("Arbitrary tags for categorizing the example"),
	}),
})

import { defineModel, section, hasMany, belongsTo, z, } from "../../../src/index";
import { toString } from "mdast-util-to-string";
const epicMeta = z.object({
    priority: z.enum(["low", "medium", "high"]).optional().describe("Importance level for prioritization"),
    status: z
        .enum(["created", "in-progress", "complete"])
        .default("created")
        .describe("Current workflow state"),
});
const storyMeta = z.object({
    status: z
        .enum(["created", "in-progress", "complete"])
        .default("created")
        .describe("Current workflow state"),
    epic: z.string().optional().describe("Slug of the parent epic"),
});
export const Epic = defineModel("Epic", {
    prefix: "epics",
    meta: epicMeta,
    relationships: {
        stories: hasMany(() => Story, {
            heading: "Stories",
        }),
    },
    computed: {
        isComplete: (self) => self.meta.status === "complete",
    },
    defaults: {
        status: "created",
    },
});
export const Story = defineModel("Story", {
    prefix: "stories",
    meta: storyMeta,
    sections: {
        acceptanceCriteria: section("Acceptance Criteria", {
            extract: (query) => query.selectAll("listItem").map((n) => toString(n)),
            schema: z.array(z.string()).describe("List of acceptance criteria as plain text strings"),
        }),
        mockups: section("Mockups", {
            extract: (query) => Object.fromEntries(query
                .selectAll("link")
                .map((l) => [toString(l), l.url])),
            schema: z.record(z.string(), z.string()).describe("Map of mockup label to URL"),
        }),
    },
    relationships: {
        epic: belongsTo(() => Epic, {
            foreignKey: (doc) => doc.meta.epic,
        }),
    },
    computed: {
        isComplete: (self) => self.meta.status === "complete",
    },
});
//# sourceMappingURL=models.js.map
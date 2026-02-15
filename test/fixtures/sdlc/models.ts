import {
  defineModel,
  section,
  hasMany,
  belongsTo,
  z,
  type ModelDefinition,
  type HasManyDefinition,
  type BelongsToDefinition,
  type SectionDefinition,
} from "../../../src/index";
import { toString } from "mdast-util-to-string";

const epicMeta = z.object({
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z
    .enum(["created", "in-progress", "complete"])
    .default("created"),
});

const storyMeta = z.object({
  status: z
    .enum(["created", "in-progress", "complete"])
    .default("created"),
  epic: z.string().optional(),
});

/** Explicit type for Epic so circular Epic↔Story inference doesn’t collapse to never */
export type EpicDef = ModelDefinition<
  "Epic",
  typeof epicMeta,
  Record<string, never>,
  { stories: HasManyDefinition<StoryDef> },
  { isComplete: (self: any) => boolean }
>;

/** Explicit type for Story so circular Epic↔Story inference doesn’t collapse to never */
export type StoryDef = ModelDefinition<
  "Story",
  typeof storyMeta,
  Record<string, SectionDefinition<any>>,
  { epic: BelongsToDefinition<EpicDef> },
  { isComplete: (self: any) => boolean }
>;

export const Epic: EpicDef = defineModel("Epic", {
  prefix: "epics",
  meta: epicMeta,
  relationships: {
    stories: hasMany(() => Story, {
      heading: "Stories",
    }),
  },
  computed: {
    isComplete: (self: any) => self.meta.status === "complete",
  },
  defaults: {
    status: "created",
  },
});

export const Story: StoryDef = defineModel("Story", {
  prefix: "stories",
  meta: storyMeta,
  sections: {
    acceptanceCriteria: section("Acceptance Criteria", {
      extract: (query) =>
        query.selectAll("listItem").map((n) => toString(n)),
      schema: z.array(z.string()),
    }),
    mockups: section("Mockups", {
      extract: (query) =>
        Object.fromEntries(
          query
            .selectAll("link")
            .map((l: any) => [toString(l), l.url])
        ),
      schema: z.record(z.string(), z.string()),
    }),
  },
  relationships: {
    epic: belongsTo(() => Epic, {
      foreignKey: (doc) => doc.meta.epic as string,
    }),
  },
  computed: {
    isComplete: (self: any) => self.meta.status === "complete",
  },
});

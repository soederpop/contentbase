import { z, type ModelDefinition, type HasManyDefinition, type BelongsToDefinition, type SectionDefinition } from "../../../src/index";
declare const epicMeta: z.ZodObject<{
    priority: z.ZodOptional<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
    }>>;
    status: z.ZodDefault<z.ZodEnum<{
        created: "created";
        "in-progress": "in-progress";
        complete: "complete";
    }>>;
}, z.core.$strip>;
declare const storyMeta: z.ZodObject<{
    status: z.ZodDefault<z.ZodEnum<{
        created: "created";
        "in-progress": "in-progress";
        complete: "complete";
    }>>;
    epic: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Explicit type for Epic so circular Epic↔Story inference doesn’t collapse to never */
export type EpicDef = ModelDefinition<"Epic", typeof epicMeta, Record<string, never>, {
    stories: HasManyDefinition<StoryDef>;
}, {
    isComplete: (self: any) => boolean;
}>;
/** Explicit type for Story so circular Epic↔Story inference doesn’t collapse to never */
export type StoryDef = ModelDefinition<"Story", typeof storyMeta, Record<string, SectionDefinition<any>>, {
    epic: BelongsToDefinition<EpicDef>;
}, {
    isComplete: (self: any) => boolean;
}>;
export declare const Epic: EpicDef;
export declare const Story: StoryDef;
export {};
//# sourceMappingURL=models.d.ts.map
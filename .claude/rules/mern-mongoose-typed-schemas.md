# Typed Mongoose Schemas — Strict Rule

## MANDATORY REQUIREMENT

**Every Mongoose schema MUST be typed via `InferSchemaType` and the type MUST be exported alongside the model.** This ensures type safety across the codebase and prevents runtime surprises from schema-model mismatches.

## Pattern

```typescript
import mongoose, { InferSchemaType } from "mongoose";

const siteSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "archived"] as const,
      default: "active",
    },
  },
  { timestamps: true },
);

export type SiteDocument = InferSchemaType<typeof siteSchema>;

export const Site = mongoose.model("Site", siteSchema);
```

## Rules

1. **Every schema gets a type** — via `InferSchemaType` (never `any`).
2. **Type is exported alongside the model** — consumers `import { Site, type SiteDocument }`.
3. **Schema options are explicit** — always declare `{ timestamps: true }` or `{ timestamps: false }`.
4. **Enum values are typed** — use `as const` on the enum array so TypeScript sees a literal union.
5. **Required fields are marked** — schema `required: true` must appear as non-optional in the type.
6. **Named export the model** — never `export default`.

## File structure

Each model file follows this structure:

```typescript
// 1. Imports
import mongoose, { InferSchemaType } from "mongoose";

// 2. Schema definition
const schema = new mongoose.Schema({ ... }, { timestamps: true });

// 3. Virtuals, methods, hooks (optional)
schema.virtual("fullName").get(function () { /* ... */ });
schema.pre("save", function (next) { /* ... */ });

// 4. Type
export type FooDocument = InferSchemaType<typeof schema>;

// 5. Model
export const Foo = mongoose.model("Foo", schema);
```

## Where Drizzle goes instead

Relational, ordered time-series data lives in Postgres via Drizzle — NOT Mongoose. That includes rank history, keywords, backlinks summaries, competitors, subscriptions, and usage counters. See `drizzle-postgres-scope.md` for the boundary.

## FORBIDDEN

```typescript
// WRONG — no type annotation, default export
export default mongoose.model("Site", new mongoose.Schema({ url: String }));

// WRONG — schema in one file, model in another, no shared type
export const siteSchema = new mongoose.Schema({ ... });   // schema.ts
export const Site = mongoose.model("Site", siteSchema);   // model.ts (no type)

// WRONG — loose String with no validation
url: String  // should have required, trim, lowercase, and constraint

// WRONG — enum without `as const`
status: { type: String, enum: ["active", "archived"] }  // TS sees string, not the literal union
```

## Validation Checklist

- [ ] Every schema has an associated `InferSchemaType` type export
- [ ] Type is exported alongside the model
- [ ] Required fields are marked `required: true` in the schema
- [ ] Enum fields use `as const` on the values array
- [ ] Schema options are explicit (`timestamps`, `toJSON`, …)
- [ ] Model is a named export — no `export default`

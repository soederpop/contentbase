# Models

Models define the structure of markdown documents in this collection. Each document is a markdown file with YAML frontmatter (metadata attributes) and a heading-based structure (sections). Models specify the expected frontmatter fields via a schema, named sections that map to `##` headings in the document body, relationships to other models, and computed properties derived at query time.

## Epics

**Prefix:** `epics`

### Attributes

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| priority | enum(`low`, `medium`, `high`) | optional | — | Importance level for prioritization |
| status | enum(`created`, `in-progress`, `complete`) | optional | `"created"` | Current workflow state |

### Relationships

| Name | Type | Target |
|------|------|--------|
| stories | hasMany | Story |

### Computed Properties

- `isComplete`

### Example

```markdown
---
priority: medium
status: created
---

# Epic Title

A brief description of this epic and its goals.

## Stories

### Story Title

A brief description of this story.

#### Acceptance Criteria

- First acceptance criterion
- Second acceptance criterion

#### Mockups

[Wireframe](https://example.com/wireframe)
```

---

## Stories

**Prefix:** `stories`

### Attributes

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| status | enum(`created`, `in-progress`, `complete`) | optional | `"created"` | Current workflow state |
| epic | string | optional | — | Slug of the parent epic |

### Sections

| Name | Heading | Alternatives | Description |
|------|---------|--------------|-------------|
| acceptanceCriteria | Acceptance Criteria | — | List of acceptance criteria as plain text strings |
| mockups | Mockups | — | Map of mockup label to URL |

### Relationships

| Name | Type | Target |
|------|------|--------|
| epic | belongsTo | Epic |

### Computed Properties

- `isComplete`

### Example

```markdown
---
status: created
epic: epic-slug
---

# Story Title

A brief description of what this story accomplishes.

## Acceptance Criteria

- First acceptance criterion
- Second acceptance criterion
- Third acceptance criterion

## Mockups

[Main View](https://example.com/main-view)
[Detail View](https://example.com/detail-view)
```

# Models

## Epic

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

---

## Story

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

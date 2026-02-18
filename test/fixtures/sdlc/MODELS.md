# Models

## Epic

**Prefix:** `epics`

### Attributes

| Field | Type | Required | Default |
|-------|------|----------|---------|
| priority | enum(`low`, `medium`, `high`) | optional | — |
| status | enum(`created`, `in-progress`, `complete`) | optional | `"created"` |

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

| Field | Type | Required | Default |
|-------|------|----------|---------|
| status | enum(`created`, `in-progress`, `complete`) | optional | `"created"` |
| epic | string | optional | — |

### Sections

| Name | Heading | Alternatives |
|------|---------|--------------|
| acceptanceCriteria | Acceptance Criteria | — |
| mockups | Mockups | — |

### Relationships

| Name | Type | Target |
|------|------|--------|
| epic | belongsTo | Epic |

### Computed Properties

- `isComplete`

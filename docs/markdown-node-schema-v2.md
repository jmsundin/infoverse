# Markdown Node Schema v2

This document defines the canonical markdown representation of an Infoverse node.

## File Shape

Each node file is:

1. YAML frontmatter with persisted structural metadata.
2. Markdown body (`content`) as the semantic source of truth.

```md
---
id: node-123
type: NOTE
x: 120
y: 340
width: 300
height: 200
color: slate
pinned: false
scopeId: parent-scope
parentId: outline-parent
autoExpandDepth: 1
edges:
  - id: edge-1
    target: node-456
    label: related
---

# Node Title

Body markdown content...
```

## Persisted Frontmatter Keys

Required:

- `id: string`
- `type: NOTE | CHAT`

Currently persisted for compatibility/layout bootstrap:

- `x: number`
- `y: number`

Optional:

- `width: number`
- `height: number`
- `color: slate | red | green | blue | amber | purple`
- `pinned: boolean`
- `scopeId: string | null`
- `parentId: string | null`
- `autoExpandDepth: number`
- `edges: EmbeddedEdge[]` where each item is:
  - `id: string`
  - `target: string`
  - `label: string`
  - `scopeId?: string`

## Body Contract

- Body markdown is `GraphNode.content`.
- Body should carry semantic information (headings, prose, lists, links, chat transcript text).
- Runtime-only fields must not be serialized into frontmatter.

## Runtime-Derived Fields (Not Persisted Directly)

Derived from body at read/load time:

- `title` from first level-1 heading (`# ...`), when present.
- `messages` for chat nodes from `**role**: message` blocks.
- `aliases` from wiki-link syntax (`[[target]]`, `[[target|display]]`).
- `link` from first external markdown link (`http/https`).

## Legacy Compatibility Rules

For old files:

- Old `parentId` may represent scope; when `scopeId` is absent, treat `parentId` as `scopeId`.
- Old `outlineParentId` maps to new `parentId`.

## Invariants

- `content` is always loaded from markdown body, not frontmatter.
- Outgoing edges are embedded in source node frontmatter only.
- Frontmatter contains structural metadata; semantic/runtime projections are derived.

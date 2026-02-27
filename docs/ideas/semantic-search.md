---
tags: [ai]
status: spark
---

# Semantic Search Integration

The CLI is based on @soederpop/luca's NodeContainer, which includes a postgres feature.

In theory if we supplied a postgres DATABASE_URL with PGVECTOR installed, we could bootstrap a table to store embeddings

We could rely on the Model's ability to distill content into semantic meaning ( its very purpose ) to provide a representation of the content that has less noise in it, 
that is somewhat marked up, and maybe injected with a little context in hopes of getting richer meaning in the embedding? ( I have no idea )

Anyway the idea would be to provide a `cbase semantic-search` command which you could run any time, and it would only update or add embeddings for content which has changed since last time you read it.

## Note

Semantic Search would not be available when using contentbase as a pure library.  This is because contentbase shouldn't depend on luca for its runtime at all in the library mode.


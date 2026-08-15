# @athena/persist-jsonl — Context

## Vocabulary

**SessionBinding** — write handle produced by `create()` or `open()`. `append()` buffers
to memory synchronously; `flush()` drains to disk with fsync; `close()` flushes then
closes the file handle.

**File format** — `{dir}/{encodeURIComponent(id)}.jsonl`. First line: JSON-serialised
`SessionHeader`. Subsequent lines: one JSON-serialised `SessionEvent` per line.

**prepare(id)** — reads the file, parses header + events, returns a `PreparedSession`.
Used by `SessionRegistry.restore()` for crash recovery. Does not validate invariants
(restore is lenient — spec C3).

**create(header)** — opens with `'wx'` flag (exclusive write); throws `EEXIST` if the
file already exists. Writes the header as the first line.

**open(id)** — opens with `'a'` flag (append); never truncates. Used when resuming a
persisted session.

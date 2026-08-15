export type SurfaceOp =
  | "append"
  | {
      op: "replace";
      start: number;
      end: number;
    };

export interface SurfaceNode {
  readonly seq: number;
  readonly sourceEventSeqs: readonly number[];
  readonly kind: "append" | "replace";
  readonly start?: number;
  readonly end?: number;
}

export interface SurfaceSnapshot {
  readonly nodes: readonly SurfaceNode[];
  readonly generation: number;
}

export class SurfaceManager {
  private nodes: SurfaceNode[] = [];

  private generation = 0;

  get snapshot(): SurfaceSnapshot {
    return Object.freeze({
      nodes: Object.freeze(
        this.nodes.map((node) =>
          Object.freeze({
            ...node,
            sourceEventSeqs: Object.freeze([...node.sourceEventSeqs]),
          }),
        ),
      ),
      generation: this.generation,
    });
  }

  append(seq: number): void {
    this.nodes.push(
      Object.freeze({
        kind: "append",
        seq,
        sourceEventSeqs: [seq],
      }),
    );
  }

  replace(seq: number, start: number, end: number, sourceEventSeqs: readonly number[]): SurfaceNode {
    if (start < 0 || end >= this.nodes.length || start > end) {
      throw new Error(`Invalid Surface replacement range: ${start}..${end}`);
    }

    const shadowed = this.nodes.slice(start, end + 1);
    const expected = new Set(shadowed.flatMap((node) => node.sourceEventSeqs));
    expected.add(seq);
    const provided = new Set(sourceEventSeqs);

    if (provided.size !== expected.size || ![...expected].every((value) => provided.has(value))) {
      throw new Error(`Surface replacement must cite every shadowed source event plus its own seq: ${seq}`);
    }

    const node = Object.freeze({
      kind: "replace",
      seq,
      sourceEventSeqs: [...provided].sort((a, b) => a - b),
      start,
      end,
    });
    this.nodes.splice(start, end - start + 1, node);
    this.generation++;
    return node;
  }
}

export type SurfaceOp =
  | "append"
  | {
      op: "replace";
      start: number;
      end: number;
    };

export interface SurfaceNode {
  seq: number;
  sourceEventSeqs: number[];
  kind: "append" | "replace";
  start?: number;
  end?: number;
}

export interface SurfaceSnapshot {
  nodes: readonly SurfaceNode[];
  generation: number;
}

export class SurfaceManager {
  private nodes: SurfaceNode[] = [];

  private generation = 0;

  get snapshot(): SurfaceSnapshot {
    return {
      nodes: [...this.nodes],
      generation: this.generation,
    };
  }

  append(seq: number): void {
    this.nodes.push({
      kind: "append",
      seq,
      sourceEventSeqs: [seq],
    });
  }

  replace(seq: number, start: number, end: number, sourceEventSeqs: number[]): void {
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

    this.nodes.splice(start, end - start + 1, {
      kind: "replace",
      seq,
      sourceEventSeqs: [...provided].sort((a, b) => a - b),
      start,
      end,
    });
    this.generation++;
  }
}

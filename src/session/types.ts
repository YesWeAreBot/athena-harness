import type { SurfaceOp, SurfaceSnapshot } from "./surface.js";

export interface SessionOptions {
  id?: string;
}

export interface SessionHeader {
  readonly id: string;
  readonly createdAt: number;
}

export interface SessionEvent<T = unknown> {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: T;
  readonly ignorable?: boolean;
  readonly surfaceOp?: SurfaceOp;
  readonly sourceEventSeqs?: readonly number[];
}

export interface SessionSnapshot {
  readonly header: SessionHeader;
  readonly events: readonly SessionEvent[];
  readonly surface: SurfaceSnapshot;
}

export interface AppendOptions {
  ignorable?: boolean;
  surfaceOp?: SurfaceOp;
  sourceEventSeqs?: readonly number[];
}

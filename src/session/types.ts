import type { SurfaceOp, SurfaceSnapshot } from "./surface.js";

export interface SessionOptions {
  id?: string;
}

export interface SessionHeader {
  id: string;
  createdAt: number;
}

export interface SessionEvent<T = unknown> {
  type: string;
  seq: number;
  time: number;
  data: T;
  ignorable?: boolean;
  surfaceOp?: SurfaceOp;
  sourceEventSeqs?: number[];
}

export interface SessionSnapshot {
  header: SessionHeader;
  events: readonly SessionEvent[];
  surface: SurfaceSnapshot;
}

export interface AppendOptions {
  ignorable?: boolean;
  surfaceOp?: SurfaceOp;
  sourceEventSeqs?: number[];
}

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
}

export interface SessionSnapshot {
  header: SessionHeader;
  events: readonly SessionEvent[];
}

export interface AppendOptions {
  ignorable?: boolean;
}

export interface PromptSection {
  readonly name:    string;
  readonly order?:  number;   // sort weight, ascending; default 0
  render(signal?: AbortSignal): string | Promise<string>;
}

export interface AssembleResult {
  /** Final system string — sections joined in order. */
  system:   string;
  /**
   * Stable fingerprint of the rendered content.
   * agent-loop compares this between steps to skip redundant context/snapshot appends.
   * Equal rendered strings guarantee equal system + sections content.
   */
  rendered: string;
  sections: Array<{ name: string; content: string }>;
}

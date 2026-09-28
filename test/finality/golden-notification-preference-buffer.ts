/**
 * Client-side preference write buffer used by the packed golden-path case.
 * Same revision merge/rollback rules as Auth UI NotificationPreferenceWriteBuffer.
 */
export type GoldenPreferenceItem = {
  channel: string;
  digest: string | null;
  enabled: boolean;
  source?: string;
  topic: string;
};

export type GoldenPreferenceMutation =
  | {
      channel: string;
      digest?: string | null;
      enabled: boolean;
      operation: "set";
      topic: string;
    }
  | {
      channel: string;
      operation: "reset";
      topic: string;
    };

function pairKey(topic: string, channel: string): string {
  return `${topic}\u0000${channel}`;
}

export function mergeAuthoritativePreferenceItems(
  previous: readonly GoldenPreferenceItem[],
  nextItems: readonly GoldenPreferenceItem[],
  currentRevision: (topic: string, channel: string) => number,
  flushedRevisions: ReadonlyMap<string, number>
): GoldenPreferenceItem[] {
  const byKey = new Map(
    nextItems.map((item) => [pairKey(item.topic, item.channel), item])
  );
  return previous.map((item) => {
    const key = pairKey(item.topic, item.channel);
    const replacement = byKey.get(key);
    if (!replacement) {
      return item;
    }
    const flushed = flushedRevisions.get(key);
    if (
      flushed === undefined ||
      currentRevision(item.topic, item.channel) !== flushed
    ) {
      return item;
    }
    return replacement;
  });
}

export function rollbackFlushedPreferenceItems(
  previous: readonly GoldenPreferenceItem[],
  rollbacks: ReadonlyMap<string, GoldenPreferenceItem>,
  currentRevision: (topic: string, channel: string) => number,
  flushedRevisions: ReadonlyMap<string, number>
): GoldenPreferenceItem[] {
  return previous.map((item) => {
    const key = pairKey(item.topic, item.channel);
    const flushed = flushedRevisions.get(key);
    if (
      flushed === undefined ||
      currentRevision(item.topic, item.channel) !== flushed
    ) {
      return item;
    }
    return rollbacks.get(key) ?? item;
  });
}

export class GoldenNotificationPreferenceWriteBuffer {
  private readonly pending = new Map<
    string,
    {
      mutation: GoldenPreferenceMutation;
      revision: number;
      rollback: GoldenPreferenceItem;
    }
  >();
  private readonly revisions = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      getItems: () => GoldenPreferenceItem[];
      onFlushError: (error: unknown) => void;
      persist: (
        mutations: GoldenPreferenceMutation[]
      ) => Promise<{ items: GoldenPreferenceItem[] }>;
      setItems: (items: GoldenPreferenceItem[]) => void;
    }
  ) {}

  revisionOf(topic: string, channel: string): number {
    return this.revisions.get(pairKey(topic, channel)) ?? 0;
  }

  bump(topic: string, channel: string): number {
    const key = pairKey(topic, channel);
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    return revision;
  }

  discardPending(): void {
    this.pending.clear();
  }

  enqueueSet(input: {
    channel: string;
    enabled: boolean;
    topic: string;
  }): void {
    const key = pairKey(input.topic, input.channel);
    const current = this.options.getItems();
    const existing = this.pending.get(key);
    const rollback = existing?.rollback ??
      current.find(
        (item) => item.topic === input.topic && item.channel === input.channel
      ) ?? {
        channel: input.channel,
        digest: null,
        enabled: !input.enabled,
        topic: input.topic,
      };
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    this.pending.set(key, {
      mutation: {
        channel: input.channel,
        enabled: input.enabled,
        operation: "set",
        topic: input.topic,
      },
      revision,
      rollback,
    });
    this.options.setItems(
      current.map((item) =>
        item.topic === input.topic && item.channel === input.channel
          ? { ...item, enabled: input.enabled, source: "user" }
          : item
      )
    );
  }

  async flushNow(): Promise<void> {
    this.chain = this.chain.then(() => this.flushPending());
    await this.chain;
  }

  private async flushPending(): Promise<void> {
    if (this.pending.size === 0) {
      return;
    }
    const batch = [...this.pending.entries()];
    this.pending.clear();
    const flushedRevisions = new Map(
      batch.map(([key, entry]) => [key, entry.revision])
    );
    const rollbacks = new Map(
      batch.map(([key, entry]) => [key, entry.rollback])
    );
    try {
      const result = await this.options.persist(
        batch.map(([, entry]) => entry.mutation)
      );
      this.options.setItems(
        mergeAuthoritativePreferenceItems(
          this.options.getItems(),
          result.items,
          (topic, channel) => this.revisionOf(topic, channel),
          flushedRevisions
        )
      );
    } catch (error) {
      this.options.setItems(
        rollbackFlushedPreferenceItems(
          this.options.getItems(),
          rollbacks,
          (topic, channel) => this.revisionOf(topic, channel),
          flushedRevisions
        )
      );
      this.options.onFlushError(error);
    }
  }
}

export interface CanonicalEventSource {
  readonly domain: string;
  readonly provider?: string;
}

export interface CanonicalEventSubject {
  readonly id: string;
  readonly type: string;
}

export interface CanonicalEventCausality {
  readonly causationId?: string;
  readonly correlationId?: string;
}

export interface CanonicalEventRevision {
  readonly providerUpdatedAt?: Date;
  readonly sequence?: string;
}

export interface CanonicalEventIR<
  TName extends string = string,
  TPayload = unknown,
> {
  readonly causality: CanonicalEventCausality;
  readonly id: string;
  readonly ingressId?: string;
  readonly name: TName;
  readonly observedAt: Date;
  readonly occurredAt: Date;
  readonly payload: TPayload;
  readonly revision?: CanonicalEventRevision;
  readonly source: CanonicalEventSource;
  readonly subject: CanonicalEventSubject;
}

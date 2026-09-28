/**
 * Backend-native type descriptor, separate from the semantic {@link SchemaType}.
 */
export type PostgresIntervalQualifier =
  | "year"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "year to month"
  | "day to hour"
  | "day to minute"
  | "day to second"
  | "hour to minute"
  | "hour to second"
  | "minute to second";

export interface NativeTypeDescriptor {
  readonly arrayDimensions: number;
  readonly backend: string;
  readonly intervalQualifier?: PostgresIntervalQualifier;
  readonly length?: number | null;
  readonly name: string;
  readonly precision?: number | null;
  readonly scale?: number | null;
}

export interface SchemaScalarType {
  readonly kind: "scalar";
  readonly native: NativeTypeDescriptor;
  readonly semantic: string;
}

export interface SchemaEnumType {
  readonly enumId: string;
  readonly kind: "enum";
  readonly native: NativeTypeDescriptor;
}

export interface SchemaNativeOnlyType {
  readonly kind: "native";
  readonly native: NativeTypeDescriptor;
}

/** Discriminated union: semantic family vs native-only vs enum reference. */
export type SchemaType =
  | SchemaScalarType
  | SchemaEnumType
  | SchemaNativeOnlyType;

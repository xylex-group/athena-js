/**
 * Backend-native type descriptor, separate from the semantic {@link SchemaType}.
 */
export interface NativeTypeDescriptor {
	readonly backend: string;
	readonly name: string;
	readonly length?: number | null;
	readonly precision?: number | null;
	readonly scale?: number | null;
	readonly arrayDimensions: number;
}

export interface SchemaScalarType {
	readonly kind: "scalar";
	readonly semantic: string;
	readonly native: NativeTypeDescriptor;
}

export interface SchemaEnumType {
	readonly kind: "enum";
	readonly enumId: string;
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

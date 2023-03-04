import type {
	CommonsMediaValue,
	ExternalIdValue,
	GlobeCoordinateValue,
	ItemValue,
	MonolingualTextValue,
	PropertyValue,
	QuantityValue,
	StringValue,
	TimeValue,
	UrlValue,
	Value
} from './values';
import type { DataValueType } from './types';

export interface DataValue {
	value: Value;
	type: DataValueType;
}

export interface CommonsMediaDataValue {
	value: CommonsMediaValue;
	type: 'string';
}

export interface ExternalIdDataValue {
	value: ExternalIdValue;
	type: 'string';
}

export interface GlobeCoordinateDataValue {
	value: GlobeCoordinateValue;
	type: 'globecoordinate';
}

export interface ItemDataValue {
	value: ItemValue;
	type: 'wikibase-entityid';
}

export interface MonolingualTextDataValue {
	value: MonolingualTextValue;
	type: 'monolingualtext';
}

export interface PropertyDataValue {
	value: PropertyValue;
	type: 'wikibase-entityid';
}

export interface QuantityDataValue {
	value: QuantityValue;
	type: 'quantity';
}

export interface StringDataValue {
	value: StringValue;
	type: 'string';
}

export interface TimeDataValue {
	value: TimeValue;
	type: 'time';
}

export interface UrlDataValue {
	value: UrlValue,
	type: 'string'
}

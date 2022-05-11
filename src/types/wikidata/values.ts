import { Entity, ItemId, PropertyId, Unit } from './types';

export type CommonsMediaValue = string;

export interface EntityIdValue {
	id: string;
	label?: string;
	description?: string;
}

export type ExternalIdValue = string;

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Geographic_locations
export interface GlobeCoordinateValue {
	latitude: number;
	longitude: number;
	altitude: null;
	precision: number;
	globe: Entity;
}

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Wikidata_items
export interface ItemValue {
	'entity-type': 'item';
	'numeric-id': number;
	id: ItemId;
}

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Monolingual_texts
export interface MonolingualTextValue {
	language: string;
	text: string;
}

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Wikidata_properties
export interface PropertyValue {
	'entity-type': 'item';
	'numeric-id': number;
	id: PropertyId;
}

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Quantities
export interface QuantityValue {
	amount: string;
	lowerBound?: string;
	upperBound?: string;
	unit: Unit;
}

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Strings_that_are_not_translated
export type StringValue = string;

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Dates_and_times
export interface TimeValue {
	time: string;
	timezone?: number;
	before?: number;
	after?: number;
	precision: number;
	calendarmodel: Entity;
}

export type UrlValue = string;

export type Value =
	CommonsMediaValue
	| EntityIdValue
	| GlobeCoordinateValue
	| ItemValue
	| MonolingualTextValue
	| StringValue
	| TimeValue
	| QuantityValue
	| UrlValue;

import { Entity, Unit } from './types';

export type CommonsMediaValue = string;

export interface EntityIdValue {
	id: string;
	label?: string;
	description?: string;
}

export type ExternalIdValue = string;

export interface ItemValue {
	'entity-type': 'item';
	'numeric-id': number;
	id: string;
}

export interface MonolingualTextValue {
	language: string;
	text: string;
}

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

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Quantities
export interface QuantityValue {
	amount: string;
	lowerBound?: string;
	upperBound?: string;
	unit: Unit;
}

export type UrlValue = string;

export type Value =
	CommonsMediaValue
	| EntityIdValue
	| ItemValue
	| MonolingualTextValue
	| StringValue
	| TimeValue
	| QuantityValue
	| UrlValue;

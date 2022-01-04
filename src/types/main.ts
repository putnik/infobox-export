import { ItemId, PropertyId, SnakType, Unit } from './wikidata/types';
import { Reference, SnaksObject } from './wikidata/main';

export interface KeyValue {
	[ key: string ]: any;
}

export interface TimeGuess {
	type: SnakType;
	isoDate?: Date;
	precision?: number;
}

export interface Title {
	label: string;
	language: string;
	project: string;
	qualifiers?: SnaksObject;
}

export interface Translations {
	[ key: string ]: KeyValue;
}

export interface FixedValue {
	property: PropertyId;
	search: string;
	item: ItemId;
	label: string;
}

export interface Context {
	propertyId: PropertyId;
	text: string;
	$field: JQuery;
	$wrapper: JQuery;
}

export interface Constraints {
	integer: boolean;
	unique: boolean;
	unitOptional: boolean;
	qualifier: PropertyId[];
}

export interface Property {
	datatype: string;
	label: string;
	constraints: Constraints;
	formatter: string;
	units: ItemId[];
}

export interface Config {
	version: string;
	project: string;
	'storage-key': string;
	references: { [ key: string ]: Reference };
	units: { [ key: string ]: Unit[] };
	centuries: string[];
	properties: { [ key: string ]: Property };
}

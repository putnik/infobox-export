import { DataType, ItemId, PropertyId, SnakType, Unit } from './wikidata/types';
import { Reference, SnaksObject } from './wikidata/main';

export interface KeyValue {
	[ key: string ]: any;
}

export interface IdKeyValue extends KeyValue {
	id: ItemId | PropertyId;
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
	redirect?: string;
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
	format?: string;
	integer: boolean;
	noneOfTypes: {
		[ key: ItemId ]: PropertyId | null;
	};
	noneOfValues: {
		[ key: ItemId ]: ItemId | null;
	};
	oneOfValues: ItemId[];
	qualifier: PropertyId[];
	unique: boolean;
	unitOptional: boolean;
	valueType: ItemId[];
}

export interface Property {
	id: PropertyId;
	datatype: DataType;
	label: string;
	aliases: string[];
	constraints: Constraints;
	formatter: string;
	units: ItemId[];
}

export interface Config {
	version: string;
	project: string;
	references: { [ key: string ]: Reference };
	units: { [ key: string ]: Unit[] };
	fixedValues: FixedValue[];
	centuries: string[];
	properties: { [ key: string ]: Property };
}

export interface ItemLabel {
	label: string;
	description: string;
}

export interface UnitsData {
	[ key: ItemId ]: string[];
}

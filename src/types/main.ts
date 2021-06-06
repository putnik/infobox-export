import { ItemId, PropertyId, SnakType } from './wikidata/types';

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
	qualifiers?: KeyValue;
	year?: any;
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

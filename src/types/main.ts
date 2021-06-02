import { SnakType } from './wikidata';

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
	[ key: string ]: KeyValue
}

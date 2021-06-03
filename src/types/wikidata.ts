import { KeyValue } from './main';
import {
	CommonsMediaValue,
	EntityIdValue,
	ItemValue,
	MonolingualTextValue,
	QuantityValue,
	StringValue,
	TimeValue,
	UrlValue
} from './wikidata/values';

export type SnakType = 'value' | 'novalue' | 'somevalue' | 'empty';
export type DataType =
	'commonsMedia'
	| 'external-id'
	| 'geo-shape'
	| 'globe-coordinate'
	| 'math'
	| 'monolingualtext'
	| 'musical-notation'
	| 'quantity'
	| 'string'
	| 'tabular-data'
	| 'time'
	| 'url'
	| 'wikibase-form'
	| 'wikibase-item'
	| 'wikibase-lexeme'
	| 'wikibase-property'
	| 'wikibase-sense';
export type DataValueType = 'string' | 'time' | 'wikibase-entityid'

export type WikidataValue =
	CommonsMediaValue
	| EntityIdValue
	| ItemValue
	| MonolingualTextValue
	| StringValue
	| TimeValue
	| QuantityValue
	| UrlValue;

export interface WikidataSnak {
	value: WikidataValue;
	type: DataType;
	qualifiers?: KeyValue;
	references?: KeyValue;
}

export interface WikidataMainSnak {
	snaktype: SnakType;
	property: string;
	datatype?: DataType | DataValueType;
	datavalue?: WikidataSnak;
}

export interface WikidataSource {
	snaks: {
		[ key: string ]: WikidataMainSnak[];
	}
}

export interface WikidataClaim {
	type: string;
	mainsnak: WikidataMainSnak;
	qualifiers?: KeyValue;
	id: string;
	references: any;
	rank: string;
}

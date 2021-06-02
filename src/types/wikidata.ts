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
	| 'monolingualtext'
	| 'quantity'
	| 'string'
	| 'time'
	| 'url'
	| 'wikibase-item';
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
	type?: DataValueType | DataType; // FIXME
	qualifiers?: KeyValue;
	references?: KeyValue;
}

export interface WikidataSnakContainer {
	wd: WikidataSnak;
	label?: JQuery;
}

export interface WikidataMainSnak {
	snaktype: SnakType;
	property: string;
	datatype?: DataType;
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

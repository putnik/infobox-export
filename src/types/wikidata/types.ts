export type ItemId = `Q${number}`
export type PropertyId = `P${number}`
export type Entity = `http://www.wikidata.org/entity/${ItemId}`
export type Unit = Entity | '1';

export type Rank = 'normal' | 'preferred' | 'deprecated';

export type SnakType = 'value' | 'novalue' | 'somevalue';

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

export type DataValueType =
	'globecoordinate'
	| 'monolingualtext'
	| 'quantity'
	| 'string'
	| 'time'
	| 'wikibase-entityid'

export const typesMapping: { [key in DataType]: DataValueType } = {
	commonsMedia: 'string',
	'external-id': 'string',
	'geo-shape': 'string',
	'globe-coordinate': 'globecoordinate',
	math: 'string',
	monolingualtext: 'monolingualtext',
	'musical-notation': 'string',
	quantity: 'quantity',
	string: 'string',
	'tabular-data': 'string',
	time: 'time',
	url: 'string',
	'wikibase-form': 'wikibase-entityid',
	'wikibase-item': 'wikibase-entityid',
	'wikibase-lexeme': 'wikibase-entityid',
	'wikibase-property': 'wikibase-entityid',
	'wikibase-sense': 'wikibase-entityid'
};

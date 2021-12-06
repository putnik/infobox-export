import { DataType, PropertyId, Rank, SnakType } from './types';
import { DataValue } from './datavalues';
import { ItemValue } from './values';

export interface Snak {
	snaktype: SnakType;
	property: PropertyId;
	hash?: string;
	datavalue?: DataValue;
	datatype?: DataType;
}

export type SnaksObject = {
	[ key: string ]: Snak[]
};

export interface Reference {
	hash?: string;
	snaks: SnaksObject
	'snaks-order'?: string[];
}

export interface StatementMeta {
	subclassItem?: ItemValue;
}

export interface Statement {
	mainsnak: Snak;
	type: 'statement';
	id: string;
	rank: Rank;

	qualifiers?: SnaksObject;
	references?: Reference[];

	meta?: StatementMeta;
}

export interface ClaimsObject {
	[ key: string ]: Statement[]
}

import type { DataType, PropertyId, Rank, SnakType } from './types';
import type { DataValue } from './datavalues';
import type { ItemValue } from './values';
import type { Title } from '../main';

export interface Snak {
	snaktype: SnakType;
	property: PropertyId;
	hash?: string;
	datavalue?: DataValue;
	datatype?: DataType;
}

export type SnaksObject = {
	[ key: string ]: Snak[];
};

export interface Reference {
	hash?: string;
	snaks: SnaksObject;
	'snaks-order'?: string[];
}

export interface StatementMeta {
	subclassItem?: ItemValue;
	title?: Title;
	$checkbox?: JQuery;
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
	[ key: string ]: Statement[];
}

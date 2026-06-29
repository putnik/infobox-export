import type { DataType, PropertyId, Rank, SnakType } from './types';
import type { DataValue } from './datavalues';
import type { ItemValue, TimeValue } from './values';
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
	alreadyExists?: boolean;
	// guid/dateProp: the dateless statement to add the date to. snakHash + precise
	// mean a precision upgrade (replace the coarser date at snakHash).
	// targetClaim is the existing Wikidata claim, carried so the date + reference
	// can be merged into it and saved as a single edit.
	enrich?: { guid: string; dateProp: string; snakHash?: string; precise?: boolean; skipImportRef?: boolean; targetClaim?: Statement; };
	partIds?: string[];
	// Came from a data-wikidata-value-id, so its qualifiers are used as-is.
	fromValueId?: boolean;
	// Date(s) whose qualifier (P580/P585/P582) the user picks in the dialog. A
	// range yields two entries. selected === null means nothing is preselected.
	dateChoices?: { value: TimeValue; selected: PropertyId | null }[];
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

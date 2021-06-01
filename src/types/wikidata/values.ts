export interface CommonsMediaValue {
	value: string;
}

export interface EntityIdValue {
	id: string;
	label?: string;
	description?: string;
}

export interface ItemValue {
	id: string;
}

export interface MonolingualTextValue {
	language: string;
	text: string;
}

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Dates_and_times
export interface TimeValue {
	time: string;
	precision: number;
	after?: number;
	before?: number;
	timezone?: number;
	calendarmodel?: string;
}

// https://www.mediawiki.org/wiki/Wikibase/DataModel#Quantities
export interface QuantityValue {
	amount: string;
	lowerBound?: string;
	upperBound?: string;
	unit?: string;

	/** @deprecated */
	bound?: string;
}

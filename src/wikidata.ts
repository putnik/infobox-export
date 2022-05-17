import { getLabelValue, getRandomHex, clone, unique } from './utils';
import { getWdApi, wdApiRequest } from './api';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import { ItemLabel, KeyValue, Title } from './types/main';
import { ItemValue } from './types/wikidata/values';
import { ApiResponse } from './types/api';
import { Entity, ItemId, PropertyId } from './types/wikidata/types';
import { Statement, Snak, Reference, ClaimsObject } from './types/wikidata/main';
import { ItemDataValue } from './types/wikidata/datavalues';

const $ = require( 'jquery' );
const mw = require( 'mw' );

export const grigorianCalendar: Entity = 'http://www.wikidata.org/entity/Q1985727';
export const julianCalendar: Entity = 'http://www.wikidata.org/entity/Q1985786';

let baseRevId: string;
const entityId: string = mw.config.get( 'wgWikibaseItemId' );
const itemLabels: { [ key: string ]: ItemLabel } = {};

export function setBaseRevId( value: string ): void {
	baseRevId = value;
}

export function randomEntityGuid(): string {
	const template: string = 'xx-x-x-x-xxx';
	let guid: string = '';
	for ( let i = 0; i < template.length; i++ ) {
		if ( template.charAt( i ) === '-' ) {
			guid += '-';
			continue;
		}

		let hex: string;
		if ( i === 3 ) {
			hex = getRandomHex( 16384, 20479 );
		} else if ( i === 4 ) {
			hex = getRandomHex( 32768, 49151 );
		} else {
			hex = getRandomHex( 0, 65535 );
		}

		while ( hex.length < 4 ) {
			hex = '0' + hex;
		}

		guid += hex;
	}

	return entityId + '$' + guid;
}

export function stringifyStatement( statement: Statement ): string {
	const rawStatement = clone( statement );
	rawStatement.meta = null;
	return JSON.stringify( rawStatement );
}

export function generateItemSnak( propertyId: PropertyId, entityId: ItemId ): Snak {
	const value: ItemValue = {
		'entity-type': 'item',
		'numeric-id': parseInt( entityId.replace( 'Q', '' ), 10 ),
		id: entityId
	};
	const dataValue: ItemDataValue = {
		type: 'wikibase-entityid',
		value: value
	};
	return {
		snaktype: 'value',
		property: propertyId,
		datavalue: dataValue,
		datatype: 'wikibase-item'
	};
}

export function convertSnakToStatement( snak: Snak, references: Reference[] ): Statement {
	return {
		mainsnak: snak,
		type: 'statement',
		id: randomEntityGuid(),
		rank: 'normal',
		references: references,
		meta: {}
	};
}

function setItemLabel( itemId: ItemId, itemData: KeyValue ): void {
	itemLabels[ itemId ] = {
		label: getLabelValue( itemData?.labels, [ userLanguage, contentLanguage ], itemId ),
		description: getLabelValue( itemData?.descriptions, [ userLanguage, contentLanguage ] )
	};
}

export async function loadItemLabels( itemIds: ItemId[] ): Promise<void> {
	const missedItemIds: ItemId[] = itemIds.filter( ( itemId: ItemId ) => !itemLabels[ itemId ] );
	if ( !missedItemIds.length ) {
		return;
	}
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		ids: missedItemIds,
		languages: allLanguages,
		props: [ 'labels', 'descriptions' ]
	} );
	for ( let i = 0; i < missedItemIds.length; i++ ) {
		const itemId: ItemId = itemIds[ i ];
		setItemLabel( itemId, data.entities[ itemId ] );
	}
}

export async function getItemLabel( itemId: ItemId ): Promise<ItemLabel> {
	if ( !itemLabels[ itemId ] ) {
		await loadItemLabels( [ itemId ] );
	}
	return itemLabels[ itemId ];
}

export async function getStatements( propertyId: PropertyId, titles: Title[], references: Reference[] ): Promise<Statement[]> {
	if ( !titles.length ) {
		return [];
	}

	let languages: string[] = titles.map( function ( title: Title ) {
		return title.language;
	} );
	languages = $.merge( languages, allLanguages );
	languages = unique( languages );

	const sites: string[] = titles.map( function ( title: Title ) {
		return title.project;
	} );

	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		sites: sites,
		languages: languages,
		props: [ 'labels', 'descriptions', 'claims', 'sitelinks' ],
		titles: titles.map( function ( title: Title ) {
			return title.label;
		} ),
		sitefilter: sites
	} );
	if ( !data.success ) {
		return [];
	}

	let statements: Statement[] = [];
	for ( const entityId in data.entities ) {
		if ( !data.entities.hasOwnProperty( entityId ) || !entityId.match( /^Q/ ) ) {
			continue;
		}

		const entity = data.entities[ entityId ];
		const typeIds: ItemId[] = getItemPropertyValues( entity?.claims, 'P31' );
		if ( typeIds.includes( 'Q4167410' ) ) {
			continue; // skip disambigs
		}

		setItemLabel( entityId as ItemId, entity );

		let subclassFound: boolean | string = false;
		let subclassEntity: any;
		let subclassEntityId: ItemId;
		const subclassPropertyIds: PropertyId[] = [ 'P17', 'P31', 'P131', 'P279', 'P361' ];
		for ( const candidateId in data.entities ) {
			if ( !data.entities.hasOwnProperty( candidateId ) || !candidateId.match( /^Q/ ) || entityId === candidateId ) {
				continue;
			}

			subclassFound = subclassPropertyIds.find( function ( propertyId: PropertyId ): boolean {
				const values = data.entities[ candidateId ]?.claims?.[ propertyId ] || [];
				return values.find( function ( statement: Statement ): boolean {
					const value: ItemValue = ( statement.mainsnak?.datavalue?.value || {} ) as ItemValue;
					const result: boolean = value.id === entityId;
					if ( result ) {
						subclassEntityId = candidateId as ItemId;
						subclassEntity = data.entities[ candidateId ];
					}
					return result;
				} );
			} );

			if ( subclassFound ) {
				break;
			}
		}

		const snak: Snak = generateItemSnak( propertyId, entityId as ItemId );
		const statement: Statement = convertSnakToStatement( snak, references );

		if ( subclassFound && subclassEntity ) {
			statement.meta.subclassItem = {
				'entity-type': 'item',
				'numeric-id': parseInt( subclassEntityId.replace( 'Q', '' ), 10 ),
				id: subclassEntityId
			};
		}

		const lowerLabel: string = getLabelValue( entity.labels, [ contentLanguage, userLanguage ] ).toLowerCase();
		const relatedTitles: Title[] = titles.filter( function ( title: Title ) {
			if ( title.label.toLowerCase() === lowerLabel ) {
				return true;
			}
			for ( const i in entity.sitelinks ) {
				if ( !entity.sitelinks.hasOwnProperty( i ) ) {
					continue;
				}
				if ( title.label.toLowerCase() === entity.sitelinks[ i ].title.toLowerCase() ) {
					return true;
				}
			}
			return false;
		} );

		if ( relatedTitles.length === 1 ) {
			statement.meta.title = relatedTitles.shift();
			statement.qualifiers = statement.meta.title.qualifiers;
		}

		statements.push( statement );
	}

	const badRedirectItemIds: ItemId[] = [];
	for ( let i = 0; i < statements.length; i++ ) {
		const title: Title | undefined = statements[ i ]?.meta?.title;
		if ( !title?.redirect ) {
			continue;
		}
		statements.forEach( function ( statement: Statement ) {
			if ( statement?.meta?.title?.label === title?.redirect &&
				statement?.meta?.title?.project === title.project &&
				statement.mainsnak.snaktype === 'value'
			) {
				badRedirectItemIds.push( ( statement.mainsnak.datavalue.value as ItemValue ).id );
			}
		} );
	}
	statements = statements.filter( ( statement: Statement ) => (
		!badRedirectItemIds.includes( ( statement.mainsnak.datavalue.value as ItemValue ).id )
	) );

	return statements;
}

/**
 * Creates statements in Wikidata or return error message otherwise
 */
export async function createClaim( statement: Statement ): Promise<string|null> {
	return getWdApi().postWithToken( 'csrf', {
		action: 'wbsetclaim',
		claim: stringifyStatement( statement ),
		baserevid: baseRevId,
		tags: 'InfoboxExport gadget'
	} ).then( ( _: string, response: ApiResponse ): null => {
		if ( response?.pageinfo?.lastrevid ) {
			baseRevId = response.pageinfo.lastrevid;
		}
		return null;
	} ).catch( ( _: string, errorResponse: ApiResponse ): string => {
		return errorResponse?.error?.info || 'Network error';
	} );
}

export async function wbFormatValue( snak: Snak ): Promise<JQuery> {
	const response: ApiResponse = await wdApiRequest( {
		action: 'wbformatvalue',
		generate: 'text/html; disposition=verbose',
		datavalue: JSON.stringify( snak.datavalue ),
		datatype: snak.datatype,
		uselang: userLanguage
	} );
	if ( response.errors ) {
		const firstError: string = response.errors[ 0 ][ '*' ];
		return $( '<span>' ).addClass( 'error' ).text( firstError );
	}
	return $( '<span>' )
		.addClass( 'infobox-export-main-label' )
		.html( response.result );
}

export function convertStatementsToClaimsObject( statements: Statement[] ): ClaimsObject {
	const claimObject: ClaimsObject = {};
	for ( const i in statements ) {
		const statement: Statement = statements[ i ];
		const propertyId: PropertyId = statement.mainsnak.property;
		if ( claimObject[ propertyId ] === undefined ) {
			claimObject[ propertyId ] = [];
		}
		claimObject[ propertyId ].push( statement );
	}
	return claimObject;
}

export function createNovalueSnak( propertyId: PropertyId ): Snak {
	return {
		snaktype: 'novalue',
		property: propertyId
	};
}

export function getItemPropertyValues( claims: ClaimsObject | undefined, propertyId: PropertyId ): ItemId[] {
	if ( claims?.[ propertyId ] === undefined ) {
		return [];
	}
	return claims[ propertyId ].map(
		( statement: Statement ) => ( statement.mainsnak.datavalue?.value as ItemValue | undefined )?.id
	).filter( ( itemId: ItemId ) => itemId );

}

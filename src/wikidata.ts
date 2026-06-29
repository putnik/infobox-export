import { getLabelValue, getRandomHex, clone, unique } from './utils';
import { getWdApi, wdApiRequest } from './api';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import type { ItemLabel, KeyValue, Title } from './types/main';
import type { ItemValue } from './types/wikidata/values';
import type { ApiResponse } from './types/api';
import type { Entity, ItemId, PropertyId } from './types/wikidata/types';
import type { Statement, Snak, Reference, ClaimsObject } from './types/wikidata/main';
import type { ItemDataValue } from './types/wikidata/datavalues';

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
	for ( let i: number = 0; i < missedItemIds.length; i++ ) {
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

	// Match titles to items by sitelink. Two items can share a label (a Soviet
	// order and a same-named foreign one), so a label match alone isn't enough.
	const hasSitelinkOwner = function ( title: Title ): boolean {
		for ( const candidateId in data.entities ) {
			if ( !data.entities.hasOwnProperty( candidateId ) || !candidateId.match( /^Q/ ) ) {
				continue;
			}
			const sitelinks = data.entities[ candidateId ].sitelinks || {};
			for ( const i in sitelinks ) {
				if ( sitelinks.hasOwnProperty( i ) &&
					title.label.toLowerCase() === sitelinks[ i ].title.toLowerCase()
				) {
					return true;
				}
			}
		}
		return false;
	};

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

		const lowerLabel: string = getLabelValue( entity.labels, [ contentLanguage, userLanguage ] ).toLowerCase();
		const relatedTitles: Title[] = titles.filter( function ( title: Title ): boolean {
			// sitelink match
			for ( const i in entity.sitelinks ) {
				if ( entity.sitelinks.hasOwnProperty( i ) &&
					title.label.toLowerCase() === entity.sitelinks[ i ].title.toLowerCase()
				) {
					return true;
				}
			}
			// label match, but only if no item already owns the title by sitelink
			if ( title.label.toLowerCase() === lowerLabel && !hasSitelinkOwner( title ) ) {
				return true;
			}
			return false;
		} );

		// One statement per mention, so an award won several times isn't collapsed.
		const pushStatement = ( relatedTitle?: Title ): void => {
			const snak: Snak = generateItemSnak( propertyId, entityId as ItemId );
			const statement: Statement = convertSnakToStatement( snak, references );
			if ( subclassFound && subclassEntity ) {
				statement.meta.subclassItem = {
					'entity-type': 'item',
					'numeric-id': parseInt( subclassEntityId.replace( 'Q', '' ), 10 ),
					id: subclassEntityId
				};
			}
			if ( relatedTitle ) {
				statement.meta.title = relatedTitle;
				statement.qualifiers = relatedTitle.qualifiers;
			}
			// Keep the parts (P527) so a broad value can be dropped when a more
			// specific part is already on Wikidata.
			const partIds: ItemId[] = getItemPropertyValues( entity?.claims, 'P527' );
			if ( partIds.length ) {
				statement.meta.partIds = partIds;
			}
			statements.push( statement );
		};
		// Repeated mentions only matter for awards (P166).
		if ( propertyId === 'P166' && relatedTitles.length > 1 ) {
			relatedTitles.forEach( ( relatedTitle: Title ): void => pushStatement( relatedTitle ) );
		} else {
			pushStatement( relatedTitles.length === 1 ? relatedTitles[ 0 ] : undefined );
		}
	}

	// A redirect title and its target can both produce a statement. If the redirect
	// has its own item, keep that one and drop the target. If they end up on the
	// same item, drop the duplicate target and keep the source (it has the dates).
	const badRedirectItemIds: ItemId[] = [];
	const redundantStatements: Set<Statement> = new Set();
	for ( let i: number = 0; i < statements.length; i++ ) {
		const title: Title | undefined = statements[ i ]?.meta?.title;
		if ( !title?.redirect ) {
			continue;
		}
		const sourceItemId: ItemId | undefined = ( statements[ i ].mainsnak.datavalue?.value as ItemValue | undefined )?.id;
		statements.forEach( function ( statement: Statement ): void {
			if ( statement === statements[ i ] ||
				statement?.meta?.title?.label !== title?.redirect ||
				statement?.meta?.title?.project !== title.project ||
				statement.mainsnak.snaktype !== 'value'
			) {
				return;
			}
			const targetItemId: ItemId = ( statement.mainsnak.datavalue.value as ItemValue ).id;
			if ( targetItemId === sourceItemId ) {
				redundantStatements.add( statement );
			} else {
				badRedirectItemIds.push( targetItemId );
			}
		} );
	}
	statements = statements.filter( ( statement: Statement ) => (
		!redundantStatements.has( statement ) &&
		!badRedirectItemIds.includes( ( statement.mainsnak.datavalue.value as ItemValue ).id )
	) );

	return statements;
}

/**
 * Creates statements in Wikidata or return error message otherwise
 */
export async function addDateQualifier( statement: Statement ): Promise<string|null> {
	const enrich = statement.meta?.enrich;
	const snaks: Snak[] | undefined = enrich ? statement.qualifiers?.[ enrich.dateProp ] : undefined;
	if ( !enrich || !snaks || !snaks.length || !snaks[ 0 ].datavalue ) {
		return 'No date to add';
	}
	const dateSnak: Snak = JSON.parse( JSON.stringify( snaks[ 0 ] ) );
	delete dateSnak.hash;

	// The reference(s) to add, dropping a duplicate "imported from" one — they differ
	// only by the oldid, so it would just pile up a near-duplicate.
	const referencesToAdd: Reference[] = ( statement.references || [] ).filter( ( reference: Reference ): boolean => {
		const isImportRef: boolean = !!( reference.snaks?.P143 || reference.snaks?.P4656 );
		return !( isImportRef && enrich.skipImportRef );
	} );

	// Merge the date (and reference) into the existing claim and save it as a single
	// edit, instead of separate wbsetqualifier + wbsetreference calls.
	if ( enrich.targetClaim ) {
		const merged: Statement = JSON.parse( JSON.stringify( enrich.targetClaim ) );
		merged.meta = {};
		merged.qualifiers = merged.qualifiers || {};
		const dateQualifiers: Snak[] = merged.qualifiers[ enrich.dateProp ] || [];
		if ( enrich.snakHash ) {
			// Precision upgrade: replace the coarser date in place.
			const index: number = dateQualifiers.findIndex( ( s: Snak ): boolean => s.hash === enrich.snakHash );
			if ( index !== -1 ) {
				dateQualifiers[ index ] = dateSnak;
			} else {
				dateQualifiers.push( dateSnak );
			}
		} else {
			dateQualifiers.push( dateSnak );
		}
		merged.qualifiers[ enrich.dateProp ] = dateQualifiers;
		merged.references = ( merged.references || [] ).concat( referencesToAdd );
		return createClaim( merged );
	}

	// Fallback (no captured claim): set the qualifier, then the reference(s).
	const params: KeyValue = {
		action: 'wbsetqualifier',
		claim: enrich.guid,
		property: enrich.dateProp,
		snaktype: 'value',
		value: JSON.stringify( snaks[ 0 ].datavalue.value ),
		baserevid: baseRevId,
		tags: 'InfoboxExport gadget'
	};
	if ( enrich.snakHash ) {
		params.snakhash = enrich.snakHash;
	}
	const qualifierError: string | null = await new Promise( ( resolve ): void => {
		getWdApi().postWithToken( 'csrf', params ).then( ( response: ApiResponse ): void => {
			if ( response?.pageinfo?.lastrevid ) {
				baseRevId = response.pageinfo.lastrevid;
			}
			resolve( null );
		} ).catch( ( _: string, errorResponse: ApiResponse ): void => {
			resolve( errorResponse?.error?.info || 'Network error' );
		} );
	} );
	if ( qualifierError ) {
		return qualifierError;
	}
	for ( const reference of referencesToAdd ) {
		const referenceError: string | null = await addReferenceToClaim( enrich.guid, reference );
		if ( referenceError ) {
			return referenceError;
		}
	}
	return null;
}

function addReferenceToClaim( guid: string, reference: Reference ): Promise<string|null> {
	const params: KeyValue = {
		action: 'wbsetreference',
		statement: guid,
		snaks: JSON.stringify( reference.snaks ),
		baserevid: baseRevId,
		tags: 'InfoboxExport gadget'
	};
	if ( reference[ 'snaks-order' ] ) {
		params[ 'snaks-order' ] = JSON.stringify( reference[ 'snaks-order' ] );
	}
	return new Promise( ( resolve ): void => {
		getWdApi().postWithToken( 'csrf', params ).then( ( response: ApiResponse ): void => {
			if ( response?.pageinfo?.lastrevid ) {
				baseRevId = response.pageinfo.lastrevid;
			}
			resolve( null );
		} ).catch( ( _: string, errorResponse: ApiResponse ): void => {
			// Reference already there — not an error for us.
			const info: string = errorResponse?.error?.info || '';
			if ( /already.*reference|reference with hash/i.test( info ) ) {
				resolve( null );
				return;
			}
			resolve( info || 'Network error' );
		} );
	} );
}

export async function createClaim( statement: Statement ): Promise<string|null> {
	return getWdApi().postWithToken( 'csrf', {
		action: 'wbsetclaim',
		claim: stringifyStatement( statement ),
		baserevid: baseRevId,
		tags: 'InfoboxExport gadget'
	} ).then( ( response: ApiResponse ): null => {
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

export function createSomevalueSnak( propertyId: PropertyId ): Snak {
	return {
		snaktype: 'somevalue',
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

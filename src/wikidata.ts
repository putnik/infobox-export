import { getLabelValue, getRandomHex, unique } from './utils';
import { getWdApi, wdApiRequest } from './api';
import { getI18n } from './i18n';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import { Title } from './types/main';
import { ItemValue } from './types/wikidata/values';
import { ApiResponse } from './types/api';
import { Entity, ItemId, PropertyId } from './types/wikidata/types';
import { Statement, Snak, Reference, ClaimsObject } from './types/wikidata/main';
import { ItemDataValue } from './types/wikidata/datavalues';
import { errorDialog } from './ui';

const $ = require( 'jquery' );
const mw = require( 'mw' );

export const grigorianCalendar: Entity = 'http://www.wikidata.org/entity/Q1985727';
export const julianCalendar: Entity = 'http://www.wikidata.org/entity/Q1985786';

let baseRevId: string;
const entityId: string = mw.config.get( 'wgWikibaseItemId' );

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

export function generateItemSnak( propertyId: PropertyId, entityId: string ): Snak {
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
		references: references
	};
}

export async function getWikidataIds( propertyId: PropertyId, titles: Title[], references: Reference[] ): Promise<Statement[]> {
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
		props: [ 'labels', 'claims', 'sitelinks' ],
		titles: titles.map( function ( title: Title ) {
			return title.label;
		} ),
		sitefilter: sites
	} );
	if ( !data.success ) {
		return [];
	}

	const statements: Statement[] = [];
	for ( const entityId in data.entities ) {
		if ( !data.entities.hasOwnProperty( entityId ) || !entityId.match( /^Q/ ) ) {
			continue;
		}

		const entity = data.entities[ entityId ];
		const userLabel: string = getLabelValue( entity.labels, [ userLanguage, contentLanguage ], entityId );

		if ( ( ( ( ( ( ( ( entity || {} ).claims || {} ).P31 || [] )[ 0 ] || {} ).mainsnak || {} ).datavalue || {} ).value || {} ).id === 'Q4167410' ) {
			continue; // skip disambigs
		}

		let subclassFound: boolean | string = false;
		let subclassEntity: any;
		let subclassEntityId: ItemId;
		const subclassPropertyIds: string[] = [ 'P17', 'P31', 'P131', 'P279', 'P361' ];
		for ( const candidateId in data.entities ) {
			if ( !data.entities.hasOwnProperty( candidateId ) || !candidateId.match( /^Q/ ) || entityId === candidateId ) {
				continue;
			}

			subclassFound = subclassPropertyIds.find( function ( propertyId: PropertyId ) {
				const values = ( ( ( data.entities[ candidateId ] || {} ).claims || {} )[ propertyId ] || [] );
				return values.find( function ( statement: Statement ) {
					const value: ItemValue = ( ( ( statement.mainsnak || {} ).datavalue || {} ).value || {} ) as ItemValue;
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

		if ( subclassFound ) {
			if ( subclassEntity ) {
				const userSubclassLabel: string = getLabelValue( subclassEntity.labels, [ userLanguage, contentLanguage ], subclassEntityId );
				const text: string = getI18n( 'more-precise-value' )
					.replace( '$1', userLabel )
					.replace( '$2', userSubclassLabel );
				mw.notify( text, {
					type: 'warn',
					tag: 'wikidataInfoboxExport-warn-precise'
				} );
			}
			continue; // skip values for which there are more accurate values
		}

		const snak: Snak = generateItemSnak( propertyId, entityId );
		const statement: Statement = convertSnakToStatement( snak, references );

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
			statement.qualifiers = relatedTitles.shift().qualifiers;
		}

		statements.push( statement );
	}

	return statements;
}

/**
 * Create all statements in Wikidata and mark properties exported
 */
export async function createClaims( statements: Statement[] ): Promise<void> {
	let propertyIds: PropertyId[] = [];
	while ( statements.length ) {
		const statement: Statement = statements.shift();
		const propertyId: PropertyId = statement.mainsnak.property;
		propertyIds.push( propertyId );
		const claimData: ApiResponse = await getWdApi().postWithToken( 'csrf', {
			action: 'wbsetclaim',
			claim: JSON.stringify( statement ),
			baserevid: baseRevId,
			tags: 'InfoboxExport gadget'
		} );

		if ( claimData.success ) {
			const valuesLeftStr = statements.length ? getI18n( 'values-left' ).replace( '$1', statements.length.toString() ) : '';
			mw.notify( getI18n( 'value-saved' ).replace( '$1', propertyId ) + valuesLeftStr, {
				tag: 'wikidataInfoboxExport-success'
			} );

			baseRevId = claimData.pageinfo.lastrevid;
		} else {
			// mw.notify( getI18n( 'value-failed' ), {
			// type: 'error',
			// tag: 'wikidataInfoboxExport-error'
			// } );
			errorDialog( getI18n( 'value-failed' ), JSON.stringify( claimData ) );
			break;
		}
	}

	propertyIds = unique( propertyIds );
	for ( const i in propertyIds ) {
		const propertyId: PropertyId = propertyIds[ i ];
		$( `.no-wikidata[data-wikidata-property-id=${propertyId}]` )
			.removeClass( 'no-wikidata' )
			.off( 'dblclick' ); // FIXME: disable only clickEvent
	}
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

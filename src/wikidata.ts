import { getRandomHex, unique } from './utils';
import { getWdApi, wdApiRequest } from './api';
import { getI18n } from './i18n';
import { allLanguages, userLanguage } from './languages';
import { Title } from './types/main';
import { ItemValue } from './types/wikidata/values';
import { ApiResponse } from './types/api';
import { Entity } from './types/wikidata/types';
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

export function generateItemSnak( propertyId: string, entityId: string ): Snak {
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

export async function getWikidataIds( propertyId: string, titles: Title[], references: Reference[] ): Promise<Statement[]> {
	if ( !titles.length ) {
		return [];
	}

	let languages: string[] = titles.map( function ( item: Title ) {
		return item.language;
	} );
	languages = $.merge( languages, allLanguages );
	languages = unique( languages );

	const sites: string[] = titles.map( function ( item: Title ) {
		return item.project;
	} );

	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		sites: sites,
		languages: languages,
		props: [ 'labels', 'claims' ],
		titles: titles.map( function ( item: Title ) {
			return item.label;
		} )
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
		const label: { value: string } = entity.labels[ userLanguage ] || entity.labels.en || entity.labels[ Object.keys( entity.labels )[ 0 ] ] || { value: '' };

		if ( ( ( ( ( ( ( ( entity || {} ).claims || {} ).P31 || [] )[ 0 ] || {} ).mainsnak || {} ).datavalue || {} ).value || {} ).id === 'Q4167410' ) {
			continue; // skip disambigs
		}

		let subclassFound: boolean | string = false;
		let subclassEntity: any = null;
		const subclassPropertyIds: string[] = [ 'P17', 'P31', 'P131', 'P279', 'P361' ];
		for ( const candidateId in data.entities ) {
			if ( !data.entities.hasOwnProperty( candidateId ) || !candidateId.match( /^Q/ ) || entityId === candidateId ) {
				continue;
			}

			subclassFound = subclassPropertyIds.find( function ( propertyId: string ) {
				const values = ( ( ( data.entities[ candidateId ] || {} ).claims || {} )[ propertyId ] || [] );
				return values.find( function ( statement: Statement ) {
					const value: ItemValue = ( ( ( statement.mainsnak || {} ).datavalue || {} ).value || {} ) as ItemValue;
					const result: boolean = value.id === entityId;
					if ( result ) {
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
				const subclassLabel: { value: string } = subclassEntity.labels[ userLanguage ] ||
					subclassEntity.labels.en ||
					subclassEntity.labels[ Object.keys( subclassEntity.labels )[ 0 ] ];
				const text: string = getI18n( 'more-precise-value' )
					.replace( '$1', label.value )
					.replace( '$2', subclassLabel.value );
				mw.notify( text, {
					type: 'warn',
					tag: 'wikidataInfoboxExport-warn-precise'
				} );
			}
			continue; // skip values for which there are more accurate values
		}

		const snak: Snak = generateItemSnak( propertyId, entityId );
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	}

	return statements;
}

/**
 * Create all statements in Wikidata and mark properties exported
 */
export async function createClaims( statements: Statement[] ): Promise<void> {
	let propertyIds: string[] = [];
	while ( statements.length ) {
		const statement: Statement = statements.shift();
		const propertyId: string = statement.mainsnak.property;
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
		const propertyId: string = propertyIds[ i ];
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
		options: JSON.stringify( {
			lang: userLanguage
		} )
	} );
	if ( response.errors ) {
		const firstError: string = response.errors[ 0 ][ '*' ];
		return $( '<span>' ).addClass( 'error' ).text( firstError );
	}
	return $( '<span>' )
		.addClass( 'wikidata-infobox-export-main-label' )
		.html( response.result );
}

export function convertStatementsToClaimsObject( statements: Statement[] ): ClaimsObject {
	const claimObject: ClaimsObject = {};
	for ( const i in statements ) {
		const statement: Statement = statements[ i ];
		const propertyId: string = statement.mainsnak.property;
		if ( claimObject[ propertyId ] === undefined ) {
			claimObject[ propertyId ] = [];
		}
		claimObject[ propertyId ].push( statement );
	}
	return claimObject;
}

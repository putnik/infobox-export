import { getLabelValue, getRandomHex, clone, unique, sleep } from './utils';
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

export function stringifyStatement( statement: Statement ): string {
	const rawStatement = clone( statement );
	rawStatement.meta = null;
	return JSON.stringify( rawStatement );
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
		if ( entity?.claims?.P31?.[ 0 ]?.mainsnak?.datavalue?.value?.id === 'Q4167410' ) {
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
				const values = data.entities[ candidateId ]?.claims?.[ propertyId ] || [];
				return values.find( function ( statement: Statement ) {
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

		const snak: Snak = generateItemSnak( propertyId, entityId );
		const statement: Statement = convertSnakToStatement( snak, references );

		if ( subclassFound && subclassEntity ) {
			statement.meta = {
				subclassItem: {
					'entity-type': 'item',
					'numeric-id': parseInt( subclassEntityId.replace( 'Q', '' ), 10 ),
					id: subclassEntityId
				}
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
	const SUCCESS_COLOR = '#00af89';
	const DESTRUCTIVE_COLOR = '#d33';
	let propertyIds: PropertyId[] = [];
	const totalCount: number = statements.length;
	while ( statements.length ) {
		const statement: Statement = statements.shift();

		const $checkbox = statement.meta.$checkbox;
		if ( !$checkbox ) {
			errorDialog( getI18n( 'value-failed' ), JSON.stringify( statement ) );
			return;
		}
		$checkbox.prop( 'disabled', true );

		const propertyId: PropertyId = statement.mainsnak.property;
		propertyIds.push( propertyId );
		const claimData: ApiResponse = await getWdApi().postWithToken( 'csrf', {
			action: 'wbsetclaim',
			claim: stringifyStatement( statement ),
			baserevid: baseRevId,
			tags: 'InfoboxExport gadget'
		} );

		const $fakeCheckbox = statement.meta.$checkbox.parent().find( 'span' );
		if ( claimData.success ) {
			$fakeCheckbox.css( {
				'background-color': SUCCESS_COLOR,
				'border-color': SUCCESS_COLOR
			} );
			baseRevId = claimData.pageinfo.lastrevid;
		} else {
			$fakeCheckbox.css( {
				'background-color': DESTRUCTIVE_COLOR,
				'border-color': DESTRUCTIVE_COLOR
			} );
			errorDialog( getI18n( 'value-failed' ), JSON.stringify( claimData ) );
			return;
		}
	}

	propertyIds = unique( propertyIds );
	for ( const i in propertyIds ) {
		const propertyId: PropertyId = propertyIds[ i ];
		$( `.no-wikidata[data-wikidata-property-id=${propertyId}]` )
			.removeClass( 'no-wikidata' )
			.off( 'dblclick' ); // FIXME: disable only clickEvent
	}

	// Delay for the user to see the last green checkbox
	await sleep( 450 );

	mw.loader.using( 'mediawiki.action.view.postEdit', function () {
		mw.hook( 'postEdit' ).fire( {
			message: getI18n( totalCount > 1 ? 'all-values-saved' : 'value-saved' )
		} );
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

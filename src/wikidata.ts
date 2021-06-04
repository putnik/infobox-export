import { getRandomHex, guessDateAndPrecision, unique } from './utils';
import { getConfig } from './config';
import { getWdApi, wdApiRequest } from './api';
import { getI18n } from './i18n';
import { errorDialog } from './ui';
import { allLanguages, userLanguage } from './languages';
import {
	DataType,
	DataValueType,
	WikidataClaim,
	WikidataMainSnak,
	WikidataSnak,
	WikidataSource
} from './types/wikidata';
import { TimeGuess, Title } from './types/main';
import { TimeValue } from './types/wikidata/values';
import { ApiResponse } from './types/api';

const $ = require( 'jquery' );
const mw = require( 'mw' );

export const typesMapping: { [key in DataType]?: DataValueType } = {
	commonsMedia: 'string',
	'external-id': 'string',
	url: 'string',
	'wikibase-item': 'wikibase-entityid'
};

let baseRevId: string;

export function setBaseRevId( value: string ): void {
	baseRevId = value;
}

export function claimGuid( entityId: string ): string {
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

/**
 * Format dates as datavalue for Wikidata
 */
export function createTimeSnak( timestamp: string, forceJulian: boolean | void ): TimeValue | null {
	if ( !timestamp ) {
		return;
	}
	const result: TimeValue = {
		time: '',
		precision: 0,
		timezone: 0,
		before: 0,
		after: 0
	};

	if ( timestamp.match( /\s\([^)]*\)\s/ ) ) {
		forceJulian = true;
	}
	timestamp = timestamp.replace( /\([^)]*\)/, '' ).trim();

	let isBce = false;
	const bceMatch = timestamp.match( getConfig( 're-bce' ) );
	if ( bceMatch ) {
		isBce = true;
		timestamp = timestamp.replace( bceMatch[ 0 ], '' ).trim();
	} else {
		const ceMatch = timestamp.match( getConfig( 're-ce' ) );
		if ( ceMatch ) {
			timestamp = timestamp.replace( ceMatch[ 0 ], '' ).trim();
		}
	}

	const guess: TimeGuess = guessDateAndPrecision( timestamp );
	if ( guess.type !== 'value' ) {
		return;
	}

	try {
		guess.isoDate.setUTCHours( 0 );
		guess.isoDate.setUTCMinutes( 0 );
		guess.isoDate.setUTCSeconds( 0 );

		result.time = ( isBce ? '-' : '+' ) + guess.isoDate.toISOString().replace( /\.000Z/, 'Z' );
		result.precision = guess.precision;
	} catch ( e ) {
		return;
	}
	if ( result.precision < 11 ) {
		result.time = result.time.replace( /-\d\dT/, '-00T' );
	}
	if ( result.precision < 10 ) {
		result.time = result.time.replace( /-\d\d-/, '-00-' );
	}

	result.calendarmodel = 'http://www.wikidata.org/entity/Q' +
		( forceJulian || guess.isoDate < new Date( Date.UTC( 1582, 9, 15 ) ) ? '1985786' : '1985727' );
	return result;
}

export async function getWikidataIds( propertyId: string, titles: Title[] ): Promise<{ [ key: string ]: WikidataSnak }> {
	let languages = titles.map( function ( item: Title ) {
		return item.language;
	} );
	languages = $.merge( languages, allLanguages );
	languages = unique( languages );

	const sites = titles.map( function ( item: Title ) {
		return item.project;
	} );

	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		sites: sites,
		languages: languages,
		props: [ 'labels', 'descriptions', 'claims' ],
		titles: titles.map( function ( item: Title ) {
			return item.label;
		} )
	} );
	if ( !data.success ) {
		return;
	}

	const valuesObj: { [ key: string ]: WikidataSnak } = {};
	let value: WikidataSnak | undefined;

	for ( const entityId in data.entities ) {
		if ( !data.entities.hasOwnProperty( entityId ) || !entityId.match( /^Q/ ) ) {
			continue;
		}

		const entity = data.entities[ entityId ];
		const label: { value: string } = entity.labels[ userLanguage ] || entity.labels.en || entity.labels[ Object.keys( entity.labels )[ 0 ] ] || { value: '' };
		const description = entity.descriptions[ userLanguage ] || entity.descriptions.en || entity.descriptions[ Object.keys( entity.descriptions )[ 0 ] ] || '';

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
				return values.find( function ( statement: WikidataClaim ) {
					// @ts-ignore
					const result = ( ( ( statement.mainsnak || {} ).datavalue || {} ).value || {} ).id === entityId;
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

		value = {
			type: 'wikibase-item',
			value: {
				id: entityId,
				label: $( '<span>' ).text( label ? label.value : label ),
				description: description ? description.value : description
			}
		};
		if ( label ) {
			const results: Title[] = titles.filter( function ( item: Title ) {
				return item.label.toLowerCase() === label.value.toLowerCase();
			} );
			if ( results.length === 1 ) {
				value.qualifiers = results[ 0 ].qualifiers;
			}
		}
		// @ts-ignore
		if ( 'label' in value.value ) {
			delete value.value.label;
		}
		// @ts-ignore
		if ( 'description' in value.value ) {
			delete value.value.description;
		}
		valuesObj[ entityId ] = value;
	}

	return valuesObj;
}

/**
 * Create all statements in Wikidata and mark properties exported
 */
export function createClaims( propertyId: string, values: string[], refUrl: WikidataSource[], revIds?: string[] ) {
	let value: any = values.shift();
	revIds = revIds || [];
	if ( !value ) {
		// All statements are added
		$( '.no-wikidata[data-wikidata-property-id=' + propertyId + ']' )
			.removeClass( 'no-wikidata' );
		// .off( 'dblclick', clickEvent ); // FIXME
		return;
	} else {
		value = JSON.parse( value );
	}
	if ( getConfig( 'properties' )[ propertyId ] === undefined ) {
		mw.notify( getI18n( 'no-property-data' ).replace( '$1', propertyId ), {
			type: 'error',
			tag: 'wikidataInfoboxExport-property-error'
		} );
		return;
	}
	const datatype: DataType = getConfig( 'properties' )[ propertyId ].datatype;
	// @ts-ignore
	const mainsnak: WikidataMainSnak = value.value.toString().match( /^(novalue|somevalue)$/ ) ? {
		snaktype: value.value,
		property: propertyId
	} : {
		snaktype: 'value',
		property: propertyId,
		datavalue: {
			type: typesMapping[ datatype ] ? typesMapping[ datatype ] : datatype,
			value: value.value
		}
	};
	const claim: WikidataClaim = {
		type: 'statement',
		mainsnak: mainsnak,
		id: claimGuid( mw.config.get( 'wgWikibaseItemId' ) ),
		references: refUrl,
		rank: 'normal'
	};
	if ( value.qualifiers ) {
		claim.qualifiers = value.qualifiers;
	}

	getWdApi().postWithToken( 'csrf', {
		action: 'wbsetclaim',
		claim: JSON.stringify( claim ),
		baserevid: baseRevId,
		tags: 'InfoboxExport gadget'
	} ).done( function ( claimData: ApiResponse ) {
		if ( claimData.success ) {
			const valuesLeftStr = values.length ? getI18n( 'values-left' ).replace( '$1', values.length.toString() ) : '';
			mw.notify( getI18n( 'value-saved' ).replace( '$1', propertyId ) + valuesLeftStr, {
				tag: 'wikidataInfoboxExport-success'
			} );

			baseRevId = claimData.pageinfo.lastrevid;
			revIds.push( baseRevId );
			createClaims( propertyId, values, refUrl, revIds );
		} else {
			errorDialog( getI18n( 'value-failed' ), JSON.stringify( claimData ) );
		}
	} ).fail( function () {
		mw.notify( getI18n( 'value-failed' ), {
			type: 'error',
			tag: 'wikidataInfoboxExport-error'
		} );
	} );
}

export async function wbFormatValue( snak: WikidataSnak ): Promise<JQuery> {
	const response: ApiResponse = await wdApiRequest( {
		action: 'wbformatvalue',
		generate: 'text/html; disposition=verbose',
		datavalue: JSON.stringify( {
			type: typesMapping[ snak.type ] ? typesMapping[ snak.type ] : snak.type,
			value: snak.value
		} ),
		datatype: snak.type,
		options: JSON.stringify( {
			lang: userLanguage
		} )
	} );
	if ( response.errors ) {
		const firstError: string = response.errors[ 0 ][ '*' ];
		return $( '<span>' ).addClass( 'error' ).text( firstError );
	}
	return $( '<span>' ).html( response.result );
}

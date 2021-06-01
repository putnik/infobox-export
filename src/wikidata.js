import { getRandomHex, unique } from './utils';
import { getConfig } from "./config";
import { getWdApi, wdApiRequest } from "./api";
import { getI18n } from "./i18n";
import { formatDataValue } from "./formatter";
import { errorDialog } from "./ui";
import { allLanguages, userLanguage } from "./languages";
import { getMonths, getMonthsGen } from "./months";

const $ = require('jquery');
const mw = require('mw');

export const typesMapping = {
	'commonsMedia': 'string',
	'external-id': 'string',
	'url': 'string',
	'wikibase-item': 'wikibase-entityid',
};

let baseRevId;

export function setBaseRevId( value ) {
	baseRevId = value;
}

export function claimGuid( entityId ) {
	const template = 'xx-x-x-x-xxx';
	let guid = '';
	for ( let i = 0; i < template.length; i++ ) {
		if ( template.charAt( i ) === '-' ) {
			guid += '-';
			continue;
		}

		let hex;
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

function guessDateAndPrecision( timestamp ) {
	let dateParts = timestamp.match( getConfig( 're-century' ) );
	let isoDate;
	if ( dateParts ) {
		isoDate = new Date( 0 );
		isoDate.setFullYear( getConfig( 'centuries' ).indexOf( dateParts[ 1 ].toUpperCase() ) * 100 + 1 );
		return {
			isoDate: isoDate,
			precision: 7,
		};
	}

	dateParts = timestamp.match( getConfig( 're-month-year' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( dateParts[ 2 ], getMonths().indexOf( dateParts[ 1 ] ) ) );
		return {
			isoDate: isoDate,
			precision: 10,
		};
	}

	dateParts = timestamp.match( getConfig( 're-text-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( dateParts[ 3 ], getMonthsGen().indexOf( dateParts[ 2 ] ), dateParts[ 1 ] ) );
		return {
			isoDate: isoDate,
			precision: 11,
		};
	}

	dateParts = timestamp.match( getConfig( 're-dot-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( dateParts[ 3 ] < 100 ? 1900 + parseInt( dateParts[ 3 ] ) : dateParts[ 3 ], dateParts[ 2 ] - 1, dateParts[ 1 ] ) );
		return {
			isoDate: isoDate,
			precision: 11,
		};
	}

	dateParts = timestamp.match( getConfig( 're-iso-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( dateParts[ 1 ] < 100 ? 1900 + parseInt( dateParts[ 1 ] ) : dateParts[ 1 ], dateParts[ 2 ] - 1, dateParts[ 3 ] ) );
		return {
			isoDate: isoDate,
			precision: 11,
		};
	}

	dateParts = timestamp.match( getConfig( 're-decade' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( dateParts[ 1 ], 0 ) );
		return {
			isoDate: isoDate,
			precision: 8,
		};
	}

	dateParts = timestamp.match( getConfig( 're-year' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( dateParts[ 1 ], 0 ) );
		return {
			isoDate: isoDate,
			precision: 9,
		};
	}

	if ( timestamp.match( getConfig( 're-present' ) ) ) {
		return 'novalue';
	}

	if ( timestamp.match( getConfig( 're-unknown' ) ) ) {
		return 'somevalue';
	}
}

/**
 * Format dates as datavalue for Wikidata
 */
export function createTimeSnak( timestamp, forceJulian ) {
	if ( !timestamp ) {
		return;
	}
	const result = { timezone: 0, before: 0, after: 0 };

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

	const guess = guessDateAndPrecision( timestamp );
	if ( typeof guess !== 'object' ) {
		return guess;
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

export function getWikidataIds( titles, callback, $wrapper ) {
	let languages = titles.map( function ( item ) {
		return item.language;
	} );
	languages = $.merge( languages, allLanguages );
	languages = unique( languages );

	let sites = titles.map( function ( item ) {
		return item.project;
	} );

	wdApiRequest( {
		action: 'wbgetentities',
		sites: sites,
		languages: languages,
		props: [ 'labels', 'descriptions', 'claims' ],
		titles: titles.map( function ( item ) {
			return item.label;
		} )
	} ).done( function ( data ) {
		if ( !data.success ) {
			return;
		}
		const valuesObj = {};
		let value;

		for ( const entityId in data.entities ) {
			if ( !data.entities.hasOwnProperty( entityId ) || !entityId.match( /^Q/ ) ) {
				continue;
			}

			const entity = data.entities[ entityId ];
			const label = entity.labels[ userLanguage ] || entity.labels.en || entity.labels[ Object.keys( entity.labels )[ 0 ] ] || '';
			const description = entity.descriptions[ userLanguage ] || entity.descriptions.en || entity.descriptions[ Object.keys( entity.descriptions )[ 0 ] ] || '';

			if ( ( ( ( ( ( ( ( entity || {} ).claims || {} ).P31 || [] )[ 0 ] || {} ).mainsnak || {} ).datavalue || {} ).value || {} ).id === 'Q4167410' ) {
				continue; // skip disambigs
			}

			let subclassFound = false;
			let subclassEntity = null;
			const subclassPropertyIds = [ 'P17', 'P31', 'P131', 'P279', 'P361' ];
			for ( const candidateId in data.entities ) {
				if ( !data.entities.hasOwnProperty( candidateId ) || !candidateId.match( /^Q/ ) || entityId === candidateId ) {
					continue;
				}

				subclassFound = subclassPropertyIds.find( function ( propertyId ) {
					const values = ( ( ( data.entities[ candidateId ] || {} ).claims || {} )[ propertyId ] || [] );
					return values.find( function ( statement ) {
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
					const subclassLabel = subclassEntity.labels[ userLanguage ] ||
						subclassEntity.labels.en ||
						subclassEntity.labels[ Object.keys( subclassEntity.labels )[ 0 ] ];
					const text = getI18n( 'more-precise-value' )
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
				wd: {
					type: 'wikibase-entityid',
					value: {
						id: entityId,
						label: label ? label.value : label,
						description: description ? description.value : description
					}
				}
			};
			if ( label ) {
				const results = titles.filter( function ( item ) {
					return item.label.toLowerCase() === label.value.toLowerCase();
				} );
				if ( results.length === 1 ) {
					value.wd.qualifiers = results[ 0 ].qualifiers;
				}
			}
			value.label = formatDataValue( value.wd );
			delete value.wd.value.label;
			delete value.wd.value.description;
			valuesObj[ entityId ] = value;
		}

		callback( valuesObj, $wrapper );
	} )
}

/**
 * Create all statements in Wikidata and mark properties exported
 */
export function createClaims( propertyId, values, refUrl, revIds ) {
	let value = values.shift();
	revIds = revIds || [];
	if ( !value ) {
		// All statements are added
		$( '.no-wikidata[data-wikidata-property-id=' + propertyId + ']' )
			.removeClass( 'no-wikidata' )
			.off( 'dblclick', clickEvent );
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
	const datatype = getConfig( 'properties' )[ propertyId ].datatype;
	const mainsnak = value.value.toString().match( /^(novalue|somevalue)$/ ) ? {
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
	const claim = {
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
	} ).done( function ( claimData ) {
		if ( claimData.success ) {
			const valuesLeftStr = values.length ? getI18n( 'values-left' ).replace( '$1', values.length ) : '';
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


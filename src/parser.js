import { getConfig } from './config';
import { getI18n } from './i18n';
import { checkForMissedLanguage, contentLanguage } from "./languages";
import { formatDataValue } from "./formatter";
import { createTimeSnak, getWikidataIds, typesMapping } from "./wikidata";
import { unique } from "./utils";
import { apiRequest } from "./api";
import { parseRawQuantity } from "./text-parser";

export let alreadyExistingItems = {};

/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseQuantity( text, forceInteger ) {
	text = text.replace( /,/g, '.' ).replace( /[−–—]/g, '-' ).trim();

	const config = {
		"re-10_3": getConfig( 're-10_3' ),
		"re-10_6": getConfig( 're-10_6' ),
		"re-10_9": getConfig( 're-10_9' ),
		"re-10_12": getConfig( 're-10_12' ),
	}

	const value = parseRawQuantity(config, text, forceInteger);
	if ( value === undefined ) {
		return;
	}
	const out = {
		value: value,
	};

	// Sourcing circumstances (P1480) = circa (Q5727902)
	const circaMatch = text.match( getConfig( 're-circa' ) );
	if ( circaMatch ) {
		out.qualifiers = {
			P1480: [ {
				property: 'P1480',
				snaktype: 'value',
				datavalue: {
					type: 'wikibase-entityid',
					value: { id: 'Q5727902' }
				}
			} ],
		};
		text = text.replace( circaMatch[ 0 ], '' );
	}

	return out;
}

function addQualifierValue( value, qualifierId, qualifierValue, qualifierLabel, $label ) {
	if ( value.qualifiers === undefined ) {
		value.qualifiers = {};
	}
	if ( value.qualifiers[ qualifierId ] === undefined ) {
		value.qualifiers[ qualifierId ] = [];
	}
	const datatype = getConfig( 'properties' )[ qualifierId ].datatype;
	value.qualifiers[ qualifierId ].push( {
		snaktype: 'value',
		property: qualifierId,
		datavalue: {
			type: typesMapping[ datatype ] || datatype,
			value: qualifierValue
		}
	} );
	$label.append( $( '<p>' )
		.append( $( '<a>' )
			.attr( 'href', '//www.wikidata.org/wiki/Property:' + qualifierId )
			.text( getConfig( 'properties' )[ qualifierId ].label )
		)
		.append( $( '<span>' ).text( ': ' ) )
		.append( qualifierLabel )
	);
	return value;
}

function processItemTitles( itemTitles, callback, value, $label ) {
	if ( Object.keys( itemTitles ).length ) {
		const qualifierId = Object.keys( itemTitles ).shift();
		const qualifierItemTitles = itemTitles[ qualifierId ];
		delete itemTitles[ qualifierId ];
		getWikidataIds( qualifierItemTitles, function ( valuesObj ) {
			for ( const entityId in valuesObj ) {
				const valueObj = valuesObj[ entityId ];
				value = addQualifierValue( {}, qualifierId, valueObj.wd.value, valueObj.label, $label );
			}
			processItemTitles( itemTitles, callback, value, $label );
		} );
	} else {
		callback( {
			wd: value,
			label: $label
		} );
	}
}

export function addQualifiers( $field, value, $label, callback ) {
	const $qualifiers = $field.find( '[data-wikidata-qualifier-id]' );
	if ( $qualifiers.length ) {
		$label = $( '<div>' ).append( $label );
	}

	const qualifierTitles = {};
	for ( let q = 0; q < $qualifiers.length; q++ ) {
		const $qualifier = $( $qualifiers[ q ] );
		const qualifierId = $qualifier.data( 'wikidata-qualifier-id' );
		let qualifierValue = $qualifier.text().replace( '\n', ' ' ).trim();
		switch ( getConfig( 'properties' )[ qualifierId ].datatype ) {
			case 'monolingualtext':
				qualifierValue = {
					text: $qualifier.text().replace( '\n', ' ' ).trim(),
					language: $qualifier.attr( 'lang' ) || contentLanguage
				};
				value = addQualifierValue( value, qualifierId, qualifierValue, $qualifier.text(), $label );
				break;

			case 'string':
				qualifierValue = $qualifier.text().replace( '\n', ' ' ).trim();
				value = addQualifierValue( value, qualifierId, qualifierValue, $qualifier.text(), $label );
				break;

			case 'time':
				qualifierValue = createTimeSnak( qualifierValue );
				value = addQualifierValue( value, qualifierId, qualifierValue, $qualifier.text(), $label );
				break;

			case 'wikibase-item':
				if ( qualifierTitles[ qualifierId ] === undefined ) {
					qualifierTitles[ qualifierId ] = [];
				}

				const $links = $qualifier.find( 'a[title][class!=image][class!=new]' );
				if ( $links.length ) {
					for ( let l = 0; l < $links.length; l++ ) {
						const $link = $( $links[ l ] );
						let extractedUrl = decodeURIComponent( $link.attr( 'href' ) ).replace( /^.*\/wiki\//, '' );
						if ( extractedUrl ) {
							extractedUrl = extractedUrl.replace( /_/g, ' ' ).trim();
							const title = {
								label: extractedUrl.charAt( 0 ).toUpperCase() + extractedUrl.substr( 1, extractedUrl.length - 1 ),
								language: contentLanguage,
								project: getConfig( 'project' ),
								qualifiers: {}
							};
							if ( $link.hasClass( 'extiw' ) ) {
								const m = $link.attr( 'href' ).match( /^https:\/\/([a-z\-]+)\.(wik[^.]+)\./ );
								if ( m && m[ 2 ] !== 'wikimedia' ) {
									title.language = m[ 1 ];
									title.project = m[ 1 ] + m[ 2 ].replace( 'wikipedia', 'wiki' );
								}
							}
							qualifierTitles[ qualifierId ].push( title );
						}
					}
				} else {
					qualifierTitles[ qualifierId ].push( {
						label: qualifierValue.charAt( 0 ).toUpperCase() + qualifierValue.substr( 1, qualifierValue.length - 1 ),
						language: contentLanguage,
						project: getConfig( 'project' ),
						qualifiers: {}
					} );
				}
				break;
		}
	}

	processItemTitles( qualifierTitles, callback, value, $label );
}

/**
 * Recognition of units of measurement in the infobox parameter and its label
 */
function recognizeUnits( text, units, label ) {
	if ( Array.isArray( units ) && units.length === 0 ) {
		return [ '1' ];
	}
	const result = [];
	for ( const idx in units ) {
		if ( !units.hasOwnProperty( idx ) ) {
			continue;
		}
		const item = parseInt( idx ) >= 0 ? units[ idx ] : idx;
		const search = getConfig( 'units' )[ item ].search;
		for ( let j = 0; j < search.length; j++ ) {
			let expr = search[ j ];
			if ( search[ j ].charAt( 0 ) !== '^' ) {
				expr = '[\\d\\s\\.]' + expr;
				if ( search[ j ].length < 5 ) {
					expr = expr + '\\.?$';
				}
			}
			if ( text.match( new RegExp( expr ) ) ) {
				result.push( item );
				break;
			} else if ( search[ j ].charAt( 0 ) !== '^' && label && label.match( new RegExp( '\\s' + search[ j ] + ':?$' ) ) ) {
				result.push( item );
				break;
			}
		}
	}
	return result;
}

export function prepareCommonsMedia( $content, $wrapper ) {
	const values = [];
	const $imgs = $content.find( 'img' );
	$imgs.each( function () {
		const $img = $( this );
		const src = $img.attr( 'src' );
		if ( !src.match( /upload.wikimedia.org\/wikipedia\/commons/ ) ) {
			return;
		}
		const srcParts = src.split( '/' );
		let fileName = srcParts.pop();
		if ( fileName.match( /(?:^|-)\d+px-/ ) ) {
			fileName = srcParts.pop();
		}
		fileName = decodeURIComponent( fileName );
		fileName = fileName.replace( /_/g, ' ' );
		const value = { value: fileName };
		const $label = $img.clone()
			.attr( 'title', fileName )
			.css( 'border', '1px dashed #a2a9b1' );

		addQualifiers( $wrapper, value, $label, function ( valueObj ) {
			values.push( valueObj );
		} );
	} );

	return values;
}

export function prepareMonolingualText( $content ) {
	const mw = require('mw');
	let values = [];
	let $items = $content.find( 'span[lang]' );
	$items.each( function () {
		const $item = $( this );
		values.push( {
			wd: checkForMissedLanguage( {
				value: {
					text: $item.text().trim(),
					language: $item.attr( 'lang' ).trim()
				}
			} )
		} );
	} );
	if ( !values.length ) {
		const text = $content.text().trim();
		if ( text ) {
			$items = mw.util.$content.find( 'span[lang]' );
			$items.each( function () {
				const $item = $( this );
				if ( $item.text().trim().startsWith( text ) ) {
					values.push( {
						wd: checkForMissedLanguage( {
							value: {
								text: text,
								language: $item.attr( 'lang' ).trim()
							}
						} )
					} );
				}
			} );
		}
	}
	const valueLanguages = [];
	for ( const i in values ) {
		const valueLanguage = values[ i ].wd.value.language;
		if ( valueLanguages.indexOf( valueLanguage ) > -1 ) {
			continue;
		}
		valueLanguages.push( valueLanguage );
		values[ i ].label = $( '<span>' )
			.append( $( '<span>' ).css( 'color', '#666' ).text( '(' + valueLanguage + ') ' ) )
			.append( $( '<strong>' ).text( values[ i ].wd.value.text ) );
	}
	values = values.filter( function ( item ) {
		return item.label !== undefined;
	} );

	return values;
}

export function prepareQuantity( $content, propertyId ) {
	const values = [];
	let text = $content.text()
		.replace( /[\u00a0\u25bc\u25b2]/g, ' ' )
		.replace( /\s*\(([^)]*\))/g, '' )
		.trim();

	// Hack for time in formats "hh:mm:ss" and "00m 00s""
	const match = text.replace( getConfig( 're-min-sec' ), '$1:$2' )
		.match( /^(?:(\d+):)?(\d+):(\d+)$/ );
	if ( match ) {
		let amount = 0;
		for ( let i = 1; i < match.length; i++ ) {
			if ( match[ i ] !== undefined ) {
				amount = amount * 60 + parseInt( match[ i ], 10 );
			}
		}

		text = amount + getI18n( 'unit-sec' );
	}

	let result = {
		wd: parseQuantity( text, getConfig( 'properties.' + propertyId + '.constraints.integer' ) )
	};
	if ( !result.wd || !result.wd.value ) {
		return;
	}

	addQualifiers( $content, result.wd, formatDataValue( result.wd ), function ( valueObj ) {
		result = valueObj;
	} );

	if ( getConfig( 'properties' )[ propertyId ].constraints.qualifier.indexOf( 'P585' ) !== -1 ) {
		let yearMatch = $content.text().match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
		if ( !yearMatch ) {
			yearMatch = $field.closest( 'tr' ).find( 'th' ).first().text().match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
		}
		if ( yearMatch ) {
			const extractedDate = createTimeSnak( yearMatch[ 1 ].replace( /(\d)\s(\d)/, '$1$2' ) );
			if ( extractedDate ) {
				result.wd.qualifiers = {
					P585: [ {
						snaktype: 'value',
						property: 'P585',
						datavalue: {
							type: 'time',
							value: extractedDate
						}
					} ]
				};
			}
		}
	}

	const qualifierMatch = $content.text().match( /\(([^\)]*)/ );
	if ( qualifierMatch ) {
		const qualifierQuantity = parseQuantity( qualifierMatch[ 1 ] );
		if ( qualifierQuantity ) {
			const supportedProperties = [ 'P2076', 'P2077' ];
			for ( let j = 0; j < supportedProperties.length; j++ ) {
				const units = recognizeUnits( qualifierMatch[ 1 ], getConfig( 'properties' )[ supportedProperties[ j ] ].units );
				if ( units.length === 1 ) {
					qualifierQuantity.value.unit = 'http://www.wikidata.org/entity/' + units[ 0 ];
					if ( !result.wd.qualifiers ) {
						result.wd.qualifiers = {};
					}
					result.wd.qualifiers[ supportedProperties[ j ] ] = [ {
						snaktype: 'value',
						property: supportedProperties[ j ],
						datavalue: {
							type: 'quantity',
							value: qualifierQuantity.value
						}
					} ];
				}
			}
		}
	}

	const founded = recognizeUnits( text, getConfig( 'properties' )[ propertyId ].units, $content.closest( 'tr' ).find( 'th' ).first().text() );
	for ( let u = 0; u < founded.length; u++ ) {
		result.wd.value.unit = '1';
		if ( founded[ u ] !== '1' ) {
			result.wd.value.unit = 'http://www.wikidata.org/entity/' + founded[ u ];
			// const item = getConfig( 'units.' + founded[ u ] );
		}
		result.wd.type = 'quantity';
		result.label = formatDataValue( result.wd );
		values.push( result );
	}

	return values;
}

export function prepareTime( $content ) {
	const $ = require('jquery');
	const values = [];
	const value = createTimeSnak( $content.text().toLowerCase().trim().replace( getConfig( 're-year-postfix' ), '' ),
		$content[ 0 ].outerHTML.includes( getConfig( 'mark-julian' ) ) );
	if ( value ) {
		if ( value.toString().match( /^(novalue|somevalue)$/ ) ) {
			const $label = $( '<span>' );
			if ( getI18n( 'value-prefix' ) !== '' ) {
				$label.append( $( '<span>' ).css( 'color', '#666' ).text( getI18n( 'value-prefix' ) ) );
			}
			$label.append( $( '<strong>' ).text( value.toString() === 'novalue' ? getI18n( 'no-value' ) : getI18n( 'unknown-value' ) ) );

			values.push( {
				wd: { value: value },
				label: $label
			} );
		} else {
			values.push( {
				wd: { value: value },
				label: $( '<span>' )
					.append( $( '<strong>' ).append( formatDataValue( {
						type: 'time',
						value: value
					} ) ) )
					.append( $( '<span>' ).css( 'color', '#666' ).text( ' (' +
						( value.calendarmodel.includes( '1985727' ) ? getI18n( 'grigorian-calendar' ) : getI18n( 'julian-calendar' ) ) + ') ' ) )
			} );
		}
	}

	return values;
}

export function prepareString( $content ) {
	const values = [];
	let text = $content.data( 'wikidata-external-id' );
	if ( !text ) {
		text = $content.text();
	}
	let strings = text.toString().trim().split( /[\n,;]+/ );

	// Commons category
	if ( propertyId === 'P373' ) {
		const $link = $content.find( 'a[class="extiw"]' ).first();
		if ( $link.length ) {
			const url = $link.attr( 'href' );
			let value = url.substr( url.indexOf( '/wiki/' ) + 6 )
				.replace( /_/g, ' ' )
				.replace( /^[Cc]ategory:/, '' )
				.replace( /\?.*$/, '' );
			value = decodeURIComponent( value );
			strings = [ value ];
		}
	}

	for ( const i in strings ) {
		const s = strings[ i ].replace( /\n/g, ' ' ).trim();
		if ( s ) {
			values.push( {
				wd: { value: s },
				label: $( '<code>' + s + '</code>' )
			} );
		}
	}

	return values;
}

export function prepareUrl( $content ) {
	const values = [];
	const $links = $content.find( 'a' );
	$links.each( function () {
		const $link = $( this );
		const url = $link.attr( 'href' ).replace( /^\/\//, 'https://' );
		values.push( {
			wd: { value: url },
			label: $( '<code>' + url + '</code>' )
		} );
	} );

	return values;
}

function processWbGetItems( valuesObj, callback, $wrapper ) {
	const $ = require('jquery');
	const values = $.map( valuesObj, function ( value ) {
		return [ value ];
	} );
	if ( values.length === 1 ) {
		const value = values.pop();
		addQualifiers( $wrapper, value.wd, value.label, function ( value ) {
			callback( [ value ] );
		} );
	} else if ( callback ) {
		callback( values );
	}
}

export function parseItems( $content, $wrapper, callback ) {
	const $ = require('jquery');
	let titles = [];

	for ( let k = 0; k < getConfig( 'fixed-values' ).length; k++ ) {
		const fixedValue = getConfig( 'fixed-values' )[ k ];
		const regexp = new RegExp( fixedValue.search );
		if ( $content.attr( 'data-wikidata-property-id' ) === fixedValue.property &&
			$content.text().match( regexp )
		) {
			const valuesObj = {};
			const value = {
				wd: {
					type: 'wikibase-entityid',
					value: {
						id: fixedValue.item,
						label: fixedValue.label,
						description: ''
					}
				}
			};
			value.label = formatDataValue( value.wd );
			delete value.wd.value.label;
			delete value.wd.value.description;
			valuesObj[ fixedValue.item ] = value;
			processWbGetItems( valuesObj, callback, $wrapper );
			return;
		}
	}

	const $links = $content.find( 'a[title][class!=image][class!=new]' );
	const redirects = [];

	if ( $links.length ) {
		for ( let j = 0; j < $links.length; j++ ) {
			const $link = $( $links[ j ] );
			if ( $link.parents( '[data-wikidata-qualifier-id]' ).length ) {
				continue;
			}
			let extractedUrl = decodeURIComponent( $link.attr( 'href' ) ).replace( /^.*\/wiki\//, '' );
			if ( extractedUrl ) {
				extractedUrl = extractedUrl.replace( /_/g, ' ' ).trim();
				const value = {
					label: extractedUrl.charAt( 0 ).toUpperCase() + extractedUrl.substr( 1, extractedUrl.length - 1 ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: {}
				};
				let match = $links[ j ].innerHTML.match( getConfig( 're-since-year' ) );
				if ( !match ) {
					match = $links[ j ].innerHTML.match( getConfig( 're-until-year' ) );
				}
				const extractedYear = match ? createTimeSnak( match[ 1 ] ) : createTimeSnak( ( $links[ j ].nextSibling || {} ).textContent );
				if ( extractedYear ) {
					value.qualifiers.P585 = [ {
						property: 'P585',
						datatype: 'time',
						snaktype: 'value',
						datavalue: {
							type: 'time',
							value: extractedYear
						}
					} ];
				}
				if ( $link.hasClass( 'extiw' ) ) {
					const m = $links[ j ].getAttribute( 'href' ).match( /^https:\/\/([a-z\-]+)\.(wik[^.]+)\./ );
					if ( m && m[ 2 ] !== 'wikimedia' ) {
						value.language = m[ 1 ];
						value.project = m[ 1 ] + m[ 2 ].replace( 'wikipedia', 'wiki' );
					}
				}
				if ( $link.hasClass( 'mw-redirect' ) ) {
					redirects.push( extractedUrl );
				}
				titles.push( value );
				if ( $( $links[ j ] ).find( 'img' ) ) {
					redirects.push( extractedUrl );
				}
			}
		}
	} else if ( $content.text().trim() ) {
		// If no links found try to search for articles by text value
		const parts = $content.text().split( /[\n,;]+/ );
		for ( const i in parts ) {
			let year = '';
			const articleTitle = parts[ i ].replace( /\([^)]*\)/, function ( match ) {
				year = match.replace( /\(\)/, '' );
				return '';
			} ).trim();
			if ( articleTitle ) {
				const value = {
					label: articleTitle.charAt( 0 ).toUpperCase() + articleTitle.substr( 1, articleTitle.length - 1 ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: {}
				};
				if ( createTimeSnak( year ) ) {
					value.qualifiers.P585 = [ {
						property: 'P585',
						datatype: 'time',
						snaktype: 'value',
						datavalue: {
							type: 'time',
							value: createTimeSnak( year )
						}
					} ];
				}
				titles.push( value );
			}
		}
		titles = unique( titles );
	}
	if ( redirects.length ) {
		apiRequest( {
			action: 'query',
			redirects: 1,
			titles: redirects
		} ).done( function ( data ) {
			if ( data.query && data.query.redirects ) {
				for ( let i = 0; i < data.query.redirects.length; i++ ) {
					for ( let j = 0; j < titles.length; j++ ) {
						const lcTitle = titles[ j ].label.substr( 0, 1 ).toLowerCase() + titles[ j ].label.substr( 1 );
						const lcRedirect = data.query.redirects[ i ].from.substr( 0, 1 ).toLowerCase() + data.query.redirects[ i ].from.substr( 1 );
						if ( lcTitle === lcRedirect ) {
							titles.splice( j + 1, 0, {
								label: data.query.redirects[ i ].to,
								language: contentLanguage,
								project: getConfig( 'project' ),
								year: titles[ j ].year
							} );
							j++;
						}
					}
				}
			}

			getWikidataIds( titles, processWbGetItems, $wrapper );
		} );
	} else {
		getWikidataIds( titles, processWbGetItems, $wrapper );
	}
}

/**
 * Compares the values of the infobox and Wikidata
 */
export function canExportValue( $field, claims, callbackIfCan ) {
	if ( !claims || !( claims.length ) ) {
		// Can't export only if image is local and large
		const $localImg = $field.find( '.image img[src*="/wikipedia/' + contentLanguage + '/"]' );
		if ( !$localImg.length || $localImg.width() < 80 ) {
			callbackIfCan();
		}
		return;
	}

	switch ( claims[ 0 ].mainsnak.datatype ) {
		case 'quantity':
			for ( let i = 0; i < claims.length; i++ ) {
				const parsedTime = createTimeSnak( ( $field.text().match( /\(([^)]*\d\d\d\d)[,)\s]/ ) || [] )[ 1 ] );
				if ( parsedTime && ( claims[ i ].qualifiers || {} ).P585 ) {
					const claimPrecision = claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision;
					if ( parsedTime.precision < claimPrecision ) {
						claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision = parsedTime.precision;
					} else if ( parsedTime.precision > claimPrecision ) { // FIXME: Specify the date in Wikidata later
						parsedTime.precision = claimPrecision;
					}
					const p585 = parsedTime ? formatDataValue( {
						type: 'time',
						value: parsedTime
					} )[ 0 ].innerText : '';

					if ( formatDataValue( claims[ i ].qualifiers.P585[ 0 ].datavalue )[ 0 ].innerText !== p585 ) {
						claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision = claimPrecision;
						continue;
					}
				}
				return;
			}
			callbackIfCan( true );
			break;

		case 'wikibase-item':
			const value = parseItems( $field, $field, function ( values ) {
				const duplicates = [];
				for ( let i = 0; i < values.length; i++ ) {
					for ( let j = 0; j < claims.length; j++ ) {
						if ( values[ i ].wd.value.id === claims[ j ].mainsnak.datavalue.value.id ) {
							duplicates.push( values[ i ].wd.value.id );
						}
					}
				}
				if ( duplicates.length < values.length ) {
					if ( duplicates.length > 0 ) {
						const propertyId = claims[ 0 ].mainsnak.property;
						alreadyExistingItems[ propertyId ] = duplicates;
						if ( propertyId === 'P166' && values.length === claims.length )
							return;
					}
					if ( claims.length > 0 ) {
						if ( claims[ 0 ].mainsnak.property === 'P19' || claims[ 0 ].mainsnak.property === 'P20' )
							return;
					}
					callbackIfCan( true );
				}
			} );
	}
	// By default we can't export if there are claims already
}

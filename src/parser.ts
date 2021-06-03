import { getConfig } from './config';
import { getI18n } from './i18n';
import { checkForMissedLanguage, contentLanguage } from './languages';
import { createTimeSnak, getWikidataIds } from './wikidata';
import { lowercaseFirst, unique, uppercaseFirst } from './utils';
import { apiRequest, sparqlRequest } from './api';
import { parseRawQuantity } from './text-parser';
import {
	DataType,
	WikidataClaim,
	WikidataSnak
} from './types/wikidata';
import { KeyValue, Title } from './types/main';
import { CommonsMediaValue, ItemValue, QuantityValue, TimeValue } from './types/wikidata/values';
import { ApiResponse, SparqlResponse } from './types/api';

export const alreadyExistingItems: KeyValue = {};

/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseQuantity( text: string, forceInteger?: boolean ): WikidataSnak {
	text = text.replace( /,/g, '.' ).replace( /[−–—]/g, '-' ).trim();
	const config: KeyValue = {
		're-10_3': getConfig( 're-10_3' ),
		're-10_6': getConfig( 're-10_6' ),
		're-10_9': getConfig( 're-10_9' ),
		're-10_12': getConfig( 're-10_12' )
	};

	const value: QuantityValue | undefined = parseRawQuantity( config, text, forceInteger );
	if ( value === undefined ) {
		return;
	}
	const snak: WikidataSnak = {
		type: 'quantity',
		value: value
	};

	// Sourcing circumstances (P1480) = circa (Q5727902)
	const circaMatch = text.match( getConfig( 're-circa' ) );
	if ( circaMatch ) {
		snak.qualifiers = {
			P1480: [ {
				property: 'P1480',
				snaktype: 'value',
				datavalue: {
					type: 'wikibase-entityid',
					value: { id: 'Q5727902' }
				}
			} ]
		};
		text = text.replace( circaMatch[ 0 ], '' ); // FIXME: modify text
	}

	return snak;
}

function addQualifierValue( snak: WikidataSnak, qualifierId: string, qualifierSnak: WikidataSnak ): WikidataSnak {
	if ( snak.qualifiers === undefined ) {
		snak.qualifiers = {};
	}
	if ( snak.qualifiers[ qualifierId ] === undefined ) {
		snak.qualifiers[ qualifierId ] = [];
	}
	const datatype = getConfig( 'properties.' + qualifierId + '.datatype' );
	snak.qualifiers[ qualifierId ].push( {
		snaktype: 'value',
		property: qualifierId,
		datavalue: {
			type: datatype,
			value: qualifierSnak
		}
	} );
	return snak;
}

async function processItemTitles( itemTitles: KeyValue ): Promise<WikidataSnak[]> {
	const snaks: WikidataSnak[] = [];

	for ( const qualifierId in itemTitles ) {
		const qualifierItemTitles = itemTitles[ qualifierId ];
		const valuesObj: { [ key: string ]: WikidataSnak } = await getWikidataIds( qualifierId, qualifierItemTitles );
		for ( const entityId in valuesObj ) {
			const snak: WikidataSnak = addQualifierValue( {} as WikidataSnak, qualifierId, valuesObj[ entityId ] );
			snaks.push( snak );
		}
	}

	return snaks;
}

export async function addQualifiers( $field: JQuery, snak: WikidataSnak ): Promise<WikidataSnak[]> {
	const $ = require( 'jquery' );
	const $qualifiers = $field.find( '[data-wikidata-qualifier-id]' );

	const qualifierTitles: KeyValue = {};
	for ( let q = 0; q < $qualifiers.length; q++ ) {
		const $qualifier = $( $qualifiers[ q ] );
		const qualifierId = $qualifier.data( 'wikidata-qualifier-id' );
		let qualifierValue = $qualifier.text().replace( /\n/g, ' ' ).trim();
		const datatype: DataType = getConfig( 'properties.' + qualifierId + '.datatype' );
		switch ( datatype ) {
			case 'monolingualtext':
				qualifierValue = {
					text: $qualifier.text().replace( /\n/g, ' ' ).trim(),
					language: $qualifier.attr( 'lang' ) || contentLanguage
				};
				snak = addQualifierValue( snak, qualifierId, qualifierValue );
				break;

			case 'string':
				qualifierValue = $qualifier.text().replace( /\n/g, ' ' ).trim();
				snak = addQualifierValue( snak, qualifierId, qualifierValue );
				break;

			case 'time':
				qualifierValue = createTimeSnak( qualifierValue );
				snak = addQualifierValue( snak, qualifierId, qualifierValue );
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
								const m = $link.attr( 'href' ).match( /^https:\/\/([a-z-]+)\.(wik[^.]+)\./ );
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
						label: uppercaseFirst( qualifierValue ),
						language: contentLanguage,
						project: getConfig( 'project' ),
						qualifiers: {}
					} );
				}
				break;
		}
	}

	return processItemTitles( qualifierTitles );
}

/**
 * Recognition of units of measurement in the infobox parameter and its label
 */
function recognizeUnits( text: string, units: KeyValue, label?: string ): string[] {
	if ( Array.isArray( units ) && units.length === 0 ) {
		return [ '1' ];
	}
	const result: string[] = [];
	for ( const idx in units ) {
		if ( !units.hasOwnProperty( idx ) ) {
			continue;
		}
		const item: string = parseInt( idx, 10 ) >= 0 ? units[ idx ] : idx;
		const search: string = getConfig( 'units' )[ item ].search;
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

export async function prepareCommonsMedia( $content: JQuery, $wrapper: JQuery ): Promise<WikidataSnak[]> {
	let snaks: WikidataSnak[] = [];
	const $imgs: JQuery = $content.find( 'img' );
	const imgs: JQuery[] = [];
	$imgs.each( function () {
		imgs.push( $( this ) );
	} );
	for ( const pos in imgs ) {
		const $img: JQuery = imgs[ pos ];
		const src: string = $img.attr( 'src' );
		if ( !src.match( /upload\.wikimedia\.org\/wikipedia\/commons/ ) ) {
			return;
		}
		const srcParts: string[] = src.split( '/' );
		let fileName = srcParts.pop();
		if ( fileName.match( /(?:^|-)\d+px-/ ) ) {
			fileName = srcParts.pop();
		}
		fileName = decodeURIComponent( fileName );
		fileName = fileName.replace( /_/g, ' ' );
		const value: CommonsMediaValue = {
			value: fileName
		};
		const snak: WikidataSnak = {
			type: 'commonsMedia',
			value: value
		};

		snaks = await addQualifiers( $wrapper, snak );
	}

	return snaks;
}

export async function prepareExternalId( $content: JQuery, propertyId: string ): Promise<WikidataSnak[]> {
	let externalId = $content.data( 'wikidata-external-id' ) || $content.text();
	const snaks: WikidataSnak[] = [];

	if ( propertyId === 'P345' ) { // IMDb
		externalId = $content.find( 'a' ).first().attr( 'href' );
		externalId = externalId.substr( externalId.lastIndexOf( '/', externalId.length - 2 ) ).replace( /\//g, '' );
	} else {
		externalId = externalId.toString().replace( /^ID\s/, '' ).replace( /\s/g, '' );
	}

	const sparql = 'SELECT * WHERE { ?item wdt:' + propertyId + ' "' + externalId + '" }';
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( data.results.bindings.length ) {
		snaks.push( {
			type: 'external-id',
			value: externalId.toString()
		} );
	}

	return snaks;
}

export function prepareMonolingualText( $content: JQuery ): WikidataSnak[] {
	const $: JQueryStatic = require( 'jquery' );
	const mw = require( 'mw' );
	const snaks: WikidataSnak[] = [];
	let $items: JQuery = $content.find( 'span[lang]' );
	$items.each( function () {
		const $item: JQuery = $( this );
		snaks.push( checkForMissedLanguage( {
			type: 'monolingualtext',
			value: {
				text: $item.text().trim(),
				language: $item.attr( 'lang' ).trim()
			}
		} ) );
	} );
	if ( !snaks.length ) {
		const text = $content.text().trim();
		if ( text ) {
			$items = mw.util.$content.find( 'span[lang]' );
			$items.each( function () {
				const $item = $( this );
				if ( $item.text().trim().startsWith( text ) ) {
					snaks.push( checkForMissedLanguage( {
						value: {
							text: text,
							language: $item.attr( 'lang' ).trim()
						},
						type: 'monolingualtext'
					} ) );
				}
			} );
		}
	}

	return snaks;
}

export async function prepareQuantity( $content: JQuery, propertyId: string ): Promise<WikidataSnak[]> {
	let snaks: WikidataSnak[] = [];
	let text: string = $content.text()
		.replace( /[\u00a0\u25bc\u25b2]/g, ' ' )
		.replace( /\s*\(([^)]*\))/g, '' )
		.trim();

	// Hack for time in formats "hh:mm:ss" and "00m 00s""
	const match: string[] = text.replace( getConfig( 're-min-sec' ), '$1:$2' )
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

	const snak: WikidataSnak = parseQuantity( text, getConfig( 'properties.' + propertyId + '.constraints.integer' ) );
	if ( !snak || !snak.value ) {
		return;
	}

	snaks = await addQualifiers( $content, snak );

	if ( getConfig( 'properties.' + propertyId + '.constraints.qualifier' ).indexOf( 'P585' ) !== -1 ) {
		let yearMatch: string[] = $content.text().match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
		if ( !yearMatch ) {
			yearMatch = $content.closest( 'tr' ).find( 'th' ).first().text().match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
		}
		if ( yearMatch ) {
			const extractedDate: TimeValue | string = createTimeSnak( yearMatch[ 1 ].replace( /(\d)\s(\d)/, '$1$2' ) );
			if ( extractedDate ) {
				snak.qualifiers = {
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

	const qualifierMatch: RegExpMatchArray = $content.text().match( /\(([^)]*)/ );
	if ( qualifierMatch ) {
		const qualifierQuantitySnak: WikidataSnak = parseQuantity( qualifierMatch[ 1 ] );
		if ( qualifierQuantitySnak ) {
			// @ts-ignore
			const qualifierQuantity: QuantityValue = qualifierQuantitySnak.value;
			const supportedProperties: string[] = [ 'P2076', 'P2077' ];
			for ( let j = 0; j < supportedProperties.length; j++ ) {
				const units: string[] = recognizeUnits( qualifierMatch[ 1 ], getConfig( 'properties.' + supportedProperties[ j ] + '.units' ) );
				if ( units.length === 1 ) {
					qualifierQuantity.unit = 'http://www.wikidata.org/entity/' + units[ 0 ];
					if ( !snak.qualifiers ) {
						snak.qualifiers = {};
					}
					snak.qualifiers[ supportedProperties[ j ] ] = [ {
						snaktype: 'value',
						property: supportedProperties[ j ],
						datavalue: {
							type: 'quantity',
							value: qualifierQuantity
						}
					} ];
				}
			}
		}
	}

	const founded: string[] = recognizeUnits( text, getConfig( 'properties' )[ propertyId ].units, $content.closest( 'tr' ).find( 'th' ).first().text() );
	for ( let u = 0; u < founded.length; u++ ) {
		// @ts-ignore
		snak.value.unit = '1';
		if ( founded[ u ] !== '1' ) {
			// @ts-ignore
			snak.value.unit = 'http://www.wikidata.org/entity/' + founded[ u ];
			// const item = getConfig( 'units.' + founded[ u ] );
		}
		snak.type = 'quantity';
		snaks.push( snak );
	}

	return snaks;
}

export function prepareTime( $content: JQuery ): WikidataSnak[] {
	const snaks: WikidataSnak[] = [];
	const value: TimeValue = createTimeSnak( $content.text().toLowerCase().trim().replace( getConfig( 're-year-postfix' ), '' ),
		$content[ 0 ].outerHTML.includes( getConfig( 'mark-julian' ) ) );
	if ( value ) {
		snaks.push( {
			type: 'time',
			value: value
		} );
	}

	return snaks;
}

export function prepareString( $content: JQuery, propertyId: string ): WikidataSnak[] {
	const snaks: WikidataSnak[] = [];
	let text: string = $content.data( 'wikidata-external-id' );
	if ( !text ) {
		text = $content.text();
	}
	let strings: string[] = text.toString().trim().split( /[\n,;]+/ );

	// Commons category
	if ( propertyId === 'P373' ) {
		const $link: JQuery = $content.find( 'a[class="extiw"]' ).first();
		if ( $link.length ) {
			const url: string = $link.attr( 'href' );
			let value = url.substr( url.indexOf( '/wiki/' ) + 6 )
				.replace( /_/g, ' ' )
				.replace( /^[Cc]ategory:/, '' )
				.replace( /\?.*$/, '' );
			value = decodeURIComponent( value );
			strings = [ value ];
		}
	}

	for ( const i in strings ) {
		const s: string = strings[ i ].replace( /\n/g, ' ' ).trim();
		if ( s ) {
			snaks.push( {
				type: 'string',
				value: s
			} );
		}
	}

	return snaks;
}

export function prepareUrl( $content: JQuery ): WikidataSnak[] {
	const snaks: WikidataSnak[] = [];
	const $links: JQuery = $content.find( 'a' );
	$links.each( function () {
		const $link: JQuery = $( this );
		const url: string = $link.attr( 'href' ).replace( /^\/\//, 'https://' );
		snaks.push( {
			type: 'url',
			value: url
		} );
	} );

	return snaks;
}

async function processWbGetItems( valuesObj: { [ key: string ]: WikidataSnak }, $wrapper: JQuery ): Promise<WikidataSnak[]> {
	const $: JQueryStatic = require( 'jquery' );
	let snaks: WikidataSnak[] = $.map( valuesObj, function ( snak: WikidataSnak ) {
		return [ snak ];
	} );
	if ( snaks.length === 1 ) {
		const snak: WikidataSnak = snaks.pop();
		snaks = await addQualifiers( $wrapper, snak );
	}
	return snaks;
}

export async function parseItems( $content: JQuery, $wrapper: JQuery, propertyId: string ): Promise<WikidataSnak[]> {
	const $: JQueryStatic = require( 'jquery' );
	let titles: Title[] = [];

	for ( let k = 0; k < getConfig( 'fixed-values' ).length; k++ ) {
		const fixedValue = getConfig( 'fixed-values' )[ k ];
		const regexp: RegExp = new RegExp( fixedValue.search );
		if ( $content.attr( 'data-wikidata-property-id' ) === fixedValue.property &&
			$content.text().match( regexp )
		) {
			const valuesObj: { [ key: string ]: WikidataSnak } = {};
			const snak: WikidataSnak = {
				type: 'wikibase-item',
				value: {
					id: fixedValue.item,
					label: fixedValue.label,
					description: ''
				}
			};
			// @ts-ignore
			if ( 'label' in snak.value ) {
				delete snak.value.label;
			}
			// @ts-ignore
			if ( 'description' in snak.value ) {
				delete snak.value.description;
			}
			valuesObj[ fixedValue.item ] = snak;
			// processWbGetItems( valuesObj, $wrapper, callback );
			// @ts-ignore
			return valuesObj.values();
		}
	}

	const $links: JQuery = $content.find( 'a[title][class!=image][class!=new]' );
	const redirects: string[] = [];

	if ( $links.length ) {
		for ( let j = 0; j < $links.length; j++ ) {
			const $link: JQuery = $( $links[ j ] );
			if ( $link.parents( '[data-wikidata-qualifier-id]' ).length ) {
				continue;
			}
			let extractedUrl: string = decodeURIComponent( $link.attr( 'href' ) ).replace( /^.*\/wiki\//, '' );
			if ( extractedUrl ) {
				extractedUrl = extractedUrl.replace( /_/g, ' ' ).trim();
				const value: Title = {
					label: uppercaseFirst( extractedUrl ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: {}
				};
				let match: RegExpMatchArray = $links[ j ].innerHTML.match( getConfig( 're-since-year' ) );
				if ( !match ) {
					match = $links[ j ].innerHTML.match( getConfig( 're-until-year' ) );
				}
				const extractedYear: TimeValue = match ? createTimeSnak( match[ 1 ] ) : createTimeSnak( ( $links[ j ].nextSibling || {} ).textContent );
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
					const m: RegExpMatchArray = $links[ j ].getAttribute( 'href' ).match( /^https:\/\/([a-z-]+)\.(wik[^.]+)\./ );
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
		const parts: string[] = $content.text().split( /[\n,;]+/ );
		for ( const i in parts ) {
			let year: string = '';
			const articleTitle: string = parts[ i ].replace( /\([^)]*\)/, function ( match: string ) {
				year = match.replace( /\(\)/, '' );
				return '';
			} ).trim();
			if ( articleTitle ) {
				const title: Title = {
					label: uppercaseFirst( articleTitle ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: {}
				};
				if ( createTimeSnak( year ) ) {
					title.qualifiers.P585 = [ {
						property: 'P585',
						datatype: 'time',
						snaktype: 'value',
						datavalue: {
							type: 'time',
							value: createTimeSnak( year )
						}
					} ];
				}
				titles.push( title );
			}
		}
		titles = unique( titles );
	}
	if ( redirects.length ) {
		const data: ApiResponse = await apiRequest( {
			action: 'query',
			redirects: 1,
			titles: redirects
		} );
		if ( data.query && data.query.redirects ) {
			for ( let i = 0; i < data.query.redirects.length; i++ ) {
				for ( let j = 0; j < titles.length; j++ ) {
					const lcTitle: string = lowercaseFirst( titles[ j ].label );
					const lcRedirect: string = lowercaseFirst( data.query.redirects[ i ].from );
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
	}

	const valuesObj: { [ key: string ]: WikidataSnak } = await getWikidataIds( propertyId, titles );
	return processWbGetItems( valuesObj, $wrapper );
}

/**
 * Compares the values of the infobox and Wikidata
 */
export async function canExportValue( propertyId: string, $field: JQuery, claims: WikidataClaim[] ): Promise<boolean> {
	if ( !claims || !( claims.length ) ) {
		// Can't export only if image is local and large
		const $localImg: JQuery = $field.find( '.image img[src*="/wikipedia/' + contentLanguage + '/"]' );
		return !$localImg.length || $localImg.width() < 80;
	}

	switch ( claims[ 0 ].mainsnak.datatype ) {
		case 'quantity':
			for ( let i = 0; i < Object.keys( claims ).length; i++ ) {
				// @ts-ignore
				const parsedTime: TimeValue = createTimeSnak( ( $field.text().match( /\(([^)]*\d\d\d\d)[,)\s]/ ) || [] )[ 1 ] );
				if ( parsedTime && ( claims[ i ].qualifiers || {} ).P585 ) {
					const claimPrecision: number = claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision;
					if ( parsedTime.precision < claimPrecision ) {
						claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision = parsedTime.precision;
					} else if ( parsedTime.precision > claimPrecision ) { // FIXME: Specify the date in Wikidata later
						parsedTime.precision = claimPrecision;
					}

					// if ( await formatSnak( 'P585', claims[ i ].qualifiers.P585[ 0 ].datavalue )[ 0 ].innerText !== p585 ) {
					// claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision = claimPrecision;
					// continue;
					// }
				}
				return false;
			}
			return true;

		case 'wikibase-item':
			const snaks: WikidataSnak[] = await parseItems( $field, $field, propertyId );
			const duplicates: string[] = [];
			for ( let i = 0; i < snaks.length; i++ ) {
				for ( let j = 0; j < Object.keys( claims ).length; j++ ) {
					// @ts-ignore
					const valuesValue: ItemValue = snaks[ i ].wd.value;
					// @ts-ignore
					const claimsValue: ItemValue = claims[ j ].mainsnak.datavalue.value;
					if ( valuesValue.id === claimsValue.id ) {
						duplicates.push( valuesValue.id );
					}
				}
			}
			if ( duplicates.length < snaks.length ) {
				if ( duplicates.length > 0 ) {
					const propertyId: string = claims[ 0 ].mainsnak.property;
					alreadyExistingItems[ propertyId ] = duplicates;
					if ( propertyId === 'P166' && snaks.length === claims.length ) {
						return false;
					}
				}
				if ( Object.keys( claims ).length > 0 ) {
					if ( claims[ 0 ].mainsnak.property === 'P19' || claims[ 0 ].mainsnak.property === 'P20' ) {
						return false;
					}
				}
				return true;
			}
	}

	return false;
}

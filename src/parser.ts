import { getConfig } from './config';
import { checkForMissedLanguage, contentLanguage } from './languages';
import {
	convertSnakToStatement,
	createTimeValue,
	generateItemSnak,
	getWikidataIds
} from './wikidata';
import { lowercaseFirst, unique, uppercaseFirst } from './utils';
import { apiRequest, sparqlRequest } from './api';
import { FixedValue, KeyValue, Title } from './types/main';
import {
	CommonsMediaValue,
	ItemValue,
	MonolingualTextValue,
	TimeValue,
	Value
} from './types/wikidata/values';
import { ApiResponse, SparqlResponse } from './types/api';
import { canExportQuantity } from './parser/quantity';
import { Reference, Snak, Statement } from './types/wikidata/main';
import { DataType, PropertyId, typesMapping } from './types/wikidata/types';
import {
	CommonsMediaDataValue,
	ExternalIdDataValue,
	MonolingualTextDataValue, StringDataValue, TimeDataValue,
	UrlDataValue
} from './types/wikidata/datavalues';

export const alreadyExistingItems: KeyValue = {};

function addQualifierValue(
	statement: Statement,
	qualifierId: string,
	qualifierDataType: DataType,
	qualifierValue: Value | void
): Statement {
	if ( !qualifierValue ) {
		return statement;
	}
	if ( statement.qualifiers === undefined ) {
		statement.qualifiers = {};
	}
	if ( statement.qualifiers[ qualifierId ] === undefined ) {
		statement.qualifiers[ qualifierId ] = [];
	}
	statement.qualifiers[ qualifierId ].push( {
		snaktype: 'value',
		property: qualifierId,
		datatype: qualifierDataType,
		datavalue: {
			type: typesMapping[ qualifierDataType ],
			value: qualifierValue
		}
	} );

	return statement;
}

/**
 * Extract reference URL
 */
function getReferences( $field: JQuery ): Reference[] {
	const references: Reference[] = [];
	const $notes: JQuery = $field.find( 'sup.reference a' );
	for ( let i = 0; i < $notes.length; i++ ) {
		// @ts-ignore
		const $externalLinks: JQuery = $( decodeURIComponent( $notes[ i ].hash ).replace( /[!"$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&' ) + ' a[rel="nofollow"]' );
		for ( let j = 0; j < $externalLinks.length; j++ ) {
			const $externalLink: JQuery = $( $externalLinks.get( j ) );
			if ( !$externalLink.attr( 'href' ).match( /(wikipedia.org|webcitation.org|archive.is)/ ) ) {
				const source: Reference = {
					snaks: {
						P854: [ {
							property: 'P854',
							datatype: 'url',
							snaktype: 'value',
							datavalue: {
								type: 'string',
								value: $externalLink.attr( 'href' ).replace( /^\/\//, 'https://' )
							}
						} ]
					}
				};

				// P813
				if ( getConfig( 'mark-checked' ) !== '' ) {
					const $accessed = $externalLinks.parent().find( 'small:contains("' + getConfig( 'mark-checked' ) + '")' );
					if ( $accessed.length ) {
						const accessDate = createTimeValue( $accessed.first().text() );
						if ( accessDate ) {
							source.snaks.P813 = [ {
								property: 'P813',
								datatype: 'time',
								snaktype: 'value',
								datavalue: {
									type: 'time',
									value: accessDate
								}
							} ];
						}
					}
				}

				// P1065 + P2960
				if ( getConfig( 'mark-archived' ) !== '' ) {
					const $archiveLinks = $externalLinks.filter( 'a:contains("' + getConfig( 'mark-archived' ) + '")' );
					if ( $archiveLinks.length ) {
						const $archiveLink = $archiveLinks.first();
						source.snaks.P1065 = [ {
							property: 'P1065',
							datatype: 'url',
							snaktype: 'value',
							datavalue: {
								type: 'string',
								value: {
									value: $archiveLink.attr( 'href' ).replace( /^\/\//, 'https://' )
								}
							}
						} ];

						const archiveDate = createTimeValue( $archiveLink.parent().text().replace( getConfig( 'mark-archived' ), '' ).trim() );
						if ( archiveDate ) {
							source.snaks.P2960 = [ {
								property: 'P2960',
								datatype: 'time',
								snaktype: 'value',
								datavalue: {
									type: 'time',
									value: archiveDate
								}
							} ];
						}
					}
				}

				references.push( source );
				break;
			}
		}
	}
	references.push( { snaks: getConfig( 'references' ) } );
	return references;
}

export async function parseItems( $content: JQuery, propertyId: string ): Promise<Statement[]> {
	const $: JQueryStatic = require( 'jquery' );
	let titles: Title[] = [];

	const fixedValues: FixedValue[] = getConfig( 'fixed-values' );
	const references: Reference[] = getReferences( $content );
	for ( let k = 0; k < fixedValues.length; k++ ) {
		const fixedValue: FixedValue = fixedValues[ k ];
		const regexp: RegExp = new RegExp( fixedValue.search );
		if (
			$content.attr( 'data-wikidata-property-id' ) === fixedValue.property &&
			$content.text().match( regexp )
		) {
			const snak: Snak = generateItemSnak( propertyId, fixedValue.item );
			const statement: Statement = convertSnakToStatement( snak, references );
			return [ statement ];
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
				const extractedYear: TimeValue | void = match ? createTimeValue( match[ 1 ] ) : createTimeValue( ( $links[ j ].nextSibling || {} ).textContent );
				if ( extractedYear ) {
					value.qualifiers.P585 = [ {
						snaktype: 'value',
						property: 'P585',
						datavalue: {
							type: 'time',
							value: extractedYear
						},
						datatype: 'time'
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
				if ( createTimeValue( year ) ) {
					title.qualifiers.P585 = [ {
						snaktype: 'value',
						property: 'P585',
						datavalue: {
							type: 'time',
							value: createTimeValue( year )
						},
						datatype: 'time'
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

	return getWikidataIds( propertyId, titles, references );
}

export async function addQualifiers( $field: JQuery, statement: Statement ): Promise<Statement> {
	const $: JQueryStatic = require( 'jquery' );
	const $qualifiers: JQuery = $field.find( '[data-wikidata-qualifier-id]' );

	const qualifierTitles: KeyValue = {};
	for ( let q = 0; q < $qualifiers.length; q++ ) {
		const $qualifier: JQuery = $( $qualifiers[ q ] );
		const qualifierId: PropertyId = $qualifier.data( 'wikidata-qualifier-id' );
		let qualifierValue: Value | void = $qualifier.text().replace( /\n/g, ' ' ).trim();
		const datatype: DataType = getConfig( `properties.${qualifierId}.datatype` );
		switch ( datatype ) {
			case 'monolingualtext':
				qualifierValue = {
					text: $qualifier.text().replace( /\n/g, ' ' ).trim(),
					language: $qualifier.attr( 'lang' ) || contentLanguage
				};
				statement = addQualifierValue( statement, qualifierId, datatype, qualifierValue );
				break;

			case 'string':
				qualifierValue = $qualifier.text().replace( /\n/g, ' ' ).trim();
				statement = addQualifierValue( statement, qualifierId, datatype, qualifierValue );
				break;

			case 'time':
				qualifierValue = createTimeValue( qualifierValue );
				statement = addQualifierValue( statement, qualifierId, datatype, qualifierValue );
				break;

			case 'wikibase-item':
				if ( qualifierTitles[ qualifierId ] === undefined ) {
					qualifierTitles[ qualifierId ] = [];
				}
				const qualifierFakeStatements: Statement[] = await parseItems( $qualifier, qualifierId );
				for ( const i in qualifierFakeStatements ) {
					const qualifierValue: Value = qualifierFakeStatements[ i ].mainsnak.datavalue.value;
					statement = addQualifierValue( statement, qualifierId, datatype, qualifierValue );
				}
				break;
		}
	}

	return statement;
}

export async function prepareCommonsMedia( $content: JQuery, propertyId: string ): Promise<Statement[]> {
	const statements: Statement[] = [];
	const $imgs: JQuery = $content.find( 'img' );
	const imgs: JQuery[] = [];
	$imgs.each( function () {
		imgs.push( $( this ) );
	} );
	const references: Reference[] = getReferences( $content );
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
		const dataValue: CommonsMediaDataValue = {
			type: 'string',
			value: value
		};
		const snak: Snak = {
			snaktype: 'value',
			property: propertyId,
			datavalue: dataValue,
			datatype: 'commonsMedia'
		};
		let statement: Statement = convertSnakToStatement( snak, references );
		statement = await addQualifiers( $content, statement );
		statements.push( statement );
	}

	return statements;
}

export async function prepareExternalId( $content: JQuery, propertyId: string ): Promise<Statement[]> {
	let externalId = $content.data( 'wikidata-external-id' ) || $content.text();
	const statements: Statement[] = [];

	if ( propertyId === 'P345' ) { // IMDb
		externalId = $content.find( 'a' ).first().attr( 'href' );
		externalId = externalId.substr( externalId.lastIndexOf( '/', externalId.length - 2 ) ).replace( /\//g, '' );
	} else {
		externalId = externalId.toString().replace( /^ID\s/, '' ).replace( /\s/g, '' );
	}

	const sparql = `SELECT ?item WHERE { ?item wdt:${propertyId} "${externalId}" } LIMIT 1`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( data.results.bindings.length ) {
		const dataValue: ExternalIdDataValue = {
			value: externalId.toString(),
			type: 'string'
		};
		const snak: Snak = {
			snaktype: 'value',
			property: propertyId,
			datavalue: dataValue,
			datatype: 'external-id'
		};
		const references: Reference[] = getReferences( $content );
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	}

	return statements;
}

export function prepareMonolingualText( $content: JQuery, propertyId: string ): Statement[] {
	const $: JQueryStatic = require( 'jquery' );
	const mw = require( 'mw' );
	const values: MonolingualTextValue[] = [];
	const statements: Statement[] = [];
	let $items: JQuery = $content.find( 'span[lang]' );
	$items.each( function () {
		const $item: JQuery = $( this );
		const value: MonolingualTextValue = {
			text: $item.text().trim(),
			language: $item.attr( 'lang' ).trim()
		};
		values.push( value );
	} );
	if ( !values.length ) {
		const text = $content.text().trim();
		if ( text ) {
			$items = mw.util.$content.find( 'span[lang]' );
			$items.each( function () {
				const $item = $( this );
				if ( $item.text().trim().startsWith( text ) ) {
					const value: MonolingualTextValue = {
						text: text,
						language: $item.attr( 'lang' ).trim()
					};
					values.push( value );
				}
			} );
		}
	}

	const references: Reference[] = getReferences( $content );
	for ( const i in values ) {
		const dataValue: MonolingualTextDataValue = {
			value: values[ i ],
			type: 'monolingualtext'
		};
		const snak: Snak = {
			snaktype: 'value',
			property: propertyId,
			datavalue: dataValue,
			datatype: 'monolingualtext'
		};
		let statement: Statement = convertSnakToStatement( snak, references );
		statement = checkForMissedLanguage( statement );
		statements.push( statement );
	}

	return statements;
}

export function prepareTime( $content: JQuery, propertyId: string ): Statement[] {
	const statements: Statement[] = [];

	const timeText: string = $content.text().toLowerCase().trim().replace( getConfig( 're-year-postfix' ), '' );
	const isJulian: boolean = $content[ 0 ].outerHTML.includes( getConfig( 'mark-julian' ) );
	const value: TimeValue | void = createTimeValue( timeText, isJulian );

	if ( value ) {
		const dataValue: TimeDataValue = {
			value: value,
			type: 'time'
		};
		const snak: Snak = {
			snaktype: 'value',
			property: propertyId,
			datavalue: dataValue,
			datatype: 'time'
		};
		const references: Reference[] = getReferences( $content );
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	}

	return statements;
}

export function prepareString( $content: JQuery, propertyId: string ): Statement[] {
	const statements: Statement[] = [];
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

	const references: Reference[] = getReferences( $content );
	for ( const i in strings ) {
		const s: string = strings[ i ].replace( /\n/g, ' ' ).trim();
		if ( s ) {
			const dataValue: StringDataValue = {
				value: s,
				type: 'string'
			};
			const snak: Snak = {
				snaktype: 'value',
				property: propertyId,
				datavalue: dataValue,
				datatype: 'string'
			};
			const statement: Statement = convertSnakToStatement( snak, references );
			statements.push( statement );
		}
	}

	return statements;
}

export function prepareUrl( $content: JQuery, propertyId: string ): Statement[] {
	const statements: Statement[] = [];
	const $links: JQuery = $content.find( 'a' );
	const references: Reference[] = getReferences( $content );
	$links.each( function () {
		const $link: JQuery = $( this );
		const url: string = $link.attr( 'href' ).replace( /^\/\//, 'https://' );

		const dataValue: UrlDataValue = {
			type: 'string',
			value: url
		};
		const snak: Snak = {
			snaktype: 'value',
			property: propertyId,
			datavalue: dataValue,
			datatype: 'url'
		};
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	} );

	return statements;
}

export async function canExportItem( propertyId: string, wikidataStatements: Statement[], $field: JQuery ): Promise<boolean> {
	const localStatements: Statement[] = await parseItems( $field, propertyId );
	const duplicates: string[] = [];
	for ( let i = 0; i < localStatements.length; i++ ) {
		for ( let j = 0; j < wikidataStatements.length; j++ ) {
			const localValue: ItemValue = localStatements[ i ].mainsnak.datavalue.value as ItemValue;
			const wikidataValue: ItemValue = wikidataStatements[ j ].mainsnak.datavalue.value as ItemValue;
			if ( localValue.id === wikidataValue.id ) {
				duplicates.push( localValue.id );
			}
		}
	}
	if ( duplicates.length < localStatements.length ) {
		if ( duplicates.length > 0 ) {
			const propertyId: string = wikidataStatements[ 0 ].mainsnak.property;
			alreadyExistingItems[ propertyId ] = duplicates;
			if ( propertyId === 'P166' && localStatements.length === wikidataStatements.length ) {
				return false;
			}
		}
		if ( Object.keys( wikidataStatements ).length > 0 ) {
			if ( wikidataStatements[ 0 ].mainsnak.property === 'P19' || wikidataStatements[ 0 ].mainsnak.property === 'P20' ) {
				return false;
			}
		}
		return true;
	}
}

/**
 * Compares the values of the infobox and Wikidata
 */
export async function canExportValue( propertyId: string, $field: JQuery, statements: Statement[] ): Promise<boolean> {
	if ( !statements || !( statements.length ) ) {
		// Can't export only if image is local and large
		const $localImg: JQuery = $field.find( '.image img[src*="/wikipedia/' + contentLanguage + '/"]' );
		return !$localImg.length || $localImg.width() < 80;
	}

	switch ( statements[ 0 ].mainsnak.datatype ) {
		case 'quantity':
			return canExportQuantity( statements, $field );

		case 'wikibase-item':
			return canExportItem( propertyId, statements, $field );

	}

	return false;
}

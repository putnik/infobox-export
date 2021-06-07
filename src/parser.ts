import { getConfig } from './config';
import { checkForMissedLanguage, contentLanguage } from './languages';
import {
	convertSnakToStatement,
	generateItemSnak,
	getWikidataIds
} from './wikidata';
import { lowercaseFirst, unique, uppercaseFirst } from './utils';
import { apiRequest, sparqlRequest } from './api';
import { Context, FixedValue, KeyValue, Title } from './types/main';
import {
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
	MonolingualTextDataValue,
	StringDataValue,
	UrlDataValue
} from './types/wikidata/datavalues';
import { getReferences } from './parser/utils';
import { createTimeValue } from './parser/time';

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

export async function parseItems( context: Context ): Promise<Statement[]> {
	const $: JQueryStatic = require( 'jquery' );
	let titles: Title[] = [];

	const fixedValues: FixedValue[] = getConfig( 'fixed-values' );
	const references: Reference[] = getReferences( context.$wrapper );
	for ( let k = 0; k < fixedValues.length; k++ ) {
		const fixedValue: FixedValue = fixedValues[ k ];
		const regexp: RegExp = new RegExp( fixedValue.search );
		if (
			context.$field.attr( 'data-wikidata-property-id' ) === fixedValue.property &&
			context.$field.text().match( regexp )
		) {
			const snak: Snak = generateItemSnak( context.propertyId, fixedValue.item );
			const statement: Statement = convertSnakToStatement( snak, references );
			return [ statement ];
		}
	}

	const $links: JQuery = context.$field.find( 'a[title][class!=image][class!=new]' );
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
	} else if ( context.$field.text().trim() ) {
		// If no links found try to search for articles by text value
		const parts: string[] = context.$field.text().split( /[\n,;]+/ );
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

	return getWikidataIds( context.propertyId, titles, references );
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
				const qualifierContext: Context = {
					propertyId: qualifierId,
					text: $qualifier.text().trim(),
					$field: $qualifier.clone(),
					$wrapper: $qualifier.clone()
				};
				const qualifierFakeStatements: Statement[] = await parseItems( qualifierContext );
				for ( const i in qualifierFakeStatements ) {
					const qualifierValue: Value = qualifierFakeStatements[ i ].mainsnak.datavalue.value;
					statement = addQualifierValue( statement, qualifierId, datatype, qualifierValue );
				}
				break;
		}
	}

	return statement;
}

export async function prepareCommonsMedia( context: Context ): Promise<Statement[]> {
	const statements: Statement[] = [];
	const $imgs: JQuery = context.$field.find( 'img' );
	const imgs: JQuery[] = [];
	$imgs.each( function () {
		imgs.push( $( this ) );
	} );
	const references: Reference[] = getReferences( context.$wrapper );
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
		const dataValue: CommonsMediaDataValue = {
			type: 'string',
			value: fileName
		};
		const snak: Snak = {
			snaktype: 'value',
			property: context.propertyId,
			datavalue: dataValue,
			datatype: 'commonsMedia'
		};
		let statement: Statement = convertSnakToStatement( snak, references );
		statement = await addQualifiers( context.$field, statement );
		statements.push( statement );
	}

	return statements;
}

export async function prepareExternalId( context: Context ): Promise<Statement[]> {
	let externalId = context.$field.data( 'wikidata-external-id' ) || context.text;
	const statements: Statement[] = [];

	if ( context.propertyId === 'P345' ) { // IMDb
		externalId = context.$field.find( 'a' ).first().attr( 'href' );
		externalId = externalId.substr( externalId.lastIndexOf( '/', externalId.length - 2 ) ).replace( /\//g, '' );
	} else {
		externalId = externalId.toString().replace( /^ID\s/, '' ).replace( /\s/g, '' );
	}

	const sparql = `SELECT ?item WHERE { ?item wdt:${context.propertyId} "${externalId}" } LIMIT 1`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( data.results.bindings.length ) {
		const dataValue: ExternalIdDataValue = {
			value: externalId.toString(),
			type: 'string'
		};
		const snak: Snak = {
			snaktype: 'value',
			property: context.propertyId,
			datavalue: dataValue,
			datatype: 'external-id'
		};
		const references: Reference[] = getReferences( context.$wrapper );
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	}

	return statements;
}

export function prepareMonolingualText( context: Context ): Statement[] {
	const $: JQueryStatic = require( 'jquery' );
	const mw = require( 'mw' );
	const values: MonolingualTextValue[] = [];
	const statements: Statement[] = [];
	let $items: JQuery = context.$field.find( 'span[lang]' );
	$items.each( function () {
		const $item: JQuery = $( this );
		const value: MonolingualTextValue = {
			text: $item.text().trim(),
			language: $item.attr( 'lang' ).trim()
		};
		values.push( value );
	} );
	if ( !values.length ) {
		const text = context.$field.text().trim();
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

	const references: Reference[] = getReferences( context.$wrapper );
	for ( const i in values ) {
		const dataValue: MonolingualTextDataValue = {
			value: values[ i ],
			type: 'monolingualtext'
		};
		const snak: Snak = {
			snaktype: 'value',
			property: context.propertyId,
			datavalue: dataValue,
			datatype: 'monolingualtext'
		};
		let statement: Statement = convertSnakToStatement( snak, references );
		statement = checkForMissedLanguage( statement );
		statements.push( statement );
	}

	return statements;
}

export function prepareString( context: Context ): Statement[] {
	const statements: Statement[] = [];
	let text: string = context.$field.data( 'wikidata-external-id' );
	if ( !text ) {
		text = context.text;
	}
	let strings: string[] = text.toString().trim().split( /[\n,;]+/ );

	// Commons category
	if ( context.propertyId === 'P373' ) {
		const $link: JQuery = context.$field.find( 'a[class="extiw"]' ).first();
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

	const references: Reference[] = getReferences( context.$wrapper );
	for ( const i in strings ) {
		const s: string = strings[ i ].replace( /\n/g, ' ' ).trim();
		if ( s ) {
			const dataValue: StringDataValue = {
				value: s,
				type: 'string'
			};
			const snak: Snak = {
				snaktype: 'value',
				property: context.propertyId,
				datavalue: dataValue,
				datatype: 'string'
			};
			const statement: Statement = convertSnakToStatement( snak, references );
			statements.push( statement );
		}
	}

	return statements;
}

export function prepareUrl( context: Context ): Statement[] {
	const statements: Statement[] = [];
	const $links: JQuery = context.$field.find( 'a' );
	const references: Reference[] = getReferences( context.$wrapper );
	$links.each( function () {
		const $link: JQuery = $( this );
		const url: string = $link.attr( 'href' ).replace( /^\/\//, 'https://' );

		const dataValue: UrlDataValue = {
			type: 'string',
			value: url
		};
		const snak: Snak = {
			snaktype: 'value',
			property: context.propertyId,
			datavalue: dataValue,
			datatype: 'url'
		};
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	} );

	return statements;
}

export async function canExportItem( propertyId: PropertyId, wikidataStatements: Statement[], $field: JQuery ): Promise<boolean> {
	const context: Context = {
		propertyId: propertyId,
		text: $field.text().trim(),
		$field: $field.clone(),
		$wrapper: $field.clone()
	};
	const localStatements: Statement[] = await parseItems( context );
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
export async function canExportValue( propertyId: PropertyId, $field: JQuery, statements: Statement[] ): Promise<boolean> {
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

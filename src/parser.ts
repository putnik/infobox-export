import { getOrLoadProperty, getProperty } from './config';
import { checkForMissedLanguage, contentLanguage } from './languages';
import { convertSnakToStatement } from './wikidata';
import { sparqlRequest } from './api';
import { Context, KeyValue, Property } from './types/main';
import { MonolingualTextValue, TimeValue, Value } from './types/wikidata/values';
import { SparqlResponse } from './types/api';
import { canExportQuantity } from './parser/quantity';
import { Reference, Snak, Statement } from './types/wikidata/main';
import { DataType, PropertyId, typesMapping } from './types/wikidata/types';
import {
	CommonsMediaDataValue,
	ExternalIdDataValue,
	MonolingualTextDataValue
} from './types/wikidata/datavalues';
import { getReferences } from './parser/utils';
import { createTimeValue, prepareTime } from './parser/time';
import { canExportItem, parseItem } from './parser/item';

export function addQualifierValue(
	statement: Statement,
	qualifierId: PropertyId,
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

export async function addPointInTimeQualifier( $field: JQuery, statement: Statement ): Promise<Statement> {
	const qualifierId: PropertyId = statement.mainsnak.property === 'P69' ? 'P582' : 'P585';

	if ( statement.qualifiers?.[ qualifierId ] ) {
		return statement;
	}

	let matches: RegExpMatchArray;
	const pointInTimeRegex: RegExp = /\(([^()]+)\)/g;
	while ( ( matches = pointInTimeRegex.exec( $field.text() ) ) ) {
		const fakeContext: Context = {
			propertyId: qualifierId,
			text: matches[ 1 ].trim(),
			$field: $( '<span>' ),
			$wrapper: $( '<span>' )
		};

		const qualifierStatements: Statement[] = prepareTime( fakeContext );
		if ( !qualifierStatements.length ) {
			continue;
		}
		if ( qualifierStatements.length > 1 ) {
			return statement;
		}

		const qualifierValue: TimeValue = ( qualifierStatements[ 0 ].mainsnak.datavalue.value ) as TimeValue;
		statement = addQualifierValue( statement, qualifierId, 'time', qualifierValue );
		break;
	}

	return statement;
}

export async function addQualifiers( $field: JQuery, statement: Statement ): Promise<Statement> {
	const $: JQueryStatic = require( 'jquery' );
	const $qualifiers: JQuery = $field.find( '[data-wikidata-qualifier-id]' );

	const qualifierTitles: KeyValue = {};
	for ( let q = 0; q < $qualifiers.length; q++ ) {
		const $qualifier: JQuery = $( $qualifiers[ q ] );
		const qualifierId: PropertyId = $qualifier.data( 'wikidata-qualifier-id' );
		let qualifierValue: Value | void = $qualifier.text().replace( /\n/g, ' ' ).trim();
		const property: Property | undefined = await getOrLoadProperty( qualifierId );
		const datatype: DataType | undefined = property?.datatype;
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
				const qualifierFakeStatements: Statement[] = await parseItem( qualifierContext );
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
		if ( !externalId ) {
			return [];
		}
		externalId = externalId.slice( externalId.lastIndexOf( '/', externalId.length - 2 ) ).replace( /\//g, '' );
	} else {
		externalId = externalId.toString().replace( /^ID\s/, '' ).replace( /\s/g, '' );
	}

	const property: Property | undefined = await getProperty( context.propertyId );
	if (
		property?.constraints?.format &&
		!externalId.match( new RegExp( '^(' + property.constraints.format + ')$' ) )
	) {
		return [];
	}

	const sparql = `SELECT ?item WHERE { ?item wdt:${context.propertyId} "${externalId}" } LIMIT 1`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( data.results.bindings.length ) {
		const url: string = data.results.bindings[ 0 ].item.value;
		window.open( `${url}#${context.propertyId}`, '_blank' );

		return [];
	}

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

	return statements;
}

export function prepareMonolingualText( context: Context ): Statement[] {
	const $: JQueryStatic = require( 'jquery' );
	const mw = require( 'mw' );
	const values: { [ key: string ]: MonolingualTextValue } = {};
	const statements: Statement[] = [];
	let $items: JQuery = context.$field.find( 'span[lang], i[lang]' );
	$items.each( function () {
		const $item: JQuery = $( this );
		const language: string = $item.attr( 'lang' ).trim();
		values[ language ] = {
			text: $item.text().trim(),
			language: language
		};
	} );
	if ( !Object.values( values ).length ) {
		const text = context.$field.text().trim();
		if ( text ) {
			$items = mw.util.$content.find( 'span[lang]' );
			$items.each( function () {
				const $item: JQuery = $( this );
				if ( $item.text().trim().startsWith( text ) ) {
					const language: string = $item.attr( 'lang' ).trim();
					values[ language ] = {
						text: text,
						language: language
					};
				}
			} );
		}
	}
	if ( values.und ) {
		delete values.und;
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

/**
 * Compares the values of the infobox and Wikidata
 */
export async function canExportValue( propertyId: PropertyId, $field: JQuery, statements: Statement[] ): Promise<boolean> {
	if ( !statements || !( statements.length ) ) {
		// Can't export empty field
		if ( $field.html().trim() === '' ) {
			return false;
		}

		// Can't export if image is local and large
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

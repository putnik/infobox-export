import type { SparqlResponse } from './types/api';
import type { Context, KeyValue, Property } from './types/main';
import type {
	CommonsMediaDataValue,
	ExternalIdDataValue,
	MonolingualTextDataValue
} from './types/wikidata/datavalues';
import type { Reference, Snak, Statement } from './types/wikidata/main';
import type { MonolingualTextValue, TimeValue, Value } from './types/wikidata/values';
import { getOrLoadProperty, getProperty } from './config';
import { checkForMissedLanguage, contentLanguage } from './languages';
import { convertSnakToStatement } from './wikidata';
import { sparqlRequest } from './api';
import { canExportQuantity } from './parser/quantity';
import { type DataType, type PropertyId, typesMapping } from './types/wikidata/types';
import { getReferences } from './parser/utils';
import { createTimeValue, isUncertainDateText, prepareTime } from './parser/time';
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

// Date qualifiers a parenthetical date can be assigned to: start / point / end.
export const DATE_CHOICE_PROPERTIES: PropertyId[] = [ 'P580', 'P585', 'P582' ];

export async function addPointInTimeQualifier( $field: JQuery, statement: Statement ): Promise<Statement> {
	// Default for a single date; ranges get start/end from prepareTime.
	let singleDefault: PropertyId;
	switch ( statement.mainsnak.property ) {
		case 'P512':
		case 'P803':
			singleDefault = 'P580';
			break;

		case 'P69':
			singleDefault = 'P582';
			break;

		default:
			singleDefault = 'P585';
	}

	// Grab the first parenthetical that parses as a date. Parsing as P580 lets a
	// range ("1969—1991") come back as start (P580) + end (P582).
	let parsed: Statement[] = [];
	let parsedText: string = '';
	let matches: RegExpMatchArray;
	const pointInTimeRegex: RegExp = /\(([^()]+)\)/g;
	while ( ( matches = pointInTimeRegex.exec( $field.text() ) ) ) {
		const candidate: Statement[] = prepareTime( {
			propertyId: 'P580',
			text: matches[ 1 ].trim(),
			$field: $( '<span>' ),
			$wrapper: $( '<span>' )
		} );
		if ( candidate.length ) {
			parsed = candidate;
			parsedText = matches[ 1 ].trim();
			break;
		}
	}

	// Messy parenthetical (date mixed with prose): offer it unselected.
	const uncertain: boolean = isUncertainDateText( parsedText );

	// Collect the date value(s); a range keeps each snak's start/end property.
	const choices: { value: TimeValue; selected: PropertyId | null }[] = [];
	for ( const parsedStatement of parsed ) {
		const mainsnak: Snak = parsedStatement.mainsnak;
		if ( mainsnak.snaktype !== 'value' || !mainsnak.datavalue ) {
			continue; // e.g. "(?)" -> unknown value, not a concrete date to pick
		}
		const selected: PropertyId | null = uncertain ?
			null :
			( parsed.length > 1 ? mainsnak.property : singleDefault );
		choices.push( { value: mainsnak.datavalue.value as TimeValue, selected } );
	}
	if ( !choices.length ) {
		return statement;
	}

	// Awards (P166): commit the first date as P585, no choice.
	if ( statement.mainsnak.property === 'P166' ) {
		if ( !statement.qualifiers?.[ 'P585' ] ) {
			statement = addQualifierValue( statement, 'P585', 'time', choices[ 0 ].value );
		}
		return statement;
	}

	// Otherwise drop the auto-committed date(s) and let the user pick in the dialog.
	const chosenValues: string[] = choices.map( ( choice ): string => JSON.stringify( choice.value ) );
	for ( const propertyId of DATE_CHOICE_PROPERTIES ) {
		const snaks: Snak[] | undefined = statement.qualifiers?.[ propertyId ];
		if ( snaks?.length === 1 && snaks[ 0 ].datavalue &&
			chosenValues.includes( JSON.stringify( snaks[ 0 ].datavalue.value ) )
		) {
			delete statement.qualifiers[ propertyId ];
		}
	}
	if ( statement.qualifiers && !Object.keys( statement.qualifiers ).length ) {
		delete statement.qualifiers;
	}
	statement.meta = statement.meta || {};
	statement.meta.dateChoices = choices;
	return statement;
}

/**
 * Turn date qualifiers already committed onto a value (P580/P585/P582) into
 * dialog date-pickers. Used for multi-value fields where the field text can't be
 * re-read per value. Awards (P166) keep their point in time.
 */
export function convertCommittedDates( statement: Statement ): Statement {
	if ( statement.mainsnak.property === 'P166' ) {
		return statement;
	}

	// Messy parenthetical: offer it unselected.
	const uncertain: boolean = isUncertainDateText( statement.meta?.title?.dateText || '' );
	const choices: { value: TimeValue; selected: PropertyId | null }[] = [];
	for ( const propertyId of DATE_CHOICE_PROPERTIES ) {
		const snaks: Snak[] | undefined = statement.qualifiers?.[ propertyId ];
		if ( snaks?.length === 1 && snaks[ 0 ].snaktype === 'value' && snaks[ 0 ].datavalue ) {
			choices.push( {
				value: snaks[ 0 ].datavalue.value as TimeValue,
				selected: uncertain ? null : propertyId
			} );
			delete statement.qualifiers[ propertyId ];
		}
	}
	if ( !choices.length ) {
		return statement;
	}
	if ( statement.qualifiers && !Object.keys( statement.qualifiers ).length ) {
		delete statement.qualifiers;
	}
	statement.meta = statement.meta || {};
	statement.meta.dateChoices = choices;
	return statement;
}

export async function addQualifiers( $field: JQuery, statement: Statement ): Promise<Statement> {
	const $: JQueryStatic = require( 'jquery' );
	const $qualifiers: JQuery = $field.find( '[data-wikidata-qualifier-id]' );

	const qualifierTitles: KeyValue = {};
	for ( let q: number = 0; q < $qualifiers.length; q++ ) {
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
	$imgs.each( function (): void {
		imgs.push( $( this ) );
	} );
	const references: Reference[] = getReferences( context.$wrapper );
	for ( const pos in imgs ) {
		const $img: JQuery = imgs[ pos ];
		const src: string = $img.attr( 'src' );
		if ( !src.match( /upload\.wikimedia\.org\/wikipedia\/commons/ ) ) {
			continue; // locally-uploaded file, not on Commons -> skip
		}
		const srcParts: string[] = src.split( '/' );
		let fileName: string = srcParts.pop();
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

	const sparql: string = `SELECT ?item WHERE { ?item wdt:${ context.propertyId } "${ externalId }" } LIMIT 1`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( data.results.bindings.length ) {
		const url: string = data.results.bindings[ 0 ].item.value;
		window.open( `${ url }#${ context.propertyId }`, '_blank' );

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
	$items.each( function (): void {
		const $item: JQuery = $( this );
		const language: string = $item.attr( 'lang' ).trim();
		values[ language ] = {
			text: $item.text().trim(),
			language: language
		};
	} );
	if ( !Object.values( values ).length ) {
		const text: string = context.$field.text().trim();
		if ( text ) {
			$items = mw.util.$content.find( 'span[lang]' );
			$items.each( function (): void {
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

		// Skip a big image that isn't on Commons (e.g. a local upload).
		const $nonCommonsImg: JQuery = $field.find( 'img' ).filter( function ( _index: number, element: HTMLElement ): boolean {
			const img: HTMLImageElement = element as HTMLImageElement;
			const imgSrc: string = img.getAttribute( 'src' ) || '';
			return !!imgSrc &&
				!imgSrc.match( /upload\.wikimedia\.org\/wikipedia\/commons/ ) &&
				img.width >= 80;
		} );
		return $nonCommonsImg.length === 0;
	}

	switch ( statements[ 0 ].mainsnak.datatype ) {
		case 'quantity':
			return canExportQuantity( statements, $field );

		case 'wikibase-item':
			return canExportItem( propertyId, statements, $field );
	}

	return false;
}

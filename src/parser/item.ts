import { Context, FixedValue, KeyValue, Property, Title } from '../types/main';
import { Reference, Snak, SnaksObject, Statement } from '../types/wikidata/main';
import { getConfig, getProperty } from '../config';
import { getReferences } from './utils';
import { convertSnakToStatement, generateItemSnak, getStatements } from '../wikidata';
import { lowercaseFirst, unique, uppercaseFirst } from '../utils';
import { contentLanguage } from '../languages';
import { ItemValue } from '../types/wikidata/values';
import { prepareTime } from './time';
import { ApiResponse, SparqlResponse } from '../types/api';
import { apiRequest, sparqlRequest } from '../api';
import { ItemId, PropertyId } from '../types/wikidata/types';
import { addPointInTimeQualifier, addQualifiers } from '../parser';

export const alreadyExistingItems: KeyValue = {};

const START_PROPERTY: PropertyId = 'P580';
const END_PROPERTY: PropertyId = 'P582';
const MOMENT_PROPERTY: PropertyId = 'P585';

function getTimeSnaks( text: string, propertyId: PropertyId ): SnaksObject {
	const snaks: SnaksObject = {};

	const fakeContext: Context = {
		propertyId: START_PROPERTY,
		text: text,
		$field: $( '<span>' ).text( text ),
		$wrapper: $( '<span>' ).text( text )
	};

	const fakeTimeStatements: Statement[] = prepareTime( fakeContext );
	let snakStart: Snak;
	let snakEnd: Snak;
	for ( const i in fakeTimeStatements ) {
		const statement: Statement = fakeTimeStatements[ i ];
		if ( statement.mainsnak.property === START_PROPERTY ) {
			snakStart = statement.mainsnak;
		} else if ( statement.mainsnak.property === END_PROPERTY ) {
			snakEnd = statement.mainsnak;
		}
	}

	if ( snakStart && snakEnd ) {
		snaks[ START_PROPERTY ] = [ snakStart ];
		snaks[ END_PROPERTY ] = [ snakEnd ];
	} else if ( snakStart ) {
		snakStart.property = propertyId === 'P69' ? END_PROPERTY : MOMENT_PROPERTY;
		snaks[ snakStart.property ] = [ snakStart ];
	}

	return snaks;
}

export async function filterItemStatements( propertyId: PropertyId, statements: Statement[] ): Promise<Statement[]> {
	const property: Property | undefined = await getProperty( propertyId );
	if ( typeof property === 'undefined' ) {
		return [];
	}

	if ( property.constraints.noneOfValues ) {
		statements = statements.map( ( statement: Statement ) => {
			const itemId: ItemId = ( statement.mainsnak.datavalue.value as ItemValue ).id;
			if ( typeof property.constraints.noneOfValues[ itemId ] === 'undefined' ) {
				return statement;
			}
			if ( property.constraints.noneOfValues[ itemId ] === null ) {
				return null;
			}
			statement.mainsnak = generateItemSnak( propertyId, property.constraints.noneOfValues[ itemId ] );
			return statement;
		} ).filter( ( statement: Statement | null ) => ( statement !== null ) );
	}

	if ( property.constraints.oneOfValues && property.constraints.oneOfValues.length ) {
		statements = statements.filter( ( statement: Statement ) => (
			property.constraints.oneOfValues.includes( ( statement.mainsnak.datavalue.value as ItemValue ).id )
		) );
	}

	if ( property.constraints.valueType && property.constraints.valueType.length ) {
		const statementItemIds: ItemId[] = statements.map( ( statement: Statement ) => (
			( statement.mainsnak.datavalue.value as ItemValue ).id
		) );
		const sparql: string = `SELECT DISTINCT ?item { VALUES ?item {wd:${statementItemIds.join( ' wd:' )}}.
			VALUES ?class {wd:${property.constraints.valueType.join( ' wd:' )}}.
			?item wdt:P31?/wdt:P279* ?class }`;
		const data: SparqlResponse = await sparqlRequest( sparql );
		const validItemIds: ItemId[] = [];

		for ( let i = 0; i < data.results.bindings.length; i++ ) {
			const itemId: ItemId = data.results.bindings[ i ].item.value.replace( /^.+\/(Q\d+)$/, '$1' ) as ItemId;
			validItemIds.push( itemId );
		}
		statements = statements.filter( ( statement: Statement ) => (
			validItemIds.includes( ( statement.mainsnak.datavalue.value as ItemValue ).id )
		) );
	}

	return statements;
}

export async function parseItem( context: Context ): Promise<Statement[]> {
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

				let timeString: string = '';
				if ( $links[ j ].nextSibling ) {
					const timeMatch: RegExpMatchArray | null = $links[ j ].nextSibling.textContent.match( /^['"»]?\s*\((.+)\)\s*$/ );
					if ( timeMatch ) {
						timeString = timeMatch[ 1 ];
					}
				}

				const value: Title = {
					label: uppercaseFirst( extractedUrl ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: getTimeSnaks( timeString, context.propertyId )
				};

				if ( $link.hasClass( 'extiw' ) ) {
					const wikiLinkMatch: RegExpMatchArray | null = $links[ j ].getAttribute( 'href' )
						.match( /^https:\/\/([a-z-]+)\.(wik[^.]+)\./ );
					if ( wikiLinkMatch && wikiLinkMatch[ 2 ] !== 'wikimedia' ) {
						value.language = wikiLinkMatch[ 1 ];
						value.project = wikiLinkMatch[ 1 ] + wikiLinkMatch[ 2 ].replace( 'wikipedia', 'wiki' );
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
			let timeString: string = '';
			const articleTitle: string = parts[ i ].replace( /\([^)]*\)/, function ( match: string ) {
				timeString = match.replace( /\(\)/, '' );
				return '';
			} ).trim();
			if ( articleTitle ) {
				const title: Title = {
					label: uppercaseFirst( articleTitle ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: getTimeSnaks( timeString, context.propertyId )
				};
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
						titles[ j ].redirect = data.query.redirects[ i ].to;
						titles.splice( j + 1, 0, {
							label: data.query.redirects[ i ].to,
							language: contentLanguage,
							project: getConfig( 'project' )
						} );
						j++;
					}
				}
			}
		}
	}

	let statements = await getStatements( context.propertyId, titles, references );
	statements = await filterItemStatements( context.propertyId, statements );
	if ( statements.length === 1 ) {
		statements[ 0 ] = await addQualifiers( context.$field, statements[ 0 ] );
		statements[ 0 ] = await addPointInTimeQualifier( context.$field, statements[ 0 ] );
	}

	return statements;
}

export async function canExportItem( propertyId: PropertyId, wikidataStatements: Statement[], $field: JQuery ): Promise<boolean> {
	const context: Context = {
		propertyId: propertyId,
		text: $field.text().trim(),
		$field: $field.clone(),
		$wrapper: $field
	};
	const localStatements: Statement[] = await parseItem( context );
	alreadyExistingItems[ propertyId ] = [];
	const invalidValues: Set<ItemId> = new Set();
	for ( let i = 0; i < localStatements.length; i++ ) {
		const localValue: ItemValue = localStatements[ i ].mainsnak.datavalue.value as ItemValue;
		if ( localStatements[ i ].meta?.subclassItem ) {
			invalidValues.add( localValue.id );
		}
		for ( let j = 0; j < wikidataStatements.length; j++ ) {
			const existingValue: ItemValue = wikidataStatements[ j ].mainsnak.datavalue?.value as ItemValue | undefined;
			if ( existingValue?.id === undefined ) {
				continue;
			}
			alreadyExistingItems[ propertyId ].push( existingValue.id );
			if ( localValue.id === existingValue.id ) {
				invalidValues.add( localValue.id );
			}
		}
	}
	if ( invalidValues.size < localStatements.length ) {
		if ( invalidValues.size > 0 ) {
			if ( propertyId === 'P166' && localStatements.length === wikidataStatements.length ) {
				return false;
			}
		}
		if ( Object.keys( wikidataStatements ).length > 0 ) {
			if ( [ 'P19', 'P20' ].includes( propertyId ) ) {
				return false;
			}
		}
		return true;
	}
}

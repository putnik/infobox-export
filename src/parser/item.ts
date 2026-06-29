import type { Context, FixedValue, KeyValue, Property, Title } from '../types/main';
import type { Reference, Snak, SnaksObject, Statement } from '../types/wikidata/main';
import { getConfig, getProperty } from '../config';
import { getReferences } from './utils';
import { convertSnakToStatement, generateItemSnak, getItemPropertyValues, getStatements, randomEntityGuid } from '../wikidata';
import { lowercaseFirst, unique, uppercaseFirst } from '../utils';
import { contentLanguage } from '../languages';
import type { ItemValue, QuantityValue, TimeValue } from '../types/wikidata/values';
import { prepareTime } from './time';
import type { ApiResponse, SparqlResponse } from '../types/api';
import { apiRequest, sparqlRequest, wdApiRequest } from '../api';
import type { ItemId, PropertyId } from '../types/wikidata/types';
import { addPointInTimeQualifier, addQualifierValue, addQualifiers, convertCommittedDates } from '../parser';

export const alreadyExistingItems: KeyValue = {};

export const exportCounts: { [ key: string ]: { [ key: string ]: number } } = {};

// Dates to add/upgrade on existing statements, keyed [propertyId][itemId].
// snakHash + precise mean a precision upgrade (replace a coarser existing date).
export interface EnrichAssignment {
	guid: string;
	dateProp: string;
	dateValue: string;
	snakHash?: string;
	precise?: boolean;
	skipImportRef?: boolean;
	targetClaim?: Statement;
}
export const enrichPlan: { [ key: string ]: { [ key: string ]: EnrichAssignment[] } } = {};

// Existing statements with several dates packed into one, offered for splitting.
// Keyed by property id.
export const splitCandidates: { [ key: string ]: Statement[] } = {};

const START_PROPERTY: PropertyId = 'P580';
const END_PROPERTY: PropertyId = 'P582';
const MOMENT_PROPERTY: PropertyId = 'P585';

const DATE_PROPERTIES: string[] = [ MOMENT_PROPERTY, START_PROPERTY, END_PROPERTY ];

function findDateQualifier( statement: Statement ): { prop: string; value: unknown } | null {
	for ( const prop of DATE_PROPERTIES ) {
		const snaks: Snak[] | undefined = statement.qualifiers?.[ prop ];
		if ( snaks && snaks.length && snaks[ 0 ].datavalue ) {
			return { prop, value: snaks[ 0 ].datavalue.value };
		}
	}
	return null;
}

// Compare two dates at the coarser precision, so 1953 == 1953-05-03.
function sameDate( a: any, b: any ): boolean {
	const precision: number = Math.min(
		typeof a?.precision === 'number' ? a.precision : 11,
		typeof b?.precision === 'number' ? b.precision : 11
	);
	const ra: RegExpExecArray | null = /^([+-])(\d+)-(\d+)-(\d+)/.exec( a?.time || '' );
	const rb: RegExpExecArray | null = /^([+-])(\d+)-(\d+)-(\d+)/.exec( b?.time || '' );
	if ( !ra || !rb ) {
		return JSON.stringify( a ) === JSON.stringify( b );
	}
	if ( ra[ 1 ] !== rb[ 1 ] || parseInt( ra[ 2 ], 10 ) !== parseInt( rb[ 2 ], 10 ) ) {
		return false;
	}
	if ( precision >= 10 && parseInt( ra[ 3 ], 10 ) !== parseInt( rb[ 3 ], 10 ) ) {
		return false;
	}
	if ( precision >= 11 && parseInt( ra[ 4 ], 10 ) !== parseInt( rb[ 4 ], 10 ) ) {
		return false;
	}
	return true;
}

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

	if ( snakStart && snakEnd && propertyId !== 'P166' ) {
		snaks[ START_PROPERTY ] = [ snakStart ];
		snaks[ END_PROPERTY ] = [ snakEnd ];
	} else if ( snakStart ) {
		// Single date, no range.
		snakStart.property = propertyId === 'P69' ? END_PROPERTY : MOMENT_PROPERTY;
		snaks[ snakStart.property ] = [ snakStart ];
	}

	return snaks;
}

// Dates from an award's parenthetical, e.g. "2002, 2004 — twice, 2006" ->
// [2002, 2004, 2006]. Each piece is parsed alone so a list isn't read as a range.
function extractAwardDates( text: string ): TimeValue[] {
	const dates: TimeValue[] = [];
	const seen: Set<string> = new Set();
	if ( !text ) {
		return dates;
	}
	const pieces: string[] = text.split( /[,;]+|\s[-–—]\s/ );
	for ( const piece of pieces ) {
		const trimmed: string = piece.trim();
		if ( !trimmed ) {
			continue;
		}
		const parsed: Statement[] = prepareTime( {
			propertyId: MOMENT_PROPERTY,
			text: trimmed,
			$field: $( '<span>' ).text( trimmed ),
			$wrapper: $( '<span>' ).text( trimmed )
		} );
		for ( const statement of parsed ) {
			if ( statement.mainsnak.snaktype === 'value' && statement.mainsnak.datavalue ) {
				const value: TimeValue = statement.mainsnak.datavalue.value as TimeValue;
				const key: string = JSON.stringify( value );
				if ( !seen.has( key ) ) {
					seen.add( key );
					dates.push( value );
				}
			}
		}
	}
	return dates;
}

// Awards (P166) only carry a point in time (P585). Split a value listing several
// dates ("(2002, 2004, 2006)") into one award statement per date.
function expandAwardDates( statements: Statement[] ): Statement[] {
	const result: Statement[] = [];
	for ( let statement of statements ) {
		const dates: TimeValue[] = [];
		const seen: Set<string> = new Set();
		const pushDate = ( value: TimeValue ): void => {
			const key: string = JSON.stringify( value );
			if ( !seen.has( key ) ) {
				seen.add( key );
				dates.push( value );
			}
		};
		for ( const value of extractAwardDates( statement.meta?.title?.dateText || '' ) ) {
			pushDate( value );
		}
		// Pull in dates already on the statement as qualifiers, including any
		// start/end time (awards must not keep those).
		for ( const prop of DATE_PROPERTIES ) {
			const snaks: Snak[] | undefined = statement.qualifiers?.[ prop ];
			if ( snaks ) {
				for ( const snak of snaks ) {
					if ( snak.snaktype === 'value' && snak.datavalue ) {
						pushDate( snak.datavalue.value as TimeValue );
					}
				}
			}
		}
		if ( statement.qualifiers ) {
			for ( const prop of DATE_PROPERTIES ) {
				delete statement.qualifiers[ prop ];
			}
			if ( !Object.keys( statement.qualifiers ).length ) {
				delete statement.qualifiers;
			}
		}
		if ( dates.length <= 1 ) {
			if ( dates.length === 1 ) {
				statement = addQualifierValue( statement, MOMENT_PROPERTY, 'time', dates[ 0 ] );
			}
			result.push( statement );
			continue;
		}
		for ( const value of dates ) {
			const clone: Statement = JSON.parse( JSON.stringify( statement ) );
			clone.id = randomEntityGuid();
			addQualifierValue( clone, MOMENT_PROPERTY, 'time', value );
			result.push( clone );
		}
	}
	return result;
}

export async function filterItemStatements( propertyId: PropertyId, statements: Statement[] ): Promise<Statement[]> {
	const property: Property | undefined = await getProperty( propertyId );
	if ( typeof property === 'undefined' ) {
		return [];
	}

	if ( property.constraints.noneOfValues ) {
		statements = statements.map( ( statement: Statement ): Statement | null => {
			const itemId: ItemId = ( statement.mainsnak.datavalue.value as ItemValue ).id;
			if ( typeof property.constraints.noneOfValues[ itemId ] === 'undefined' ) {
				return statement;
			}
			if ( property.constraints.noneOfValues[ itemId ] === null ) {
				return null;
			}
			statement.mainsnak = generateItemSnak( propertyId, property.constraints.noneOfValues[ itemId ] );
			return statement;
		} ).filter( ( statement: Statement | null ): boolean => ( statement !== null ) );
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
		const sparql: string = `SELECT DISTINCT ?item { VALUES ?item {wd:${ statementItemIds.join( ' wd:' ) }}.
			VALUES ?class {wd:${ property.constraints.valueType.join( ' wd:' ) }}.
			?item wdt:P31?/wdt:P279* ?class }`;
		const data: SparqlResponse = await sparqlRequest( sparql );
		const validItemIds: ItemId[] = [];

		for ( let i: number = 0; i < data.results.bindings.length; i++ ) {
			const itemId: ItemId = data.results.bindings[ i ].item.value.replace( /^.+\/(Q\d+)$/, '$1' ) as ItemId;
			validItemIds.push( itemId );
		}
		statements = statements.filter( ( statement: Statement ) => (
			validItemIds.includes( ( statement.mainsnak.datavalue.value as ItemValue ).id )
		) );
	}

	return statements;
}

// First parenthetical after a value, up to the next value separator, e.g. "1967".
// Walks siblings tracking paren depth, so it works mid-field ("… (1967); next")
// and when the parenthetical wraps markup.
function extractTrailingDateText( node: Node ): string {
	let siblingText: string = '';
	let depth: number = 0;
	let sibling: Node | null = node.nextSibling;
	while ( sibling ) {
		if ( sibling.nodeName === 'BR' ) {
			break;
		}
		if ( depth === 0 && sibling.nodeType === 1 &&
			( ( sibling as Element ).tagName === 'A' || ( sibling as Element ).hasAttribute( 'data-wikidata-value-id' ) )
		) {
			break; // the next value starts here
		}
		const text: string = sibling.textContent || '';
		let stop: boolean = false;
		for ( let c: number = 0; c < text.length; c++ ) {
			const character: string = text[ c ];
			if ( character === '(' ) {
				depth++;
			} else if ( character === ')' ) {
				depth = Math.max( 0, depth - 1 );
			} else if ( ( character === ';' || character === '\n' ) && depth === 0 ) {
				stop = true;
				break;
			}
			siblingText += character;
		}
		if ( stop ) {
			break;
		}
		sibling = sibling.nextSibling;
	}
	const timeMatch: RegExpMatchArray | null = siblingText.match( /\(([^()]+)\)/ );
	return timeMatch ? timeMatch[ 1 ].trim() : '';
}

// Qualifier markup belonging to one value: the data-wikidata-qualifier-id nodes
// inside the value element plus the following siblings up to the next value (so
// each award keeps its own hidden P585 date span).
function collectValueQualifierScope( element: HTMLElement ): JQuery {
	const $: JQueryStatic = require( 'jquery' );
	const $scope: JQuery = $( '<span>' );
	$( element ).find( '[data-wikidata-qualifier-id]' ).each( function (): void {
		$scope.append( $( this ).clone() );
	} );
	let sibling: Node | null = element.nextSibling;
	while ( sibling ) {
		if ( sibling.nodeType === 1 ) {
			const el: Element = sibling as Element;
			if ( el.hasAttribute( 'data-wikidata-value-id' ) || el.tagName === 'A' ) {
				break; // the next value starts here
			}
			if ( el.hasAttribute( 'data-wikidata-qualifier-id' ) ) {
				$scope.append( $( el ).clone() );
			} else {
				$( el ).find( '[data-wikidata-qualifier-id]' ).each( function (): void {
					$scope.append( $( this ).clone() );
				} );
			}
		}
		sibling = sibling.nextSibling;
	}
	return $scope;
}

async function parseValueIdStatements(
	context: Context,
	references: Reference[]
): Promise<{ statements: Statement[]; handledLinks: Set<HTMLElement> }> {
	const $: JQueryStatic = require( 'jquery' );
	const statements: Statement[] = [];
	const handledLinks: Set<HTMLElement> = new Set();

	const $valueElements: JQuery = context.$field.find( '[data-wikidata-value-id]' );
	if ( !$valueElements.length ) {
		return { statements, handledLinks };
	}

	const entries: { element: HTMLElement; itemId: ItemId; qualifiers: SnaksObject; dateText: string }[] = [];
	for ( let i: number = 0; i < $valueElements.length; i++ ) {
		const element: HTMLElement = $valueElements[ i ] as HTMLElement;
		const rawId: string = ( $( element ).attr( 'data-wikidata-value-id' ) || '' ).trim();
		if ( !/^Q\d+$/.test( rawId ) ) {
			continue; // malformed -> fall back to link/title parsing for this value
		}
		const dateText: string = extractTrailingDateText( element );
		entries.push( {
			element: element,
			itemId: rawId as ItemId,
			qualifiers: getTimeSnaks( dateText, context.propertyId ),
			dateText: dateText
		} );
	}
	if ( !entries.length ) {
		return { statements, handledLinks };
	}

	// Check the ids exist (a dead id falls back to link parsing) and read their
	// parts (P527) for broad-value suppression.
	const ids: ItemId[] = unique( entries.map( ( entry ): ItemId => entry.itemId ) );
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		ids: ids,
		props: [ 'claims' ]
	} );
	const entities: KeyValue = data?.entities || {};

	for ( const entry of entries ) {
		const entity = entities[ entry.itemId ];
		if ( !entity || entity.missing !== undefined ) {
			continue; // not found -> leave this value's link for the title parser
		}
		const snak: Snak = generateItemSnak( context.propertyId, entry.itemId );
		let statement: Statement = convertSnakToStatement( snak, references );
		if ( Object.keys( entry.qualifiers ).length ) {
			statement.qualifiers = entry.qualifiers;
		}
		// Apply this value's own qualifier markup (e.g. a hidden P585 span after it).
		const $qualifierScope: JQuery = collectValueQualifierScope( entry.element );
		if ( $qualifierScope.children().length ) {
			statement = await addQualifiers( $qualifierScope, statement );
		}
		statement.meta.fromValueId = true;
		statement.meta.title = {
			label: entry.itemId,
			language: contentLanguage,
			project: getConfig( 'project' ),
			dateText: entry.dateText
		};
		const partIds: ItemId[] = getItemPropertyValues( entity.claims, 'P527' );
		if ( partIds.length ) {
			statement.meta.partIds = partIds;
		}
		statements.push( statement );
		$( entry.element ).find( 'a' ).each( function (): void {
			handledLinks.add( this as HTMLElement );
		} );
	}

	return { statements, handledLinks };
}

export async function parseItem( context: Context ): Promise<Statement[]> {
	const $: JQueryStatic = require( 'jquery' );
	let titles: Title[] = [];

	// Drop TemplateStyles <style> blocks — their CSS text (e.g. "max-width:639px")
	// gets read as field text and mis-parsed as a year, faking a missing date.
	context.$field.find( 'style' ).remove();
	context.$field.find( 'sup.reference' ).remove();
	context.$field.find( '.printonly' ).remove();
	// Drop hidden noise, but keep our own markup: qualifiers/value ids are often
	// in display:none spans.
	context.$field.find( '[style*="display:none"]' )
		.not( '[data-wikidata-qualifier-id]' )
		.not( '[data-wikidata-value-id]' )
		.filter( function (): boolean {
			return $( this ).find( '[data-wikidata-qualifier-id], [data-wikidata-value-id]' ).length === 0;
		} )
		.remove();

	const fixedValues: FixedValue[] = getConfig( 'fixed-values' );
	const references: Reference[] = getReferences( context.$wrapper );

	// A bare number in child (P40) is a count -> number of children (P1971).
	// Anything with text (a name, "2 sons") stays a normal P40 child item.
	if ( context.propertyId === 'P40' ) {
		const childCount: string = context.$field.text().trim();
		if ( /^\d+$/.test( childCount ) ) {
			const childCountSnak: Snak = {
				snaktype: 'value',
				property: 'P1971' as PropertyId,
				datatype: 'quantity',
				datavalue: {
					type: 'quantity',
					value: { amount: '+' + childCount, unit: '1' } as QuantityValue
				}
			};
			return [ convertSnakToStatement( childCountSnak, references ) ];
		}
	}

	for ( let k: number = 0; k < fixedValues.length; k++ ) {
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

	// data-wikidata-value-id values come first; keep their links out of the title
	// parser below.
	const { statements: valueIdStatements, handledLinks } = await parseValueIdStatements( context, references );

	// Regular (text) value links.
	let $links: JQuery = context.$field.find( 'a[title][class!=image][class!=new]' );
	// Also pick up medal icons linked to an article ([[File:Medal.png|link=…]]).
	// Only links to a normal article (no namespace colon), not a plain File page.
	const $imageLinks: JQuery = context.$field.find( 'a[href]:not(.new)' ).filter( function ( _index: number, element: HTMLElement ): boolean {
		const $anchor: JQuery = $( element );
		if ( !$anchor.find( 'img' ).length || $anchor.parents( '[data-wikidata-qualifier-id]' ).length ) {
			return false;
		}
		const target: string = decodeURIComponent( $anchor.attr( 'href' ) || '' ).replace( /^.*\/wiki\//, '' );
		return target !== '' && target.indexOf( ':' ) === -1;
	} );
	$links = $links.add( $imageLinks );
	if ( handledLinks.size ) {
		$links = $links.filter( function ( _index: number, element: HTMLElement ): boolean {
			return !handledLinks.has( element );
		} );
	}
	const redirects: string[] = [];

	if ( $links.length ) {
		for ( let j: number = 0; j < $links.length; j++ ) {
			const $link: JQuery = $( $links[ j ] );
			if ( $link.parents( '[data-wikidata-qualifier-id]' ).length ) {
				continue;
			}
			let extractedUrl: string = decodeURIComponent( $link.attr( 'href' ) ).replace( /^.*\/wiki\//, '' );
			if ( extractedUrl ) {
				extractedUrl = extractedUrl.replace( /_/g, ' ' ).trim();

				let timeString: string = extractTrailingDateText( $links[ j ] );

				if ( !timeString ) {
					const titleMatch: RegExpMatchArray | null = ( $link.attr( 'title' ) || '' ).match( /.*\s[—–-]\s+(.+)$/ );
					if ( titleMatch ) {
						timeString = titleMatch[ 1 ].trim();
					}
				}

				const value: Title = {
					label: uppercaseFirst( extractedUrl ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: getTimeSnaks( timeString, context.propertyId ),
					dateText: timeString
				};

				// Get the project from the host when the href is absolute (medal-icon
				// links and interwikis without an extiw class point at another wiki).
				const wikiLinkMatch: RegExpMatchArray | null = ( $link.attr( 'href' ) || '' )
					.match( /^(?:https?:)?\/\/([a-z-]+)\.(wik[^.]+)\./ );
				if ( wikiLinkMatch && wikiLinkMatch[ 2 ] !== 'wikimedia' && wikiLinkMatch[ 2 ] !== 'wikidata' ) {
					value.language = wikiLinkMatch[ 1 ];
					value.project = wikiLinkMatch[ 1 ] + wikiLinkMatch[ 2 ].replace( 'wikipedia', 'wiki' );
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
	} else if ( !valueIdStatements.length && context.$field.text().trim() ) {
		// If no links found try to search for articles by text value
		const parts: string[] = context.$field.text().split( /[\n,;]+/ );
		for ( const i in parts ) {
			let timeString: string = '';
			let articleTitle: string = parts[ i ].replace( /\([^)]*\)/, function ( match: string ) {
				timeString = match.replace( /[()]/g, '' ).trim();
				return '';
			} ).trim();
			if ( !timeString ) {
				const dateMatch: RegExpMatchArray | null = articleTitle.match( /^(.*\S)\s[—–-]\s+((?:\d{1,2}[.\-/]){0,2}\d{4}(?:\s*г\.?)?)$/ );
				if ( dateMatch ) {
					articleTitle = dateMatch[ 1 ].trim();
					timeString = dateMatch[ 2 ].trim();
				}
			}
			if ( articleTitle ) {
				const title: Title = {
					label: uppercaseFirst( articleTitle ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: getTimeSnaks( timeString, context.propertyId ),
					dateText: timeString
				};
				titles.push( title );
				// Plain text might be a redirect (e.g. "Петроград" → "Санкт-Петербург"),
				// so resolve it like links do.
				redirects.push( articleTitle );
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
			for ( let i: number = 0; i < data.query.redirects.length; i++ ) {
				for ( let j: number = 0; j < titles.length; j++ ) {
					const lcTitle: string = lowercaseFirst( titles[ j ].label );
					const lcRedirect: string = lowercaseFirst( data.query.redirects[ i ].from );
					if ( lcTitle === lcRedirect ) {
						titles[ j ].redirect = data.query.redirects[ i ].to;
						// Copy the date/qualifiers onto the target so it keeps them.
						const sourceQualifiers: SnaksObject | undefined = titles[ j ].qualifiers;
						titles.splice( j + 1, 0, {
							label: data.query.redirects[ i ].to,
							language: contentLanguage,
							project: getConfig( 'project' ),
							qualifiers: sourceQualifiers ?
								JSON.parse( JSON.stringify( sourceQualifiers ) ) :
								undefined,
							dateText: titles[ j ].dateText
						} );
						j++;
					}
				}
			}
		}
	}

	let statements: Statement[] = valueIdStatements.concat(
		await getStatements( context.propertyId, titles, references )
	);
	statements = await filterItemStatements( context.propertyId, statements );
	// Only one value resolved, so re-reading the field text for its date is safe.
	const singleValue: boolean = valueIdStatements.length === 0 && titles.length === 1;
	// value-id statements already have their qualifiers; only post-process the rest.
	if ( statements.length === 1 && !statements[ 0 ].meta?.fromValueId ) {
		statements[ 0 ] = await addQualifiers( context.$field, statements[ 0 ] );
		// Only re-read the field text when it's a lone value with no date of its own.
		// Otherwise we'd grab another value's parenthetical, so keep the committed one.
		const hasCommittedDate: boolean = DATE_PROPERTIES.some(
			( prop: string ): boolean => ( statements[ 0 ].qualifiers?.[ prop ]?.length || 0 ) > 0
		);
		if ( singleValue && !hasCommittedDate ) {
			statements[ 0 ] = await addPointInTimeQualifier( context.$field, statements[ 0 ] );
		} else {
			statements[ 0 ] = convertCommittedDates( statements[ 0 ] );
		}
	} else {
		// Multi-value: each value already has its own date, so make per-value pickers.
		for ( let i: number = 0; i < statements.length; i++ ) {
			if ( !statements[ i ].meta?.fromValueId ) {
				statements[ i ] = convertCommittedDates( statements[ i ] );
			}
		}
	}

	// Awards: enforce point-in-time-only dates and split multi-date values into
	// one statement per date.
	if ( context.propertyId === 'P166' ) {
		statements = expandAwardDates( statements );
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
	let localStatements: Statement[] = await parseItem( context );

	// Drop a broad value when a more specific part (P527) is already on Wikidata
	// (e.g. the generic order when a specific degree is present).
	const existingValueIds: Set<string> = new Set();
	for ( const ws of wikidataStatements ) {
		const id: string | undefined = ( ws.mainsnak.datavalue?.value as ItemValue | undefined )?.id;
		if ( id ) {
			existingValueIds.add( id );
		}
	}
	localStatements = localStatements.filter( ( s: Statement ): boolean =>
		!( s.meta?.partIds || [] ).some( ( part: string ): boolean => existingValueIds.has( part ) )
	);

	alreadyExistingItems[ propertyId ] = [];
	const invalidValues: Set<ItemId> = new Set();
	for ( let i: number = 0; i < localStatements.length; i++ ) {
		const localValue: ItemValue = localStatements[ i ].mainsnak.datavalue.value as ItemValue;
		if ( localStatements[ i ].meta?.subclassItem ) {
			invalidValues.add( localValue.id );
		}
		for ( let j: number = 0; j < wikidataStatements.length; j++ ) {
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
	// Count every rank, including deprecated — a deprecated award still exists, so
	// don't re-export it as a duplicate.
	const wikidataCounts: { [ key: string ]: number } = {};
	for ( let j: number = 0; j < wikidataStatements.length; j++ ) {
		const existingId: ItemId | undefined = ( wikidataStatements[ j ].mainsnak.datavalue?.value as ItemValue | undefined )?.id;
		if ( existingId ) {
			wikidataCounts[ existingId ] = ( wikidataCounts[ existingId ] || 0 ) + 1;
		}
	}
	const infoboxCounts: { [ key: string ]: number } = {};
	for ( let i: number = 0; i < localStatements.length; i++ ) {
		const localId: ItemId | undefined = ( localStatements[ i ].mainsnak.datavalue?.value as ItemValue | undefined )?.id;
		if ( localId ) {
			infoboxCounts[ localId ] = ( infoboxCounts[ localId ] || 0 ) + 1;
		}
	}

	if ( Object.keys( wikidataStatements ).length > 0 && [ 'P19', 'P20' ].includes( propertyId ) ) {
		return false;
	}

	// Multi-value, date enrichment and splitting are award-only (P166); everything
	// else just exports new values.
	if ( propertyId !== 'P166' ) {
		delete exportCounts[ propertyId ];
		delete enrichPlan[ propertyId ];
		delete splitCandidates[ propertyId ];
		return invalidValues.size < localStatements.length;
	}

	// Plan date enrichment: drop dates Wikidata already has, then assign the rest to
	// dateless statements in order. Matching is precision-tolerant.
	const infoboxDatesByItem: { [ key: string ]: unknown[] } = {};
	const datePropByItem: { [ key: string ]: string } = {};
	for ( const local of localStatements ) {
		const localId: string | undefined = ( local.mainsnak.datavalue?.value as ItemValue | undefined )?.id;
		const dateQualifier = findDateQualifier( local );
		if ( localId && dateQualifier ) {
			infoboxDatesByItem[ localId ] = infoboxDatesByItem[ localId ] || [];
			infoboxDatesByItem[ localId ].push( dateQualifier.value );
			datePropByItem[ localId ] = dateQualifier.prop;
		}
	}
	// A statement that already carries an "imported from" reference (P143/P4656)
	// shouldn't get a second one — they differ only by the oldid, so the hash
	// check never dedupes them.
	const hasImportReference = ( statement: Statement ): boolean =>
		( statement.references || [] ).some(
			( reference ): boolean => !!( reference.snaks?.P143 || reference.snaks?.P4656 )
		);
	const importRefGuids: Set<string> = new Set();
	const claimByGuid: { [ key: string ]: Statement } = {};
	const plan: { [ key: string ]: EnrichAssignment[] } = {};
	for ( const itemId in infoboxDatesByItem ) {
		const dateProp: string = datePropByItem[ itemId ];
		// Existing statements for this award, split into dated and dateless.
		const datedStatements: { guid: string; value: any; hash: string | undefined }[] = [];
		const datelessGuids: string[] = [];
		for ( const s of wikidataStatements ) {
			if ( s.rank === 'deprecated' ) {
				continue;
			}
			const existingId: string | undefined = ( s.mainsnak.datavalue?.value as ItemValue | undefined )?.id;
			if ( existingId !== itemId ) {
				continue;
			}
			if ( s.id ) {
				claimByGuid[ s.id ] = s;
				if ( hasImportReference( s ) ) {
					importRefGuids.add( s.id );
				}
			}
			const snaks: Snak[] | undefined = s.qualifiers?.[ dateProp ];
			if ( snaks?.length && snaks[ 0 ].snaktype === 'value' && snaks[ 0 ].datavalue ) {
				datedStatements.push( { guid: s.id, value: snaks[ 0 ].datavalue.value, hash: snaks[ 0 ].hash } );
			} else if ( s.id ) {
				datelessGuids.push( s.id );
			}
		}

		const datePrecision = ( value: any ): number => ( typeof value?.precision === 'number' ? value.precision : 11 );
		const usedStatement: Set<number> = new Set();

		// Exact duplicates (same value at the same precision) are already present -> drop.
		const remaining: unknown[] = [];
		for ( const date of infoboxDatesByItem[ itemId ] ) {
			const exactIndex: number = datedStatements.findIndex(
				( s, i: number ): boolean => !usedStatement.has( i ) && JSON.stringify( s.value ) === JSON.stringify( date )
			);
			if ( exactIndex !== -1 ) {
				usedStatement.add( exactIndex );
			} else {
				remaining.push( date );
			}
		}

		const assignments: EnrichAssignment[] = [];

		// Precision upgrade: an infobox date that matches exactly one coarser existing
		// date (no ambiguity either way) replaces it in place.
		const available: unknown[] = [];
		for ( const date of remaining ) {
			const coarseStatements: number[] = [];
			for ( let i: number = 0; i < datedStatements.length; i++ ) {
				if ( usedStatement.has( i ) ) {
					continue;
				}
				if ( sameDate( datedStatements[ i ].value, date ) && datePrecision( datedStatements[ i ].value ) < datePrecision( date ) ) {
					coarseStatements.push( i );
				}
			}
			const target: number | undefined = coarseStatements.length === 1 ? coarseStatements[ 0 ] : undefined;
			// Ambiguous if several infobox dates target the same WD statement -> skip.
			const infoboxMatches: number = target === undefined ? 0 :
				remaining.filter( ( other: unknown ): boolean => sameDate( datedStatements[ target ].value, other ) ).length;
			if ( target !== undefined && infoboxMatches === 1 ) {
				usedStatement.add( target );
				assignments.push( {
					guid: datedStatements[ target ].guid,
					dateProp,
					dateValue: JSON.stringify( date ),
					snakHash: datedStatements[ target ].hash,
					precise: true,
					skipImportRef: importRefGuids.has( datedStatements[ target ].guid ),
					targetClaim: claimByGuid[ datedStatements[ target ].guid ]
				} );
			} else {
				available.push( date );
			}
		}

		// Pair the leftover dates with the dateless statements, in order.
		const pairCount: number = Math.min( available.length, datelessGuids.length );
		for ( let i: number = 0; i < pairCount; i++ ) {
			assignments.push( {
				guid: datelessGuids[ i ],
				dateProp,
				dateValue: JSON.stringify( available[ i ] ),
				skipImportRef: importRefGuids.has( datelessGuids[ i ] ),
				targetClaim: claimByGuid[ datelessGuids[ i ] ]
			} );
		}
		if ( assignments.length ) {
			plan[ itemId ] = assignments;
		}
	}
	if ( Object.keys( plan ).length ) {
		enrichPlan[ propertyId ] = plan;
	} else {
		delete enrichPlan[ propertyId ];
	}

	// Find statements with several dates packed in, to offer splitting them.
	const splits: Statement[] = wikidataStatements.filter( ( s: Statement ): boolean => {
		if ( s.rank === 'deprecated' ) {
			return false;
		}
		return DATE_PROPERTIES.some( ( prop: string ): boolean => ( s.qualifiers?.[ prop ]?.length || 0 ) > 1 );
	} );
	if ( splits.length ) {
		splitCandidates[ propertyId ] = splits;
	} else {
		delete splitCandidates[ propertyId ];
	}

	// Exportable if there's a date to add, a statement to split, or the infobox
	// has a value more times than Wikidata does.
	let exportable: boolean = Object.keys( plan ).length > 0 || splits.length > 0;
	for ( const id in infoboxCounts ) {
		if ( infoboxCounts[ id ] > ( wikidataCounts[ id ] || 0 ) ) {
			exportable = true;
			break;
		}
	}
	if ( exportable ) {
		exportCounts[ propertyId ] = wikidataCounts;
		// Double-check there's really something to do before highlighting: run the
		// dialog's own pass on a copy. A split always counts; otherwise at least one
		// row must not already be on Wikidata.
		const simulated: Statement[] = markExistingStatements(
			localStatements.map( ( s: Statement ): Statement => JSON.parse( JSON.stringify( s ) ) )
		);
		const hasActionable: boolean = splits.length > 0 ||
			simulated.some( ( s: Statement ): boolean => !s.meta?.alreadyExists );
		if ( hasActionable ) {
			return true;
		}
		delete exportCounts[ propertyId ];
		delete enrichPlan[ propertyId ];
		delete splitCandidates[ propertyId ];
	}

	return false;
}

export function markExistingStatements( statements: Statement[] ): Statement[] {
	// Drop a broad value when a more precise part of it is already on Wikidata.
	statements = statements.filter( ( s: Statement ): boolean => {
		const propertyId: PropertyId | undefined = s.mainsnak?.property;
		const existing: string[] = ( propertyId && alreadyExistingItems[ propertyId ] ) || [];
		return !( s.meta?.partIds || [] ).some( ( part: string ): boolean => existing.includes( part ) );
	} );

	// Pass 1: tag mentions that fill a dateless statement, matching each to a plan
	// slot by date value (duplicates take distinct slots).
	const enrichedIds: Set<string> = new Set();
	const enrichedCount: { [ key: string ]: { [ key: string ]: number } } = {};
	const usedSlots: { [ key: string ]: { [ key: string ]: boolean[] } } = {};
	for ( const statement of statements ) {
		const propertyId: PropertyId | undefined = statement.mainsnak?.property;
		const itemId: string | undefined = ( statement.mainsnak?.datavalue?.value as ItemValue | undefined )?.id;
		const assignments = ( propertyId && itemId ) ? enrichPlan[ propertyId ]?.[ itemId ] : undefined;
		if ( !propertyId || !itemId || !assignments ) {
			continue;
		}
		usedSlots[ propertyId ] = usedSlots[ propertyId ] || {};
		usedSlots[ propertyId ][ itemId ] = usedSlots[ propertyId ][ itemId ] || assignments.map( (): boolean => false );
		const snaks = statement.qualifiers?.[ assignments[ 0 ].dateProp ];
		const dateKey: string | undefined = snaks?.length && snaks[ 0 ].datavalue ?
			JSON.stringify( snaks[ 0 ].datavalue.value ) :
			undefined;
		const slot: number = dateKey === undefined ? -1 : assignments.findIndex(
			( a: { dateValue: string }, i: number ): boolean => !usedSlots[ propertyId ][ itemId ][ i ] && a.dateValue === dateKey
		);
		if ( slot !== -1 ) {
			usedSlots[ propertyId ][ itemId ][ slot ] = true;
			enrichedIds.add( statement.id );
			enrichedCount[ propertyId ] = enrichedCount[ propertyId ] || {};
			enrichedCount[ propertyId ][ itemId ] = ( enrichedCount[ propertyId ][ itemId ] || 0 ) + 1;
			statement.meta = statement.meta || {};
			statement.meta.enrich = {
					guid: assignments[ slot ].guid,
					dateProp: assignments[ slot ].dateProp,
					snakHash: assignments[ slot ].snakHash,
					precise: assignments[ slot ].precise,
					skipImportRef: assignments[ slot ].skipImportRef,
					targetClaim: assignments[ slot ].targetClaim
				};
		}
	}

	// Pass 2: count the remaining (non-enriched) mentions per value.
	const infoboxCounts: { [ key: string ]: { [ key: string ]: number } } = {};
	for ( const statement of statements ) {
		if ( enrichedIds.has( statement.id ) ) {
			continue;
		}
		const propertyId: PropertyId | undefined = statement.mainsnak?.property;
		const itemId: string | undefined = ( statement.mainsnak?.datavalue?.value as ItemValue | undefined )?.id;
		if ( propertyId && itemId && exportCounts[ propertyId ] ) {
			infoboxCounts[ propertyId ] = infoboxCounts[ propertyId ] || {};
			infoboxCounts[ propertyId ][ itemId ] = ( infoboxCounts[ propertyId ][ itemId ] || 0 ) + 1;
		}
	}

	// Pass 3: build the result in original order, hiding/marking already-present
	// copies (after subtracting the ones enrichment already consumed).
	const result: Statement[] = [];
	const seen: { [ key: string ]: { [ key: string ]: number } } = {};
	for ( const statement of statements ) {
		if ( enrichedIds.has( statement.id ) ) {
			result.push( statement );
			continue;
		}
		const propertyId: PropertyId | undefined = statement.mainsnak?.property;
		const itemId: string | undefined = ( statement.mainsnak?.datavalue?.value as ItemValue | undefined )?.id;
		if ( propertyId && itemId && exportCounts[ propertyId ] ) {
			const used: number = enrichedCount[ propertyId ]?.[ itemId ] || 0;
			const wikidataCount: number = Math.max( 0, ( exportCounts[ propertyId ][ itemId ] || 0 ) - used );
			// Already fully present on Wikidata -> hide it.
			if ( wikidataCount > 0 && infoboxCounts[ propertyId ][ itemId ] <= wikidataCount ) {
				continue;
			}
			// Mark the first N remaining copies (already on Wikidata) as existing.
			if ( wikidataCount > 0 ) {
				seen[ propertyId ] = seen[ propertyId ] || {};
				seen[ propertyId ][ itemId ] = seen[ propertyId ][ itemId ] || 0;
				if ( seen[ propertyId ][ itemId ] < wikidataCount ) {
					seen[ propertyId ][ itemId ]++;
					statement.meta = statement.meta || {};
					statement.meta.alreadyExists = true;
				}
			}
		}
		result.push( statement );
	}

	// If hiding left nothing, show the values greyed out instead — otherwise the
	// caller throws a misleading "could not determine value" error.
	if ( !result.length && statements.length ) {
		return statements.map( ( statement: Statement ): Statement => {
			statement.meta = statement.meta || {};
			statement.meta.alreadyExists = true;
			return statement;
		} );
	}

	return result;
}

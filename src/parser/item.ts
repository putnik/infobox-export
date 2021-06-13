import { Context, FixedValue, KeyValue, Title } from '../types/main';
import { Reference, Snak, SnaksObject, Statement } from '../types/wikidata/main';
import { getConfig } from '../config';
import { getReferences } from './utils';
import { convertSnakToStatement, generateItemSnak, getWikidataIds } from '../wikidata';
import { lowercaseFirst, unique, uppercaseFirst } from '../utils';
import { contentLanguage } from '../languages';
import { ItemValue } from '../types/wikidata/values';
import { prepareTime } from './time';
import { ApiResponse } from '../types/api';
import { apiRequest } from '../api';
import { PropertyId } from '../types/wikidata/types';

export const alreadyExistingItems: KeyValue = {};

const START_PROPERTY: PropertyId = 'P580';
const END_PROPERTY: PropertyId = 'P582';
const MOMENT_PROPERTY: PropertyId = 'P585';

function getTimeSnaks( text: string ): SnaksObject {
	const snaks: SnaksObject = {};

	const fakeContext: Context = {
		propertyId: START_PROPERTY,
		text: text,
		$field: $( text ),
		$wrapper: $( text )
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
		snakStart.property = MOMENT_PROPERTY;
		snaks[ MOMENT_PROPERTY ] = [ snakStart ];
	}

	return snaks;
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
					const timeMatch: RegExpMatchArray | null = $links[ j ].nextSibling.textContent.match( /^\s*\((.+)\)\s*$/ );
					if ( timeMatch ) {
						timeString = timeMatch[ 1 ];
					}
				}

				const value: Title = {
					label: uppercaseFirst( extractedUrl ),
					language: contentLanguage,
					project: getConfig( 'project' ),
					qualifiers: getTimeSnaks( timeString )
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
					qualifiers: getTimeSnaks( timeString )
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

	return getWikidataIds( context.propertyId, titles, references );
}

export async function canExportItem( propertyId: PropertyId, wikidataStatements: Statement[], $field: JQuery ): Promise<boolean> {
	const context: Context = {
		propertyId: propertyId,
		text: $field.text().trim(),
		$field: $field.clone(),
		$wrapper: $field.clone()
	};
	const localStatements: Statement[] = await parseItem( context );
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
			const propertyId: PropertyId = wikidataStatements[ 0 ].mainsnak.property;
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
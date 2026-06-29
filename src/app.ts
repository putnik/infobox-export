import type { ApiResponse, SparqlResponse } from './types/api';
import type { Context, Property } from './types/main';
import type { Statement } from './types/wikidata/main';
import type { DataType, ItemId, PropertyId } from './types/wikidata/types';
import { sparqlRequest, wdApiRequest } from './api';
import { convertSnakToStatement, createNovalueSnak, createSomevalueSnak, getItemPropertyValues, setBaseRevId } from './wikidata';
import { getReferences } from './parser/utils';
import {
	canExportValue,
	prepareCommonsMedia,
	prepareExternalId,
	prepareMonolingualText
} from './parser';
import { getI18n } from './i18n';
import { applyUserConfig, getConfig, getOrLoadProperty, loadConfig, loadProperties, saveConfig, setConfig } from './config';
import { showDialog } from './ui';
import { loadMonths } from './months';
import { prepareQuantity } from './parser/quantity';
import { prepareTime } from './parser/time';
import { markExistingStatements, parseItem, splitCandidates } from './parser/item';
import { prepareUrl } from './parser/url';
import { prepareString } from './parser/string';
import { prepareGlobeCoordinate } from './parser/coordinates';
import { guessPropertyIdByLabel, preloadAvailableProperties } from './property';

const $ = require( 'jquery' );
const mw = require( 'mw' );

const propertyIds: Set<PropertyId> = new Set();
// Temperature and pressure for qualifiers
propertyIds.add( 'P2076' );
propertyIds.add( 'P2077' );

// Field values meaning "unknown value", any datatype. Includes a lone dash.
const UNKNOWN_VALUE_MARKERS: string[] = [
	'?',
	'неизвестно',
	'unknown',
	'bilinmir',
	'naməlum',
	'qeyri-müəyyən',
	'-',
	'–',
	'—',
	'−'
];

// Field values meaning "no value", any datatype.
const NO_VALUE_MARKERS: string[] = [
	'нет'
];

// A numeric child (P40) field exports as number of children (P1971). Only offer it
// while that exact count isn't on Wikidata yet, or it would re-highlight every load.
// Returns null when this isn't a P40 numeric field.
function childCountExportable( propertyId: string, $field: JQuery, claims: { [ key: string ]: Statement[] } ): boolean | null {
	if ( propertyId !== 'P40' || !/^\d+$/.test( $field.text().trim() ) ) {
		return null;
	}
	const amount: string = '+' + $field.text().trim();
	const exists: boolean = ( claims[ 'P1971' ] || [] ).some( ( statement: Statement ): boolean =>
		( statement.mainsnak?.datavalue?.value as { amount?: string } | undefined )?.amount === amount
	);
	return !exists;
}

/**
 * Parsing values from parameters before displaying a dialog
 */
async function parseField( $field: JQuery ): Promise<Statement[]> {
	const propertyId = $field.data( 'wikidata-property-id' );
	const property: Property | undefined = await getOrLoadProperty( propertyId );
	if ( typeof property === 'undefined' ) {
		mw.notify( getI18n( 'no-property-data' ).replace( '$1', propertyId ), {
			type: 'error',
			tag: 'wikidataInfoboxExport-error'
		} );
		return [];
	}

	const context: Context = {
		propertyId: propertyId,
		text: '',
		$field: $field.clone(),
		$wrapper: $field
	};

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

	context.text = context.$field.text().trim();

	const $row: JQuery = $field.closest( 'tr' );
	if ( $row.length === 1 && $row.find( '[data-wikidata-property-id]' ).length === 1 ) {
		context.$wrapper = $row.clone();
	}

	// Field-wide "no value" marker -> novalue snak.
	if ( NO_VALUE_MARKERS.includes( context.text.toLowerCase() ) ) {
		return [ convertSnakToStatement( createNovalueSnak( propertyId ), getReferences( context.$wrapper ) ) ];
	}

	// Field-wide "unknown" marker -> somevalue snak, for any datatype.
	if ( UNKNOWN_VALUE_MARKERS.includes( context.text.toLowerCase() ) ) {
		return [ convertSnakToStatement( createSomevalueSnak( propertyId ), getReferences( context.$wrapper ) ) ];
	}

	switch ( property.datatype ) {
		case 'commonsMedia':
			return prepareCommonsMedia( context );

		case 'external-id':
			return prepareExternalId( context );

		case 'globe-coordinate':
			return prepareGlobeCoordinate( context );

		case 'monolingualtext':
			return prepareMonolingualText( context );

		case 'quantity':
			return prepareQuantity( context );

		case 'string':
			return prepareString( context );

		case 'time':
			return prepareTime( context );

		case 'wikibase-item':
			return parseItem( context );

		case 'url':
			return prepareUrl( context );
	}

	mw.notify( getI18n( 'unknown-datatype' ).replace( '$1', property.datatype ), {
		type: 'error',
		tag: 'wikidataInfoboxExport-error'
	} );

	return [];
}

/**
 * Double-click event on the infobox field
 */
async function clickEvent(): Promise<void> {
	const $field = $( this );
	if ( $field.hasClass( 'no-wikidata-loader' ) ||
		$field.parents( '.no-wikidata[data-wikidata-property-id]' ).length
	) {
		return;
	}
	$field.addClass( 'infobox-export-loader' );
	const statements: Statement[] = await parseField( $field );

	const subFields: JQuery[] = $field.find( '.no-wikidata[data-wikidata-property-id]' ).toArray();
	for ( const i in subFields ) {
		const $subField: JQuery = $( subFields[ i ] );
		const subStatements: Statement[] = await parseField( $subField );
		statements.push( ...subStatements );
	}

	const propertyId: string | undefined = $field.attr( 'data-wikidata-property-id' );
	const markedStatements: Statement[] = markExistingStatements( statements );
	const splitOffered: boolean = propertyId === 'P166' && ( splitCandidates.P166?.length || 0 ) > 0;
	const hasActionable: boolean = markedStatements.some( ( s: Statement ): boolean => !s.meta?.alreadyExists );

	// Nothing to add or split — it was highlighted on a stale guess. Clear it and
	// tell the user instead of opening an empty dialog.
	if ( !splitOffered && markedStatements.length && !hasActionable ) {
		$field
			.removeClass( 'no-wikidata partial-wikidata infobox-export-loader' )
			.off( 'dblclick' );
		mw.notify( getI18n( 'already-on-wikidata' ), { tag: 'wikidataInfoboxExport' } );
		return;
	}

	await showDialog( markedStatements, propertyId );
	$field.removeClass( 'infobox-export-loader' );
}

async function loadDefaultReference(): Promise<void> {
	if ( getConfig( 'references.P143' ) !== undefined ) {
		return;
	}

	const sparql: string = `SELECT ?wiki WHERE { ?wiki wdt:P31/wdt:P279* wd:Q33120876 . ?wiki wdt:P856 ?site . FILTER REGEX(STR(?site), "https://${ location.host }/") }`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( !data?.results?.bindings?.length ) {
		return;
	}

	// Add current wiki project as "imported from Wikimedia project"
	const projectId: ItemId = data.results.bindings[ 0 ].wiki.value.replace( 'http://www.wikidata.org/entity/', '' ) as ItemId;
	setConfig( 'references.P143', [ {
		property: 'P143',
		snaktype: 'value',
		datavalue: {
			type: 'wikibase-entityid',
			value: { id: projectId }
		}
	} ] );

	saveConfig();
}

/**
 * Initializing the gadget
 */
export async function init(): Promise<any> {
	const itemId: ItemId | null = mw.config.get( 'wgWikibaseItemId' );
	if ( itemId === null ||
		mw.config.get( 'wgAction' ) !== 'view' ||
		mw.util.getParamValue( 'veaction' ) !== null ||
		// @ts-ignore
		( window.ve && window.ve.init ) ||
		mw.config.get( 'wgNamespaceNumber' )
	) {
		return;
	}

	const infoboxSelectors: string[] = [
		'.infobox',
		'.infocaseta', // rowiki
		'.sinottico', // itwiki
		'table.toccolours',
		'table.vcard',
		'table.vevent',
		'.mw-parser-output > table:first-child'
	];
	const $infobox: JQuery = $( infoboxSelectors.join( ',' ) );
	if ( !$infobox.length ) {
		return;
	}
	$infobox.addClass( 'infobox-export' );

	const preloaderCss = require( './assets/preloader.css' ).toString();
	mw.util.addCSS( preloaderCss );

	let $mainHeader: JQuery = $infobox.find( 'caption, th[colspan], .entete' );
	if ( $mainHeader.length === 0 ) {
		$mainHeader = $infobox.find( 'td[colspan]' );
	}
	$mainHeader = $mainHeader.eq( 0 );
	$mainHeader.addClass( 'infobox-export-preloader' );
	const mainHeaderRowBackground: string | undefined = $mainHeader.parent( 'tr' ).css( 'background-color' );
	if ( $mainHeader.css( 'background-color' ) === 'rgba(0, 0, 0, 0)' &&
		( mainHeaderRowBackground === undefined || mainHeaderRowBackground === 'rgba(0, 0, 0, 0)' )
	) {
		$mainHeader.addClass( 'infobox-export-preloader-dark' );
	}

	// Item data request
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		props: [ 'info', 'claims' ],
		ids: mw.config.get( 'wgWikibaseItemId' )
	} );
	if ( !data.success ) {
		$mainHeader.removeClass( 'infobox-export-preloader' );
		return;
	}
	let claims: { [ key: string ]: Statement[] };
	for ( const i in data.entities ) {
		// @ts-ignore
		if ( i == -1 ) {
			$mainHeader.removeClass( 'infobox-export-preloader' );
			return;
		}

		claims = data.entities[ i ].claims;
		setBaseRevId( data.entities[ i ].lastrevid );
		break;
	}
	if ( !claims ) {
		$mainHeader.removeClass( 'infobox-export-preloader' );
		return;
	}

	loadConfig();
	applyUserConfig();
	// Slow SPARQL, only needed at export time — run it in the background.
	void loadDefaultReference();
	await loadMonths();

	let $fields = $( '.infobox-export:not(.vertical-navbox):not([data-from]) .no-wikidata' );
	if ( !$fields.length ) {
		if ( $( '.infobox-export [data-wikidata-property-id]' ).length ) {
			$mainHeader.removeClass( 'infobox-export-preloader' );
			return;
		}

		$( '.infobox-export' ).find( 'tr > th + td, tr > td + td' ).each( function (): void {
			const $label: JQuery = $( this ).prev();
			$label.addClass( 'infobox-export-label' );
		} );
		$fields = $( '.infobox-export:not(.vertical-navbox):not([data-from]) .infobox-export-label + td' );
		const typeIds: ItemId[] = getItemPropertyValues( claims, 'P31' );
		await preloadAvailableProperties( typeIds );
	}
	try {
		await Promise.all( $fields.map( async function (): Promise<void> {
		const $field: JQuery = $( this );
		const propertyId: PropertyId | undefined = $field.attr( 'data-wikidata-property-id' ) as ( PropertyId | undefined );
		if ( typeof propertyId !== 'undefined' ) {
			$field
				.removeClass( 'no-wikidata' )
				.off( 'dblclick' );

			propertyIds.add( propertyId );
			const childCount: boolean | null = childCountExportable( propertyId, $field, claims );
			const canExport: boolean = childCount !== null ?
				childCount :
				await canExportValue( propertyId, $field, claims[ propertyId ] );
			if ( canExport ) {
				$field.addClass( 'no-wikidata' );
				if ( claims[ propertyId ] && claims[ propertyId ].length ) {
					$field.addClass( 'partial-wikidata' );
				}
				$field.on( 'dblclick', clickEvent );
			}

			const $fieldQualifiers = $field.closest( 'tr' ).find( '[data-wikidata-qualifier-id]' );
			$fieldQualifiers.each( function (): void {
				propertyIds.add( $( this ).data( 'wikidata-qualifier-id' ) );
			} );

			return;
		}

		// Skip empty fields
		if ( /^[\s\u200B-\u200D\uFEFF]*$/.test( $field.text() ) ) {
			return;
		}

		const $label: JQuery = $field.parent().children( 'th, .infobox-export-label' ).first();
		const guessedPropertyIds: PropertyId[] = await guessPropertyIdByLabel( $label, itemId, claims );
		let guessedProperties: Property[] = ( await Promise.all( guessedPropertyIds.map(
			async ( propertyId: PropertyId ): Promise<Property> => await getOrLoadProperty( propertyId )
		) ) ).filter( ( property: Property | undefined ) => property );

		// If at least one of these properties with same name and datatype already filled,
		// then we think that it is the correct one.
		const alreadyFilledDataTypes: DataType[] = [];
		for ( const guessedProperty of guessedProperties ) {
			if ( claims[ guessedProperty.id ] && claims[ guessedProperty.id ].length ) {
				alreadyFilledDataTypes.push( guessedProperty.datatype );
			}
		}

		guessedProperties = guessedProperties.filter(
			( property: Property ) => !alreadyFilledDataTypes.includes( property.datatype )
		);
		if ( !guessedProperties.length ) {
			return;
		}

		// A numeric P40 maps to P1971; if the label also guessed P1971 we'd attach
		// it twice, so dedupe on the effective property.
		const attachedProperties: Set<string> = new Set();
		for ( const guessedProperty of guessedProperties ) {
			if ( alreadyFilledDataTypes.includes( guessedProperty.datatype ) ) {
				continue;
			}
			const childCount: boolean | null = childCountExportable( guessedProperty.id, $field, claims );
			const effectiveProperty: string = childCount !== null ? 'P1971' : guessedProperty.id;
			if ( attachedProperties.has( effectiveProperty ) ) {
				continue;
			}
			const canExport: boolean = childCount !== null ?
				childCount :
				await canExportValue( guessedProperty.id, $field, claims[ guessedProperty.id ] );
			if ( canExport ) {
				attachedProperties.add( effectiveProperty );
				propertyIds.add( guessedProperty.id );

				let $wrapper: JQuery = $field;
				if ( $wrapper.attr( 'data-wikidata-property-id' ) ) {
					$wrapper = $( '<span>' );
				}
				$wrapper
					.on( 'dblclick', clickEvent )
					.attr( 'data-wikidata-property-id', guessedProperty.id )
					.addClass( 'no-wikidata' );

				if ( claims[ guessedProperty.id ] && claims[ guessedProperty.id ].length ) {
					$wrapper.addClass( 'partial-wikidata' );
				}

				if ( $wrapper.prop( 'tagName' ) === 'SPAN' ) {
					$field.contents().wrapAll( $wrapper );
				}
			}
		}
	} ) );
	} catch ( error ) {
		// One bad field shouldn't stop the gadget loading.
	}
	const mainCss = require( './assets/main.css' ).toString();
	mw.util.addCSS( mainCss );

	// Warm the property cache in the background; the dialog loads anything missing
	// on demand, so don't hold the spinner for this.
	void loadProperties( propertyIds );

	$mainHeader.removeClass( 'infobox-export-preloader' );
}

import { sparqlRequest, wdApiRequest } from './api';
import { setBaseRevId } from './wikidata';
import {
	canExportValue,
	parseItems,
	prepareCommonsMedia,
	prepareExternalId,
	prepareMonolingualText,
	prepareString,
	prepareTime,
	prepareUrl
} from './parser';
import { getI18n } from './i18n';
import { getConfig, loadConfig, saveConfig, setConfig } from './config';
import { unique, uppercaseFirst } from './utils';
import { showDialog } from './ui';
import { loadMonths } from './months';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import { KeyValue } from './types/main';
import { ApiResponse, SparqlResponse } from './types/api';
import { prepareQuantity } from './parser/quantity';
import { Statement } from './types/wikidata/main';
import { DataType } from './types/wikidata/types';

const $ = require( 'jquery' );
const mw = require( 'mw' );
const ooui = require( 'ooui' );

const propertyIds = [ 'P2076', 'P2077' ]; // Temperature and pressure for qualifiers
let windowManager;

/**
 * Preload information on all properties
 */
async function realLoadProperties( propertyIds: string[] ): Promise<void> {
	if ( !propertyIds || !propertyIds.length ) {
		return;
	}

	const units: string[] = [];
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		languages: allLanguages,
		props: [ 'labels', 'datatype', 'claims' ],
		ids: propertyIds
	} );
	if ( !data.success ) {
		return;
	}

	for ( const propertyId in data.entities ) {
		if ( !data.entities.hasOwnProperty( propertyId ) ) {
			continue;
		}
		const entity: KeyValue = data.entities[ propertyId ];
		const label: string = entity.labels[ contentLanguage ] ?
			entity.labels[ contentLanguage ].value :
			entity.labels.en.value;
		setConfig( `properties.${propertyId}`, {
			datatype: entity.datatype,
			label: uppercaseFirst( label ),
			constraints: { qualifier: [] },
			units: []
		} );
		if ( propertyId === 'P1128' || propertyId === 'P2196' ) {
			setConfig( `properties.${propertyId}.constraints.integer`, 1 );
			if ( entity.claims ) {
				// Property restrictions
				if ( entity.claims.P2302 ) {
					for ( const i in entity.claims.P2302 ) {
						const type = ( ( ( ( entity.claims.P2302[ i ] || {} ).mainsnak || {} ).datavalue || {} ).value || {} ).id;
						let qualifiers;
						switch ( type ) {
							case 'Q19474404':
							case 'Q21502410':
								setConfig( `properties.${propertyId}.constraints.unique`, 1 );
								break;
							case 'Q21510856': // Required
								qualifiers = ( ( ( entity.claims.P2302[ i ] || {} ).qualifiers || {} ).P2306 || [] );
								for ( let idx = 0; idx < qualifiers.length; idx++ ) {
									const qualifierId = ( ( ( qualifiers[ idx ] || {} ).datavalue || {} ).value || {} ).id;
									if ( qualifierId ) {
										const qualifiers: string[] = getConfig( `properties.${propertyId}.constraints.qualifier` );
										qualifiers.push( qualifierId.toString() );
										setConfig( `properties.${propertyId}.constraints.qualifier`, qualifiers );
									}
								}
								break;
							case 'Q21514353': // Units
								qualifiers = ( ( ( entity.claims.P2302[ i ] || {} ).qualifiers || {} ).P2305 || [] );
								for ( let idx = 0; idx < qualifiers.length; idx++ ) {
									const unitId = ( ( ( qualifiers[ idx ] || {} ).datavalue || {} ).value || {} ).id;
									if ( unitId ) {
										const configUnits = getConfig( `properties.${propertyId}.units` );
										configUnits.push( unitId );
										setConfig( `properties.${propertyId}.units`, configUnits );
										units.push( unitId );
									}
								}
								break;
						}
					}
				}
			}
		}

		for ( let idx = 0; idx < unique( units ).length; idx += 50 ) {
			const unitData: ApiResponse = await wdApiRequest( {
				action: 'wbgetentities',
				languages: allLanguages,
				props: [ 'labels', 'descriptions', 'aliases', 'claims' ],
				ids: unique( units ).slice( idx, idx + 50 )
			} );
			if ( !unitData.success ) {
				return;
			}

			for ( const unitId in unitData.entities ) {
				const unit = unitData.entities[ unitId ];
				const unitSearch = getConfig( `units.${unitId}.search` ) || [];
				if ( !getConfig( `units.${unitId}` ) ) {
					setConfig( `units.${unitId}`, {} );
				}

				// Label
				if ( unit.labels ) {
					setConfig( `units.${unitId}.label`,
						unit.labels[ userLanguage ] ||
						unit.labels.en ||
						unit.labels[ Object.keys( unit.labels )[ 0 ] ]
					);

					if ( unit.labels[ userLanguage ] ) {
						unitSearch.push( unit.labels[ userLanguage ].value.replace( /[-[\]/{}()*+?.\\^$|]/g, '\\$&' ) );
					}
				}

				// Description
				if ( unit.descriptions ) {
					setConfig( `units.${unitId}.description`,
						unit.descriptions[ userLanguage ] ||
						unit.descriptions.en ||
						unit.descriptions[ Object.keys( unit.labels )[ 0 ] ]
					);
				}

				// Aliases
				if ( unit.aliases && unit.aliases[ userLanguage ] ) {
					for ( const i in unit.aliases[ userLanguage ] ) {
						unitSearch.push( unit.aliases[ userLanguage ][ i ].value.replace( /[-[\]/{}()*+?.\\^$|]/g, '\\$&' ) );
					}
				}

				// Units (P5061)
				if ( unit.claims && unit.claims.P5061 ) {
					for ( const i in unit.claims.P5061 ) {
						const claim = unit.claims.P5061[ i ];
						if ( claim.mainsnak &&
							claim.mainsnak.datavalue &&
							claim.mainsnak.datavalue.value
						) {
							unitSearch.push( claim.mainsnak.datavalue.value.text.replace( /[-[\]/{}()*+?.\\^$|]/g, '\\$&' ) );
						}
					}
				}
				setConfig( `units.${unitId}.search`, unique( unitSearch ) );

				saveConfig();
			}
		}
	}
}

/**
 * Wrapper for property preloading that excludes already loaded properties
 */
async function loadProperties( propertyIds: string[] ): Promise<void> {
	if ( !propertyIds || !propertyIds.length ) {
		return;
	}

	const realPropertyIds = [];
	for ( const i in propertyIds ) {
		const propertyId = propertyIds[ i ];
		if ( propertyId && getConfig( `properties.${propertyId}` ) === undefined ) {
			realPropertyIds.push( propertyId );
		}
	}

	if ( realPropertyIds.length ) {
		await realLoadProperties( realPropertyIds );
	}
}

/**
 * Parsing values from parameters before displaying a dialog
 */
async function parseField( $field: JQuery, propertyId: string ): Promise<Statement[]> {
	const datatype: DataType = getConfig( `properties.${propertyId}.datatype` );

	const $content: JQuery = $field.clone();
	$content.find( 'sup.reference' ).remove();
	$content.find( '.printonly' ).remove();
	$content.find( '[style*="display:none"]' ).remove();

	// let $wrapper: JQuery = $content;
	// const $row = $field.closest( 'tr' );
	// if ( $row.length === 1 && $row.find( '[data-wikidata-property-id]' ).length === 1 ) {
	// $wrapper = $row.clone();
	// }

	switch ( datatype ) {
		case 'commonsMedia':
			return prepareCommonsMedia( $content, propertyId );

		case 'external-id':
			return prepareExternalId( $content, propertyId );

		case 'monolingualtext':
			return prepareMonolingualText( $content, propertyId );

		case 'quantity':
			return prepareQuantity( $content, propertyId );

		case 'string':
			return prepareString( $content, propertyId );

		case 'time':
			return prepareTime( $content, propertyId );

		case 'wikibase-item':
			return parseItems( $content, propertyId );

		case 'url':
			return prepareUrl( $content, propertyId );
	}

	mw.notify( getI18n( 'unknown-datatype' ).replace( '$1', datatype ), {
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
	const propertyId = $field.attr( 'data-wikidata-property-id' );
	const statements: Statement[] = await parseField( $field, propertyId );
	await showDialog( $field, statements );
}

async function loadDefaultReference(): Promise<void> {
	const sparql = `SELECT ?wiki WHERE { ?wiki wdt:P31/wdt:P279* wd:Q33120876 . ?wiki wdt:P856 ?site . FILTER REGEX(STR(?site), "https://${location.host}/") }`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( data.results.bindings.length === 0 ) {
		return;
	}

	// Add current wiki project as "imported from Wikimedia project"
	const projectId = data.results.bindings[ 0 ].wiki.value.replace( 'http://www.wikidata.org/entity/', '' );
	setConfig( 'references.P143', [ {
		property: 'P143',
		snaktype: 'value',
		datavalue: {
			type: 'wikibase-entityid',
			value: { id: projectId }
		}
	} ] );

	// Add a link to the current version of the page as "Wikimedia import URL"
	setConfig( 'references.P4656', [ {
		property: 'P4656',
		datatype: 'url',
		snaktype: 'value',
		datavalue: {
			type: 'string',
			value: 'https://' + location.host + '/?oldid=' + mw.config.get( 'wgRevisionId' )
		}
	} ] );

	saveConfig();
}

/**
 * Initializing the gadget
 */
export async function init(): Promise<any> {
	if ( mw.config.get( 'wgWikibaseItemId' ) === null ||
		mw.config.get( 'wgAction' ) !== 'view' ||
		mw.util.getParamValue( 'veaction' ) !== null ||
		// @ts-ignore
		( window.ve && window.ve.init ) ||
		mw.config.get( 'wgNamespaceNumber' )
	) {
		return;
	}

	loadConfig();
	await loadDefaultReference();

	// Dialogs initialization
	windowManager = new ooui.WindowManager();
	$( 'body' ).append( windowManager.$element );

	await loadMonths();

	// Item data request
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		props: [ 'info', 'claims' ],
		ids: mw.config.get( 'wgWikibaseItemId' )
	} );
	if ( !data.success ) {
		return;
	}
	let claims: { [ key: string ]: Statement[] };
	for ( const i in data.entities ) {
		// @ts-ignore
		if ( i == -1 ) {
			return;
		}

		claims = data.entities[ i ].claims;
		setBaseRevId( data.entities[ i ].lastrevid );
		break;
	}
	if ( !claims ) {
		return;
	}

	const $fields = $( '.infobox .no-wikidata' );
	$fields.each( async function () {
		const $field: JQuery = $( this );
		const propertyId: string = $field.attr( 'data-wikidata-property-id' );

		$field
			.removeClass( 'no-wikidata' )
			.off( 'dblclick' );
		propertyIds.push( propertyId );
		const canExport: boolean = await canExportValue( propertyId, $field, claims[ propertyId ] );
		if ( canExport ) {
			$field.addClass( 'no-wikidata' );
			// if ( hasClaims === true ) {
			// $field.addClass( 'partial-wikidata' );
			// }
			$field.on( 'dblclick', clickEvent );
		}

		const $fieldQualifiers = $field.closest( 'tr' ).find( '[data-wikidata-qualifier-id]' );
		$fieldQualifiers.each( function () {
			propertyIds.push( $( this ).data( 'wikidata-qualifier-id' ) );
		} );
	} );
	const css = require( './assets/init.css' ).toString();
	mw.util.addCSS( css );

	// TODO: Do not load properties until the window is opened for the first time
	await loadProperties( propertyIds );
}

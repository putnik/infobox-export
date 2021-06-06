import { sparqlRequest, wdApiRequest } from './api';
import { setBaseRevId } from './wikidata';
import {
	alreadyExistingItems,
	canExportValue,
	parseItems,
	prepareCommonsMedia,
	prepareExternalId,
	prepareMonolingualText,
	prepareString,
	prepareUrl
} from './parser';
import { getI18n } from './i18n';
import { getConfig, loadConfig, loadProperties, saveConfig, setConfig } from './config';
import { showDialog } from './ui';
import { loadMonths } from './months';
import { ApiResponse, SparqlResponse } from './types/api';
import { prepareQuantity } from './parser/quantity';
import { Statement } from './types/wikidata/main';
import { DataType } from './types/wikidata/types';
import { prepareTime } from './parser/time';

const $ = require( 'jquery' );
const mw = require( 'mw' );
const ooui = require( 'ooui' );

const propertyIds = [ 'P2076', 'P2077' ]; // Temperature and pressure for qualifiers
let windowManager;

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
	if ( $field.parents( '.no-wikidata[data-wikidata-property-id]' ).length ) {
		return;
	}

	const propertyId = $field.data( 'wikidata-property-id' );
	const statements: Statement[] = await parseField( $field, propertyId );

	const subFields: JQuery[] = $field.find( '.no-wikidata[data-wikidata-property-id]' ).toArray();
	for ( const i in subFields ) {
		const $subField: JQuery = $( subFields[ i ] );
		const subPropertyId: string = $subField.data( 'wikidata-property-id' );
		const subStatements: Statement[] = await parseField( $field, subPropertyId );
		statements.push( ...subStatements );
	}

	await showDialog( statements );
}

async function exportAll(): Promise<void> {
	const fields: JQuery[] = mw.util.$content.find( '.infobox .no-wikidata[data-wikidata-property-id]' ).toArray();
	const allStatements: Statement[] = [];

	for ( const i in fields ) {
		const $field: JQuery = $( fields[ i ] );
		const propertyId: string = $field.data( 'wikidata-property-id' );
		const statements: Statement[] = await parseField( $field, propertyId );
		allStatements.push( ...statements );
	}

	await showDialog( allStatements );
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
			if ( alreadyExistingItems[ propertyId ] && alreadyExistingItems[ propertyId ].length ) {
				$field.addClass( 'partial-wikidata' );
			}
			$field.on( 'dblclick', clickEvent );
		}

		const $fieldQualifiers = $field.closest( 'tr' ).find( '[data-wikidata-qualifier-id]' );
		$fieldQualifiers.each( function () {
			propertyIds.push( $( this ).data( 'wikidata-qualifier-id' ) );
		} );
	} );
	const css = require( './assets/init.css' ).toString();
	mw.util.addCSS( css );

	const $exportAllImage: JQuery = $( '<img>' )
		.attr( 'title', getI18n( 'export-all' ) )
		.width( '14' )
		.height( '14' )
		.attr( 'src', '//upload.wikimedia.org/wikipedia/commons/6/6b/OOjs_UI_icon_upload.svg' );
	const $exportAll: JQuery = $( '<div>' )
		.addClass( 'wikidata-infobox-export-all' )
		.append( $exportAllImage )
		.on( 'click', exportAll );
	const $container: JQuery = $( '.infobox' ).find( 'caption:visible, th:visible, td:visible' ).first();
	$container.prepend( $exportAll );

	// TODO: Do not load properties until the window is opened for the first time
	await loadProperties( propertyIds );
}

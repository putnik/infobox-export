import { UrlValue } from './types/wikidata/values';

const $ = require( 'jquery' );
const mw = require( 'mw' );

// @ts-ignore
import { inheritClass } from 'oojs';
import {
	CheckboxInputWidget,
	FieldLayout,
	FieldsetLayout,
	MessageDialog,
	PanelLayout,
	Process,
	ProcessDialog,
	WindowManager
// @ts-ignore
} from 'ooui';

import { getI18n } from './i18n';
import { getConfig } from './config';
import { alreadyExistingItems } from './parser';
import { convertStatementsToClaimsObject, createClaims } from './wikidata';
import { formatStatement } from './formatter';
import { ClaimsObject, Reference, Statement } from './types/wikidata/main';

let _windowManager: any;

/**
 * Format sources for display
 */
function formatDomains( references: Reference[] ): JQuery {
	const $result: JQuery = $( '<sup>' );
	for ( let i = 0; i < references.length; i++ ) {
		const p854 = references[ i ].snaks.P854;
		if ( p854 ) {
			// @ts-ignore
			const value: UrlValue = p854[ 0 ].datavalue.value;
			let domain: string = value.replace( 'http://', '' ).replace( 'https://', '' ).replace( 'www.', '' );
			if ( domain.indexOf( '/' ) > 0 ) {
				domain = domain.substr( 0, domain.indexOf( '/' ) );
			}
			$result.append( $( '<a>' ).attr( 'href', p854[ 0 ].datavalue.value ).text( '[' + domain + ']' ) );
		}
	}
	return $result;
}

/**
 * Error display
 */
export function errorDialog( title: string, message: string ): void {
	const errorDialog = new MessageDialog();
	_windowManager.addWindows( [ errorDialog ] );
	_windowManager.openWindow( errorDialog, {
		title: title,
		message: message
	} );
}

async function getPropertyFieldset( statements: Statement[] ): Promise<any> {
	const fieldset: any = new FieldsetLayout();
	let firstSelected: boolean = false;
	for ( let i = 0; i < statements.length; i++ ) {
		const statement: Statement = statements[ i ];

		const $label: JQuery = await formatStatement( statement );
		const propertyId: string = statement.mainsnak.property;
		const isAlreadyInWikidata: boolean = ( alreadyExistingItems[ propertyId ] || [] ).includes( statement.id );

		const checkbox = new CheckboxInputWidget( {
			value: JSON.stringify( statement ),
			selected: isAlreadyInWikidata,
			disabled: isAlreadyInWikidata
		} );
		if ( !checkbox.isDisabled() ) {
			if ( !firstSelected || !getConfig( `properties.${propertyId}.constraints.unique` ) ) {
				firstSelected = true;
				checkbox.setSelected( true );
			}

			if ( $label[ 0 ].innerText.match( new RegExp( getI18n( 'already-used-in' ) ) ) &&
				getConfig( `properties.${propertyId}.constraints.unique` ) &&
				getConfig( `properties.${propertyId}.datatype` ) === 'external-id' ) {
				checkbox.setSelected( false );
			}
		}
		if ( statement.references ) {
			$label.append( formatDomains( statement.references ) );
		}

		const field: any = new FieldLayout( checkbox, {
			label: $label,
			align: 'inline'
		} );
		fieldset.addItems( [ field ] );
	}

	return fieldset;
}

async function getPropertyPanel( propertyId: string, statements: Statement[] ): Promise<any> {
	const panel = new PanelLayout( { padded: true, expanded: false } );
	const fieldset = await getPropertyFieldset( statements );

	panel.$element
		.append( $( '<p>' ).append( $( '<strong>' )
			.append( $( '<a>' )
				.attr( 'href', 'https://wikidata.org/wiki/Property:' + propertyId )
				.attr( 'target', '_blank' )
				.attr( 'rel', 'noopener noreferrer' )
				.text( getConfig( `properties.${propertyId}.label` ) )
			)
			.append( $( '<span>' ).text( ':' ) )
		) )
		.append( fieldset.$element )
		.append( $( '<hr>' ).css( 'margin-top', '1.5em' ) )
		.append( $( '<p>' ).text( getI18n( 'export-confirmation' ) ) )
		.append( $( '<p>' ).css( 'font-size', 'smaller' ).html( getI18n( 'license-cc0' ) ) );

	return panel;
}

async function getFormPanel( statements: Statement[] ): Promise<any> {
	const formPanel = new PanelLayout( { padded: true, expanded: false } );

	const claimsObject: ClaimsObject = convertStatementsToClaimsObject( statements );
	const propertyIds: string[] = Object.keys( claimsObject );
	for ( const i in propertyIds ) {
		const propertyId: string = propertyIds[ i ];
		const propertyPanel = await getPropertyPanel( propertyId, claimsObject[ propertyId ] );
		formPanel.$element.append( propertyPanel.$element );
	}
	return formPanel;
}

function collectFormData( formPanel: any ): Statement[] {
	const $checkboxes: JQuery = formPanel.$element.find( 'input[type=checkbox]:checked' );
	const statements: Statement[] = [];
	$checkboxes.each( function ( index, checkbox ) {
		const $checkbox: JQuery = $( checkbox );
		const jsonStatement: string = $checkbox.attr( 'value' );
		const statement: Statement = JSON.parse( jsonStatement );
		statements.push( statement );
	} );

	return statements;
}

/**
 * Display a dialog to confirm export
 */
export async function showDialog( statements: Statement[] ) {
	if ( !statements || !statements.length ) {
		mw.notify( getI18n( 'parsing-error' ), {
			type: 'error',
			tag: 'wikidataInfoboxExport-error'
		} );
		return;
	}

	// Create a dialog
	const ExtProcessDialog: any = function ( config: any ) {
		ExtProcessDialog.super.call( this, config );
	};
	inheritClass( ExtProcessDialog, ProcessDialog );

	ExtProcessDialog.static.name = getI18n( 'window-header' );
	ExtProcessDialog.static.title = $( '<span>' )
		.attr( 'title', getI18n( 'version-string' ).replace( '$1', getConfig( 'version' ) ) )
		.text( ExtProcessDialog.static.name );

	ExtProcessDialog.static.actions = [
		{ action: 'export', label: getI18n( 'export-button-label' ), flags: [ 'primary', 'progressive' ] },
		{ label: getI18n( 'cancel-button-label' ), flags: [ 'safe' ] }
	];

	const formPanel = await getFormPanel( statements );

	ExtProcessDialog.prototype.initialize = function () {
		ExtProcessDialog.super.prototype.initialize.apply( this, arguments );
		this.content = formPanel;
		this.$body.append( this.content.$element );
	};

	ExtProcessDialog.prototype.getActionProcess = function ( action: string ) {
		const dialog = this;
		if ( action === 'export' ) {
			return new Process( function () {
				const statements: Statement[] = collectFormData( formPanel );
				createClaims( statements );
				dialog.close( { action: action } );
			}, this );
		}
		dialog.getManager().destroy();
		return ExtProcessDialog.super.prototype.getActionProcess.call( this, action );
	};

	_windowManager = new WindowManager();
	$( 'body' ).append( _windowManager.$element );
	const processDialog = new ExtProcessDialog( {
		classes: [
			'wikidata-infobox-export-dialog'
		]
	} );
	_windowManager.addWindows( [ processDialog ] );
	_windowManager.openWindow( processDialog );
}

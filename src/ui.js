import { alreadyExistingItems } from "./parser";

const $ = require('jquery');
const mw = require('mw');

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
} from 'ooui';

import { getI18n } from "./i18n";
import { getConfig } from "./config";
import { createClaims } from "./wikidata";

let _windowManager;

/**
 * Format sources for display
 */
function formatDomains( references ) {
	const $result = $( '<sup>' );
	for ( let i = 0; i < references.length; i++ ) {
		const p854 = references[ i ].snaks.P854;
		if ( p854 ) {
			let domain = p854[ 0 ].datavalue.value.replace( 'http://', '' ).replace( 'https://', '' ).replace( 'www.', '' );
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
export function errorDialog( title, message ) {
	const errorDialog = new MessageDialog();
	_windowManager.addWindows( [ errorDialog ] );
	_windowManager.openWindow( errorDialog, {
		title: title,
		message: message
	} );
}

/**
 * Display a dialog to confirm export
 */
export function dialog( $field, propertyId, values, refUrl ) {
	let fieldset;

	if ( !values || !values.length ) {
		mw.notify( getI18n( 'parsing-error' ), {
			type: 'error',
			tag: 'wikidataInfoboxExport-error'
		} );
		return;
	}

	// Create a dialog
	const ExtProcessDialog = function ( config ) {
		ExtProcessDialog.super.call( this, config );
	}
	inheritClass( ExtProcessDialog, ProcessDialog );

	ExtProcessDialog.static.name = getI18n( 'window-header' );
	ExtProcessDialog.static.title = $( '<span>' )
		.attr( 'title', getI18n( 'version-string' ).replace( '$1', getConfig( 'version' ) ) )
		.text( ExtProcessDialog.static.name );

	ExtProcessDialog.static.actions = [
		{ action: 'export', label: getI18n( 'export-button-label' ), flags: [ 'primary', 'progressive' ] },
		{ label: getI18n( 'cancel-button-label' ), flags: [ 'safe' ] }
	];

	ExtProcessDialog.prototype.initialize = function () {
		ExtProcessDialog.super.prototype.initialize.apply( this, arguments );
		this.content = new PanelLayout( { padded: true, expanded: false } );

		fieldset = new FieldsetLayout();
		let firstSelected = false;
		for ( let i = 0; i < values.length; i++ ) {
			const alreadyInWikidata = ( alreadyExistingItems[ propertyId ] || [] ).includes( ( ( values[ i ].wd || {} ).value || {} ).id );
			const checkbox = new CheckboxInputWidget( {
				value: JSON.stringify( values[ i ].wd ),
				selected: alreadyInWikidata,
				disabled: alreadyInWikidata
			} );
			if ( !checkbox.isDisabled() ) {
				if ( !firstSelected || !getConfig( 'properties' )[ propertyId ].constraints.unique ) {
					firstSelected = true;
					checkbox.setSelected( true );
				}

				if ( values[ i ].label[ 0 ].innerText.match( new RegExp( getI18n( 'already-used-in' ) ) ) &&
					getConfig( 'properties' )[ propertyId ].constraints.unique &&
					getConfig( 'properties' )[ propertyId ].datatype === 'external-id' ) {
					checkbox.setSelected( false );
				}
			}
			if ( refUrl ) {
				values[ i ].label.append( formatDomains( refUrl ) );
			}
			fieldset.addItems( [
				new FieldLayout( checkbox, {
					label: values[ i ].label,
					align: 'inline'
				} )
			] );
		}

		this.content.$element
			.append( $( '<p>' ).append( $( '<strong>' )
				.append( $( '<a>' )
					.attr( 'href', 'https://wikidata.org/wiki/Property:' + propertyId )
					.attr( 'target', '_blank' )
					.text( getConfig( 'properties' )[ propertyId ].label )
				)
				.append( $( '<span>' ).text( ':' ) )
			) )
			.append( fieldset.$element )
			.append( $( '<hr>' ).css( 'margin-top', '1.5em' ) )
			.append( $( '<p>' ).text( getI18n( 'export-confirmation' ) ) )
			.append( $( '<p>' ).css( 'font-size', 'smaller' ).html( getI18n( 'license-cc0' ) ) );

		this.$body.append( this.content.$element );
	};

	ExtProcessDialog.prototype.getActionProcess = function ( action ) {
		const dialog = this;
		if ( action === 'export' ) {
			return new Process( function () {
				const values = [];
				const fields = fieldset.getItems();
				for ( const i in fields ) {
					const checkbox = fields[ i ].getField();
					if ( checkbox.isSelected() && !checkbox.isDisabled() ) {
						values.push( checkbox.getValue() );
					}
				}

				createClaims( propertyId, values, refUrl );
				dialog.close( { action: action } );
			}, this );
		}
		dialog.getManager().destroy();
		return ExtProcessDialog.super.prototype.getActionProcess.call( this, action );
	};

	_windowManager = new WindowManager();
	$( 'body' ).append( _windowManager.$element );
	const processDialog = new ExtProcessDialog();
	_windowManager.addWindows( [ processDialog ] );
	_windowManager.openWindow( processDialog );
}

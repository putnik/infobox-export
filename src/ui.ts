import { ItemValue } from './types/wikidata/values';

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
import { getConfig, getProperty } from './config';
import { alreadyExistingItems } from './parser';
import { convertStatementsToClaimsObject, createClaims } from './wikidata';
import { formatReferences, formatSnak } from './formatter';
import { ClaimsObject, Snak, SnaksObject, Statement } from './types/wikidata/main';
import { PropertyId } from './types/wikidata/types';
import { KeyValue } from './types/main';

let _windowManager: any;

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

async function getQualifierFields( qualifiers: SnaksObject ): Promise<JQuery> {
	const $qualifierFields: JQuery = $( '<ul>' ).addClass( 'infobox-export-qualifiers' );
	for ( const qualifierPropertyId in qualifiers ) {
		if ( !qualifiers.hasOwnProperty( qualifierPropertyId ) ) {
			continue;
		}

		for ( const i in qualifiers[ qualifierPropertyId ] ) {
			const qualifierSnak: Snak = qualifiers[ qualifierPropertyId ][ i ];
			const qualifierPropertyLabel: string = await getProperty( qualifierPropertyId as PropertyId, 'label' );
			const $qualifierPropertyLabel = $( '<span>' ).text( qualifierPropertyLabel );
			const $qualifierLabel: JQuery = await formatSnak( qualifierSnak );

			$qualifierFields.append( $( '<li>' ).append( $qualifierPropertyLabel, ': ', $qualifierLabel ) );
		}
	}
	return $qualifierFields;
}

async function getPropertyFieldset( propertyId: PropertyId, statements: Statement[] ): Promise<any> {
	const label: string = await getProperty( propertyId, 'label' );
	const $labelLink: JQuery = $( '<a>' )
		.attr( 'href', `https://wikidata.org/wiki/Property:${propertyId}` )
		.attr( 'rel', 'noopener noreferrer' )
		.attr( 'target', '_blank' )
		.text( label );

	const fieldset: any = new FieldsetLayout( {
		label: $( '<span>' ).append( $labelLink, ': ' )
	} );
	let firstSelected: boolean = false;
	for ( let i = 0; i < statements.length; i++ ) {
		const statement: Statement = statements[ i ];

		const $label: JQuery = await formatSnak( statement.mainsnak );
		const propertyId: PropertyId = statement.mainsnak.property;
		let isAlreadyInWikidata: boolean = false;
		if (
			statement.mainsnak.snaktype === 'value' &&
			statement.mainsnak.datavalue.type === 'wikibase-entityid' &&
			alreadyExistingItems[ propertyId ] &&
			alreadyExistingItems[ propertyId ].includes( ( statement.mainsnak.datavalue.value as ItemValue ).id )
		) {
			isAlreadyInWikidata = true;
		}

		const checkbox = new CheckboxInputWidget( {
			value: JSON.stringify( statement ),
			selected: isAlreadyInWikidata,
			disabled: isAlreadyInWikidata,
			indeterminate: isAlreadyInWikidata
		} );
		if ( !checkbox.isDisabled() ) {
			const isUnique: boolean = await getProperty( propertyId, 'constraints.unique' );
			if ( !firstSelected || !isUnique ) {
				firstSelected = true;
				checkbox.setSelected( true );
			}

			if ( $label[ 0 ].innerText.match( new RegExp( getI18n( 'already-used-in' ) ) ) &&
				await getProperty( propertyId, 'constraints.unique' ) &&
				await getProperty( propertyId, 'datatype' ) === 'external-id' ) {
				checkbox.setSelected( false );
			}
		}
		if ( statement.references ) {
			$label.append( formatReferences( statement.references ) );
		}

		const fieldData: KeyValue = {
			label: $label,
			align: 'inline',
			classes: [
				'infobox-export-statement'
			],
			helpInline: true
		};

		if ( statement.qualifiers ) {
			fieldData.help = await getQualifierFields( statement.qualifiers );
		}

		const field: any = new FieldLayout( checkbox, fieldData );
		fieldset.addItems( [ field ] );
	}

	return fieldset;
}

async function getFormPanel( statements: Statement[] ): Promise<any> {
	const claimsObject: ClaimsObject = convertStatementsToClaimsObject( statements );
	const propertyIds: PropertyId[] = Object.keys( claimsObject ) as PropertyId[];
	const propertyFieldsets: JQuery[] = [];
	for ( const i in propertyIds ) {
		const propertyId: PropertyId = propertyIds[ i ];
		const propertyFieldset = await getPropertyFieldset( propertyId, claimsObject[ propertyId ] );
		propertyFieldsets.push( propertyFieldset );
	}

	return new PanelLayout( {
		padded: true,
		expanded: false,
		content: [
			...propertyFieldsets,
			$( '<hr>' ).css( 'margin-top', '1.5em' ),
			$( '<p>' ).text( getI18n( 'export-confirmation' ) ),
			$( '<p>' ).css( 'font-size', 'smaller' ).html( getI18n( 'license-cc0' ) )
		]
	} );
}

function collectFormData( formPanel: any ): Statement[] {
	const $checkboxes: JQuery = formPanel.$element.find( 'input[type=checkbox]:checked:enabled' );
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
			'infobox-export-dialog'
		]
	} );
	_windowManager.addWindows( [ processDialog ] );
	_windowManager.openWindow( processDialog );
}

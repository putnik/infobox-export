import type { KeyValue, Property } from './types/main';
import type { ClaimsObject, Snak, SnaksObject, Statement } from './types/wikidata/main';
import type { PropertyId } from './types/wikidata/types';
import type { ItemValue } from './types/wikidata/values';

const $ = require( 'jquery' );
const mw = require( 'mw' );

// @ts-ignore
import { inheritClass } from 'oojs';

import { getI18n } from './i18n';
import { clearCache, getConfig, getOrLoadProperty } from './config';
import { convertStatementsToClaimsObject, createClaim, stringifyStatement } from './wikidata';
import { formatItemValue, formatReferences, formatSnak } from './formatter';
import { alreadyExistingItems } from './parser/item';
import { sleep, unique } from './utils';

let _windowManager: any;

async function getQualifierFields( qualifiers: SnaksObject ): Promise<JQuery> {
	const $qualifierFields: JQuery = $( '<ul>' ).addClass( 'infobox-export-qualifiers' );
	for ( const qualifierPropertyId in qualifiers ) {
		if ( !qualifiers.hasOwnProperty( qualifierPropertyId ) ) {
			continue;
		}

		for ( const i in qualifiers[ qualifierPropertyId ] ) {
			const qualifierSnak: Snak = qualifiers[ qualifierPropertyId ][ i ];
			const qualifierProperty: Property | undefined = await getOrLoadProperty( qualifierPropertyId as PropertyId );
			const qualifierPropertyLabel: string = qualifierProperty?.label || qualifierPropertyId;
			const $qualifierPropertyLabel = $( '<span>' ).text( qualifierPropertyLabel );
			const $qualifierLabel: JQuery = await formatSnak( qualifierSnak );

			$qualifierFields.append( $( '<li>' ).append( $qualifierPropertyLabel, ': ', $qualifierLabel ) );
		}
	}
	return $qualifierFields;
}

async function getPropertyFieldset( propertyId: PropertyId, statements: Statement[] ): Promise<any> {
	const {
		CheckboxInputWidget,
		FieldLayout,
		FieldsetLayout,
		PopupButtonWidget
	} = require( 'ooui' );

	const property: Property | undefined = await getOrLoadProperty( propertyId );
	const label: string = property?.label || propertyId;
	const $labelLink: JQuery = $( '<a>' )
		.attr( 'href', `https://wikidata.org/wiki/Property:${propertyId}` )
		.attr( 'rel', 'noopener noreferrer' )
		.attr( 'target', '_blank' )
		.text( label );

	const fieldset: any = new FieldsetLayout( {
		label: $labelLink
	} );
	let firstSelected: boolean = false;
	for ( let i = 0; i < statements.length; i++ ) {
		const statement: Statement = statements[ i ];

		const $label: JQuery = await formatSnak( statement.mainsnak );
		if ( statement.rank === 'deprecated' ) {
			$label.addClass( 'infobox-export-deprecated' );
		}
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

		const hasSubclassEntity: boolean = typeof statement.meta?.subclassItem !== 'undefined';

		const checkbox = new CheckboxInputWidget( {
			value: stringifyStatement( statement ),
			selected: isAlreadyInWikidata,
			disabled: isAlreadyInWikidata,
			indeterminate: isAlreadyInWikidata
		} );
		if ( !checkbox.isDisabled() ) {
			const property: Property | undefined = await getOrLoadProperty( propertyId );
			const isUnique: boolean = property?.constraints?.unique || ( property?.datatype === 'quantity' );
			if ( !( firstSelected && isUnique ) && !hasSubclassEntity ) {
				firstSelected = true;
				checkbox.setSelected( true );
			}

			if ( $label[ 0 ].innerText.match( new RegExp( getI18n( 'already-used-in' ) ) ) &&
				isUnique &&
				property?.datatype === 'external-id'
			) {
				checkbox.setSelected( false );
			}
		}
		if ( statement.references ) {
			$label.append( formatReferences( statement.references ) );
		}

		if ( !isAlreadyInWikidata && hasSubclassEntity ) {
			const $userSubclassLabel: JQuery = await formatItemValue( statement.meta.subclassItem );
			const $subclassText: JQuery = $( '<div>' );
			getI18n( 'more-precise-value' )
				.split( /(\$\d+)/ )
				.forEach( function ( part: string ) {
					if ( part === '$1' ) {
						$subclassText.append( $userSubclassLabel );
					} else {
						$subclassText.append( part );
					}
				} );
			const subclassWarning = new PopupButtonWidget( {
				flags: 'warning',
				framed: false,
				icon: 'alert',
				type: 'warning',
				popup: {
					$content: $subclassText,
					align: 'force-left',
					padded: true
				}
			} );
			const $subclassWrapper: JQuery = $( '<div>' )
				.css( {
					float: 'right',
					'margin-top': '-.5em'
				} )
				.append( subclassWarning.$element );
			$label.prepend( $subclassWrapper );
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

	const {
		ButtonMenuSelectWidget,
		MenuOptionWidget,
		PanelLayout
	} = require( 'ooui' );

	const configMenuButton: any = new ButtonMenuSelectWidget( {
		framed: false,
		icon: 'ellipsis',
		label: '',
		menu: {
			horizontalPosition: 'before',
			verticalPosition: 'top',
			items: [
				new MenuOptionWidget( {
					label: getI18n( 'version-string' ).replace( '$1', getConfig( 'version' ) ),
					data: 'version',
					icon: 'key'
				} ),
				new MenuOptionWidget( {
					label: getI18n( 'open-help-page' ),
					data: 'help',
					icon: 'help'
				} ),
				new MenuOptionWidget( {
					label: getI18n( 'report-issue' ),
					data: 'report',
					icon: 'feedback'
				} ),
				new MenuOptionWidget( {
					label: getI18n( 'clear-cache' ),
					data: 'cache',
					icon: 'reload'
				} )
			]
		}
	} );
	configMenuButton.getMenu().on( 'select', ( item: any ) => {
		if ( !item ) {
			return;
		}
		if ( item.data === 'cache' ) {
			clearCache();
			window.location.reload();
		}
		if ( item.data === 'help' ) {
			window.open( '//wikidata.org/wiki/Special:MyLanguage/Help:Infobox_export_gadget', '_blank' );
		}
		if ( item.data === 'report' ) {
			window.open( '//www.wikidata.org/?title=Help_talk:Infobox_export_gadget&action=edit&section=new', '_blank' );
		}
		if ( item.data === 'version' ) {
			window.open( '//github.com/putnik/infobox-export/commit/' + getConfig( 'commit' ), '_blank' );
		}
	} );

	return new PanelLayout( {
		padded: true,
		expanded: false,
		content: [
			...propertyFieldsets,
			$( '<hr>' ).css( 'margin-top', '1.5em' ),
			$( '<p>' ).text( getI18n( 'export-confirmation' ) ),
			$( '<div>' ).css( {
				float: 'right',
				marginLeft: '.5em'
			} ).append( configMenuButton.$element ),
			$( '<p>' ).css( 'font-size', '85%' ).html( getI18n( 'license-cc0' ) )
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
		statement.meta = { $checkbox };
		statements.push( statement );
	} );

	return statements;
}

/**
 * Create all statements in Wikidata and disable processed checkboxes
 */
async function createClaims( statements: Statement[] ): Promise<void> {
	const SUCCESS_COLOR = '#c8ccd1';
	let propertyIds: PropertyId[] = [];
	const totalCount: number = statements.length;
	while ( statements.length ) {
		const statement: Statement = statements.shift();

		const $checkbox = statement.meta.$checkbox;
		$checkbox.prop( 'disabled', true );
		const $fakeCheckbox = statement.meta.$checkbox.parent().find( 'span' );

		const propertyId: PropertyId = statement.mainsnak.property;
		propertyIds.push( propertyId );

		const errorMessage: string|null = await createClaim( statement );
		if ( errorMessage ) {
			const { MessageWidget } = require( 'ooui' );
			const errorMessageWidget = new MessageWidget( {
				type: 'error',
				label: getI18n( 'value-failed' ) + ': ' + errorMessage,
				showClose: true
			} );
			$checkbox.prop( 'disabled', false );
			$fakeCheckbox.closest( '.oo-ui-labelElement' )
				.append( errorMessageWidget.$element );
			throw errorMessage;
		}

		$fakeCheckbox.css( {
			'background-color': SUCCESS_COLOR,
			'border-color': SUCCESS_COLOR
		} );
	}

	propertyIds = unique( propertyIds );
	for ( const i in propertyIds ) {
		const propertyId: PropertyId = propertyIds[ i ];
		$( `.no-wikidata[data-wikidata-property-id=${propertyId}]` )
			.removeClass( 'no-wikidata' )
			.off( 'dblclick' ); // FIXME: disable only clickEvent
	}

	// Delay for the user to see the last green checkbox
	await sleep( 450 );

	mw.loader.using( 'mediawiki.action.view.postEdit', function () {
		mw.hook( 'postEdit' ).fire( {
			message: getI18n( totalCount > 1 ? 'all-values-saved' : 'value-saved' )
		} );
	} );
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
	const {
		Process,
		ProcessDialog,
		WindowManager
	} = require( 'ooui' );

	// Create a dialog
	const ExtProcessDialog: any = function ( config: any ) {
		ExtProcessDialog.super.call( this, config );
	};
	inheritClass( ExtProcessDialog, ProcessDialog );

	ExtProcessDialog.static.name = getI18n( 'window-header' );
	ExtProcessDialog.static.title = ExtProcessDialog.static.name;

	ExtProcessDialog.static.actions = [
		{ action: 'export', label: getI18n( 'export-button-label' ), flags: [ 'primary', 'progressive' ] },
		{ label: getI18n( 'cancel-button-label' ), flags: [ 'safe' ] }
	];

	const formPanel = await getFormPanel( statements );

	ExtProcessDialog.prototype.initialize = function () {
		ExtProcessDialog.super.prototype.initialize.apply( this, arguments );
		this.content = formPanel;
		this.$body.append( this.content.$element );
		this.$body.css( 'overflow-x', 'hidden' );
		this.$body.css( 'overflow-y', 'auto' );
	};

	ExtProcessDialog.prototype.getActionProcess = function ( action: string ) {
		const dialog = this;
		if ( action === 'export' ) {
			return new Process( async function () {
				const exportAction = dialog.actions.get( { actions: 'export' } )[ 0 ];
				exportAction.setDisabled( true );

				const statements: Statement[] = collectFormData( formPanel );
				try {
					await createClaims( statements );
				} catch {
					exportAction.setDisabled( false );
					return;
				}

				dialog.close( { action: action } );
				dialog.getManager().destroy();
			}, this );
		} else {
			dialog.close( { action: action } );
			dialog.getManager().destroy();
		}
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

import type { Property } from './types/main';
import type { Snak, SnaksObject, Statement } from './types/wikidata/main';
import type { PropertyId } from './types/wikidata/types';
import type { ItemValue } from './types/wikidata/values';

const $ = require( 'jquery' );
const mw = require( 'mw' );

import { getI18n } from './i18n';
import { clearCache, getConfig, getOrLoadProperty } from './config';
import { addDateQualifier, convertSnakToStatement, convertStatementsToClaimsObject, createClaim } from './wikidata';
import { formatReferences, formatSnak } from './formatter';
import { alreadyExistingItems, exportCounts, splitCandidates } from './parser/item';

const DATE_PROPERTIES: string[] = [ 'P585', 'P580', 'P582' ];
// Order the date-qualifier radio reads as start → point → end.
const DATE_CHOICE_ORDER: string[] = [ 'P580', 'P585', 'P582' ];

interface QualifierChip {
	label: string;
	$value: JQuery;
	// Which qualifier this chip is, so it can be toggled off before export.
	property: string;
	index: number;
}

interface DialogRow {
	statement: Statement;
	$label: JQuery;
	qualifiers: QualifierChip[];
	enrich: boolean;
	// One formatted date string per date-qualifier picker (range -> two).
	dateChoiceLabels: string[];
	disabled: boolean;
	selected: boolean;
}

interface DialogGroup {
	propertyId: PropertyId;
	label: string;
	rows: DialogRow[];
}

let cssAdded: boolean = false;

// One dialog at a time — a second would stack and leak clicks to the one below.
// Extra double-clicks are queued and shown as each dialog closes.
let dialogOpen: boolean = false;
const dialogQueue: { statements: Statement[]; propertyId?: string }[] = [];

function finishDialog(): void {
	dialogOpen = false;
	const next = dialogQueue.shift();
	if ( next ) {
		setTimeout( (): void => {
			showDialog( next.statements, next.propertyId );
		}, 0 );
	}
}

/**
 * Format each qualifier as a label + value pair for the Codex info chips. The
 * calendar marker is dropped (noise in a compact chip).
 */
async function getQualifierChips( qualifiers: SnaksObject ): Promise<QualifierChip[]> {
	const chips: QualifierChip[] = [];
	for ( const qualifierPropertyId in qualifiers ) {
		if ( !qualifiers.hasOwnProperty( qualifierPropertyId ) ) {
			continue;
		}
		for ( const i in qualifiers[ qualifierPropertyId ] ) {
			const qualifierSnak: Snak = qualifiers[ qualifierPropertyId ][ i ];
			const qualifierProperty: Property | undefined = await getOrLoadProperty( qualifierPropertyId as PropertyId );
			const $value: JQuery = await formatSnak( qualifierSnak );
			$value.find( '.infobox-export-calendar' ).remove();
			chips.push( {
				label: qualifierProperty?.label || qualifierPropertyId,
				$value,
				property: qualifierPropertyId,
				index: Number( i )
			} );
		}
	}
	return chips;
}

/**
 * Format each pending date-choice value to a short display string (e.g. "1969"),
 * shown next to its start/point/end radio group.
 */
async function getDateChoiceLabels( statement: Statement ): Promise<string[]> {
	const choices = statement.meta?.dateChoices || [];
	const labels: string[] = [];
	for ( const choice of choices ) {
		const snak: Snak = {
			snaktype: 'value',
			property: 'P585',
			datatype: 'time',
			datavalue: { type: 'time', value: choice.value }
		};
		const $formatted: JQuery = await formatSnak( snak );
		$formatted.find( '.infobox-export-calendar' ).remove();
		labels.push( $formatted.text().trim() );
	}
	return labels;
}

/**
 * Build the per-property view model: pre-render labels and qualifiers (reusing
 * the existing formatters) and compute the disabled/selected state for each row.
 */
async function buildGroups( statements: Statement[] ): Promise<DialogGroup[]> {
	const claimsObject = convertStatementsToClaimsObject( statements );
	const groups: DialogGroup[] = [];

	for ( const propertyId of Object.keys( claimsObject ) as PropertyId[] ) {
		const property: Property | undefined = await getOrLoadProperty( propertyId );
		// P19/P20 are single-valued: auto-select only the top candidate, leave the
		// rest unchecked.
		const isUnique: boolean = !!( property?.constraints?.unique ) ||
			property?.datatype === 'quantity' ||
			propertyId === 'P19' || propertyId === 'P20';
		const rows: DialogRow[] = [];
		let firstSelected: boolean = false;

		for ( const statement of claimsObject[ propertyId ] ) {
			const $label: JQuery = await formatSnak( statement.mainsnak );
			if ( statement.rank === 'deprecated' ) {
				$label.addClass( 'infobox-export-deprecated' );
			}
			if ( statement.references ) {
				$label.append( formatReferences( statement.references ) );
			}
			const qualifiers: QualifierChip[] = statement.qualifiers ? await getQualifierChips( statement.qualifiers ) : [];

			// "Already on Wikidata": use the count-based mark for awards, else the
			// old value-match.
			let disabled: boolean;
			if ( exportCounts[ propertyId ] ) {
				disabled = !!statement.meta?.alreadyExists;
			} else {
				disabled = statement.mainsnak.snaktype === 'value' &&
					statement.mainsnak.datavalue.type === 'wikibase-entityid' &&
					!!alreadyExistingItems[ propertyId ] &&
					alreadyExistingItems[ propertyId ].includes( ( statement.mainsnak.datavalue.value as ItemValue ).id );
			}

			const hasSubclass: boolean = typeof statement.meta?.subclassItem !== 'undefined';
			let selected: boolean = false;
			if ( !disabled && !hasSubclass && !( firstSelected && isUnique ) ) {
				firstSelected = true;
				selected = true;
			}
			// Do not auto-select an external-id that is already used elsewhere.
			if ( selected && isUnique && property?.datatype === 'external-id' &&
				$label[ 0 ].innerText.match( new RegExp( getI18n( 'already-used-in' ) ) )
			) {
				selected = false;
			}

			rows.push( {
				statement,
				$label,
				qualifiers,
				enrich: !!statement.meta?.enrich,
				dateChoiceLabels: await getDateChoiceLabels( statement ),
				disabled,
				selected
			} );
		}

		groups.push( { propertyId, label: property?.label || propertyId, rows } );
	}

	return groups;
}

function addDialogCss(): void {
	if ( cssAdded ) {
		return;
	}
	cssAdded = true;
	// Card layout using Codex design tokens.
	mw.util.addCSS(
		'.wie-group-label{margin:.3em 0 .4em;font-weight:bold}' +
		'.wie-card{border:1px solid var(--border-color-subtle,#c8ccd1);border-radius:0;background-color:var(--background-color-base,#fff);box-shadow:0 1px 4px rgba(0,0,0,.05);padding:12px 16px;margin:12px 0}' +
		'.wie-existing{background-color:var(--background-color-interactive-subtle,#f8f9fa);box-shadow:none;opacity:.75}' +
		'.wie-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;margin-left:30px}' +
		'.wie-chips .cdx-info-chip{border-radius:16px;min-height:0;padding:2px 10px;font-size:.82em;border-color:rgba(51,102,204,.35);background-color:var(--background-color-progressive-subtle,#eaf3ff);color:var(--color-progressive,#36c)}' +
		'.wie-card .infobox-export-main-label{font-weight:600;font-size:.9em}' +
			'.wie-new{background-color:var(--background-color-base,#fff)}' +
			'.wie-enrich{background-color:var(--background-color-base,#fff)}' +
			'.wie-datechoice{display:flex;align-items:center;flex-wrap:wrap;gap:.35em .9em;margin-top:12px;margin-left:30px;font-size:.9em}' +
			'.wie-datechoice-label{flex-basis:100%;margin-bottom:.25em;color:var(--color-subtle,#54595d);font-size:1.05em}' +
			'.wie-datechoice .cdx-checkbox{margin:0}' +
		'.infobox-export-description{color:var(--color-placeholder,#72777d);font-weight:300;font-style:italic;font-size:.9em}' +
		'.wie-confirm{font-weight:bold}' +
		'.wie-hr{border:0;border-top:1px solid var(--border-color-subtle,#c8ccd1);background:none;height:0;margin:20px 0}' +
		'.wie-license{font-size:85%;line-height:1.4;color:var(--color-subtle,#54595d)}' +
		'.wie-footer{display:flex;align-items:center;margin-top:1.5em}' +
		'.wie-footer-actions{margin-left:auto;display:flex;gap:.5em;align-items:center}' +
			'.wie-progress{display:inline-flex;align-items:center;gap:.5em;color:var(--color-subtle,#54595d);font-size:.9em;font-variant-numeric:tabular-nums;white-space:nowrap}' +
			'.wie-progress .cdx-progress-indicator__indicator{width:1.25em;height:1.25em}' +
			'.wie-chip-toggle{display:inline-flex;align-items:center;cursor:pointer;border-radius:16px}' +
			'.wie-chip-toggle:hover{box-shadow:0 0 0 1px var(--border-color-progressive,#36c)}' +
			'.wie-chip-removed .cdx-info-chip{text-decoration:line-through;opacity:.6}' +
			'.wie-chip-x{color:var(--color-destructive,#d33);font-weight:bold;margin-right:.25em;font-size:.82em}' +
			'.wie-faded{opacity:.4;pointer-events:none}' +
			'.wie-group-head{display:flex;align-items:center;justify-content:space-between;gap:1em}' +
			'.wie-group-head .wie-group-label{margin:.3em 0 .4em}' +
		'.wie-footer>*:first-child button{border-color:var(--border-color-base,#a2a9b1)}' +
		'.wie-spin{display:flex;justify-content:center;margin:.6em 0}'
	);
}

function splitDateProp( statement: Statement ): string | null {
	for ( const prop of DATE_PROPERTIES ) {
		if ( ( statement.qualifiers?.[ prop ]?.length || 0 ) > 1 ) {
			return prop;
		}
	}
	return null;
}

/**
 * Split each malformed statement (several dates packed into one) into one
 * statement per date: keep the original with the first date and create the rest.
 */
async function performSplit( candidates: Statement[] ): Promise<string | null> {
	for ( const candidate of candidates ) {
		const dateProp: string | null = splitDateProp( candidate );
		const candidateQualifiers: SnaksObject | undefined = candidate.qualifiers;
		if ( !dateProp || !candidateQualifiers ) {
			continue;
		}
		const dateSnaks: Snak[] = candidateQualifiers[ dateProp ];

		// Keep the original statement (same GUID) but with only the first date.
		const original: Statement = JSON.parse( JSON.stringify( candidate ) );
		( original.qualifiers as SnaksObject )[ dateProp ] = [ dateSnaks[ 0 ] ];
		let errorMessage: string | null = await createClaim( original );
		if ( errorMessage ) {
			return errorMessage;
		}

		// Create a separate new statement for each remaining date.
		for ( let i: number = 1; i < dateSnaks.length; i++ ) {
			const extra: Statement = convertSnakToStatement( candidate.mainsnak, candidate.references || [] );
			extra.rank = candidate.rank;
			const clonedQualifiers: SnaksObject = JSON.parse( JSON.stringify( candidateQualifiers ) );
			clonedQualifiers[ dateProp ] = [ dateSnaks[ i ] ];
			extra.qualifiers = clonedQualifiers;
			errorMessage = await createClaim( extra );
			if ( errorMessage ) {
				return errorMessage;
			}
		}
	}
	return null;
}

/**
 * Confirm dialog offering to split malformed multi-date statements. Resolves
 * true when the split was performed (and the dialog closed).
 */
async function showSplitConfirm( candidates: Statement[] ): Promise<boolean> {
	// Pre-render each value and its packed dates for the dialog.
	const details: { $label: JQuery; qualifiers: QualifierChip[] }[] = [];
	for ( const candidate of candidates ) {
		const $label: JQuery = await formatSnak( candidate.mainsnak );
		const qualifiers: QualifierChip[] = candidate.qualifiers ? await getQualifierChips( candidate.qualifiers ) : [];
		details.push( { $label, qualifiers } );
	}

	const mwRequire: any = await mw.loader.using( [ 'vue', '@wikimedia/codex' ] );
	const Vue: any = mwRequire( 'vue' );
	const Codex: any = mwRequire( '@wikimedia/codex' );
	addDialogCss();
	const h: any = Vue.h;
	const ref: any = Vue.ref;

	const RawDom: any = Vue.defineComponent( {
		props: { node: { default: null }, tag: { default: 'span' } },
		render(): any {
			return h( this.tag, { class: 'wie-raw' } );
		},
		mounted(): void {
			if ( this.node ) {
				this.$el.appendChild( this.node.jquery ? this.node[ 0 ] : this.node );
			}
		}
	} );

	const container: HTMLDivElement = document.createElement( 'div' );
	document.body.appendChild( container );

	return new Promise<boolean>( ( resolve ): void => {
		let settled: boolean = false;
		const app: any = Vue.createMwApp( {
			setup() {
				const open: any = ref( true );
				const busy: any = ref( false );
				const error: any = ref( '' );

				function finish( didSplit: boolean ): void {
					if ( settled ) {
						return;
					}
					settled = true;
					app.unmount();
					if ( container.parentNode ) {
						container.parentNode.removeChild( container );
					}
					resolve( didSplit );
				}

				function confirmSplit(): void {
					busy.value = true;
					error.value = '';
					performSplit( candidates ).then( ( errorMessage: string | null ): void => {
						if ( errorMessage ) {
							busy.value = false;
							error.value = getI18n( 'value-failed' ) + ': ' + errorMessage;
							return;
						}
						delete splitCandidates[ 'P166' ];
						// Reload so the freshly split statements are reflected.
						window.location.reload();
					} );
				}

				return (): any => {
					const body: any[] = [ h( 'p', null, getI18n( 'split-qualifiers-question' ) ) ];
					for ( const detail of details ) {
						const children: any[] = [ h( RawDom, { node: detail.$label } ) ];
						if ( detail.qualifiers.length ) {
							children.push( h( 'div', { class: 'wie-chips' }, detail.qualifiers.map( ( qualifier: QualifierChip ): any =>
								h( Codex.CdxInfoChip, null, {
									default: (): any => [ qualifier.label + ': ', h( RawDom, { node: qualifier.$value } ) ]
								} )
							) ) );
						}
						body.push( h( 'div', { class: 'wie-card' }, children ) );
					}
					if ( busy.value ) {
						body.push( h( 'div', { class: 'wie-spin' }, h( Codex.CdxProgressIndicator ) ) );
					}
					if ( error.value ) {
						body.unshift( h( Codex.CdxMessage, { type: 'error', inline: true }, { default: (): string => error.value } ) );
					}
					return h( Codex.CdxDialog, {
						open: open.value,
						title: getI18n( 'split-qualifiers-title' ),
						useCloseButton: true,
						primaryAction: {
							label: getI18n( 'split-qualifiers-button' ),
							actionType: 'progressive',
							disabled: busy.value
						},
						defaultAction: { label: getI18n( 'cancel-button-label' ) },
						'onUpdate:open': ( value: boolean ): void => {
							open.value = value;
							if ( !value ) {
								setTimeout( (): void => finish( false ), 0 );
							}
						},
						onPrimary: confirmSplit,
						onDefault: (): void => {
							open.value = false;
						}
					}, { default: (): any[] => body } );
				};
			}
		} );
		app.mount( container );
	} );
}

/**
 * Display the export dialog (Vue 3 + Codex, loaded from ResourceLoader).
 */
export async function showDialog( statements: Statement[], propertyId?: string ): Promise<void> {
	// One dialog at a time: queue a second double-click for after this one closes.
	if ( dialogOpen ) {
		dialogQueue.push( { statements, propertyId } );
		return;
	}
	dialogOpen = true;

	// Offer to split a multi-date award first; works even when there's nothing new
	// to export.
	const splits: Statement[] | undefined = propertyId === 'P166' ? splitCandidates[ 'P166' ] : undefined;
	const offeredSplit: boolean = !!( splits && splits.length );
	if ( offeredSplit ) {
		const splitDone: boolean = await showSplitConfirm( splits as Statement[] );
		if ( splitDone ) {
			finishDialog();
			return;
		}
	}

	if ( !statements || !statements.length ) {
		finishDialog();
		if ( !offeredSplit ) {
			mw.notify( getI18n( 'parsing-error' ), {
				type: 'error',
				tag: 'wikidataInfoboxExport-error'
			} );
		}
		return;
	}

	// Vue + Codex come from ResourceLoader; mwRequire (not "require") keeps webpack
	// from bundling them. Release the dialog lock if setup fails.
	let groups: DialogGroup[];
	let mwRequire: any;
	try {
		groups = await buildGroups( statements );
		mwRequire = await mw.loader.using( [ 'vue', '@wikimedia/codex' ] );
	} catch ( error ) {
		finishDialog();
		throw error;
	}
	const Vue: any = mwRequire( 'vue' );
	const Codex: any = mwRequire( '@wikimedia/codex' );
	addDialogCss();

	const h: any = Vue.h;
	const reactive: any = Vue.reactive;
	const ref: any = Vue.ref;

	// Mounts an existing jQuery/DOM node inside the Vue tree so we reuse the
	// formatters' markup.
	const RawDom: any = Vue.defineComponent( {
		props: { node: { default: null }, tag: { default: 'span' } },
		render(): any {
			return h( this.tag, { class: 'wie-raw' } );
		},
		mounted(): void {
			if ( this.node ) {
				this.$el.appendChild( this.node.jquery ? this.node[ 0 ] : this.node );
			}
		}
	} );

	const selected: any = reactive( {} );
	const done: any = reactive( {} );
	// Per-statement chosen date-qualifier property (P580/P585/P582).
	const dateProp: any = reactive( {} );
	// Qualifier chips toggled off (removed[id]["P585:0"] === true), dropped just
	// before saving.
	const removed: any = reactive( {} );
	// Pristine qualifiers, so toggling removal or retrying a save always recomputes
	// from the original rather than a mutated statement.
	const originalQualifiers: { [ key: string ]: SnaksObject | null } = {};
	for ( const group of groups ) {
		for ( const row of group.rows ) {
			selected[ row.statement.id ] = row.selected;
			removed[ row.statement.id ] = removed[ row.statement.id ] || {};
			originalQualifiers[ row.statement.id ] = row.statement.qualifiers ?
				JSON.parse( JSON.stringify( row.statement.qualifiers ) ) :
				null;
			if ( row.statement.meta?.dateChoices?.length ) {
				dateProp[ row.statement.id ] = row.statement.meta.dateChoices.map(
					( choice ): string => choice.selected
				);
			}
		}
	}

	const container: HTMLDivElement = document.createElement( 'div' );
	document.body.appendChild( container );

	const app: any = Vue.createMwApp( {
		setup() {
			const open: any = ref( true );
			const busy: any = ref( false );
			const error: any = ref( '' );
			const menuSelection: any = ref( null );
			// Live "N/total exporting…" progress, shown next to a Codex spinner.
			const exportCurrent: any = ref( 0 );
			const exportTotal: any = ref( 0 );
			// Codex focuses the [d] link in the first (disabled) row on open; move
			// focus to the first usable checkbox instead.
			Vue.onMounted( (): void => {
				setTimeout( (): void => {
					const dialog: Element | null = document.querySelector( '.infobox-export-dialog' );
					const target: HTMLElement | null = dialog ?
						( dialog.querySelector( 'input[type=checkbox]:not(:disabled)' ) || dialog.querySelector( 'button' ) ) :
						null;
					if ( target ) {
						target.focus();
					}
				}, 0 );
			} );

			// Enter exports (Esc closes via Codex). Ignored while a button/link/text
				// field is focused so their own behaviour wins.
				function onKeydown( event: KeyboardEvent ): void {
					if ( !open.value || busy.value || event.key !== 'Enter' || event.isComposing ) {
						return;
					}
					const target: HTMLElement = event.target as HTMLElement;
					const tag: string = ( target?.tagName || '' ).toLowerCase();
					const isCheckbox: boolean = tag === 'input' &&
						( target as HTMLInputElement ).type === 'checkbox';
					if ( !isCheckbox && ( tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' ) ) {
						return;
					}
					event.preventDefault();
					exportSelected();
				}
				Vue.onMounted( (): void => document.addEventListener( 'keydown', onKeydown, true ) );
				Vue.onUnmounted( (): void => document.removeEventListener( 'keydown', onKeydown, true ) );

				function cleanup(): void {
				app.unmount();
				if ( container.parentNode ) {
					container.parentNode.removeChild( container );
				}
				finishDialog();
			}

			function close(): void {
				open.value = false;
				setTimeout( cleanup, 0 );
			}

			// Apply the user's date-qualifier choice to the statement before saving.
				function applyRemovedQualifiers( statement: Statement ): void {
						const original: SnaksObject | null = originalQualifiers[ statement.id ];
						if ( original ) {
							statement.qualifiers = JSON.parse( JSON.stringify( original ) );
						} else {
							delete statement.qualifiers;
						}
						const flags = removed[ statement.id ];
						if ( !flags || !statement.qualifiers ) {
							return;
						}
						const dropByProperty: { [ key: string ]: { [ key: number ]: boolean } } = {};
						for ( const key in flags ) {
							if ( !flags[ key ] ) {
								continue;
							}
							const separator: number = key.lastIndexOf( ':' );
							const property: string = key.slice( 0, separator );
							const index: number = Number( key.slice( separator + 1 ) );
							dropByProperty[ property ] = dropByProperty[ property ] || {};
							dropByProperty[ property ][ index ] = true;
						}
						for ( const property in dropByProperty ) {
							const snaks: Snak[] | undefined = statement.qualifiers[ property ];
							if ( !snaks ) {
								continue;
							}
							statement.qualifiers[ property ] = snaks.filter(
								( _snak: Snak, i: number ): boolean => !dropByProperty[ property ][ i ]
							);
							if ( !statement.qualifiers[ property ].length ) {
								delete statement.qualifiers[ property ];
							}
						}
						if ( !Object.keys( statement.qualifiers ).length ) {
							delete statement.qualifiers;
						}
					}

				function applyDateChoice( statement: Statement ): void {
					const choices = statement.meta?.dateChoices;
					if ( !choices || !choices.length ) {
						return;
					}
					const selections: ( string | null )[] = dateProp[ statement.id ] ||
						choices.map( ( choice ): string | null => choice.selected );
					statement.qualifiers = statement.qualifiers || {};
					for ( let i: number = 0; i < choices.length; i++ ) {
						const chosenProp: string | null = selections[ i ];
						if ( !chosenProp ) {
							continue; // date offered but left unselected -> skip it
						}
						statement.qualifiers[ chosenProp ] = statement.qualifiers[ chosenProp ] || [];
						statement.qualifiers[ chosenProp ].push( {
							snaktype: 'value',
							property: chosenProp as PropertyId,
							datatype: 'time',
							datavalue: { type: 'time', value: choices[ i ].value }
						} );
					}
				}

				function exportSelected(): void {
				const chosen: Statement[] = [];
				for ( const group of groups ) {
					for ( const row of group.rows ) {
						if ( selected[ row.statement.id ] && !row.disabled ) {
							chosen.push( row.statement );
						}
					}
				}
				if ( !chosen.length ) {
					close();
					return;
				}
				busy.value = true;
				error.value = '';
				exportTotal.value = chosen.length;
				exportCurrent.value = 0;
				const savedPropertyIds: { [ key: string ]: boolean } = {};

				const step = ( index: number ): void => {
					if ( index >= chosen.length ) {
						for ( const savedProperty in savedPropertyIds ) {
							$( `.no-wikidata[data-wikidata-property-id=${ savedProperty }]` )
								.removeClass( 'no-wikidata' )
								.off( 'dblclick' );
						}
						// The clicked field's property can differ from the exported one
						// (P40 number exports as P1971), so clear that field too.
						if ( propertyId ) {
							$( `.no-wikidata[data-wikidata-property-id=${ propertyId }]` )
								.removeClass( 'no-wikidata' )
								.off( 'dblclick' );
						}
						mw.loader.using( 'mediawiki.action.view.postEdit', function (): void {
							mw.hook( 'postEdit' ).fire( {
								message: getI18n( chosen.length > 1 ? 'all-values-saved' : 'value-saved' )
							} );
						} );
						busy.value = false;
						close();
						return;
					}
					exportCurrent.value = index + 1;
					const statement: Statement = chosen[ index ];
					// Drop toggled-off qualifiers, then apply the picked date property.
						applyRemovedQualifiers( statement );
						applyDateChoice( statement );
						// Gray the row while it saves.
					done[ statement.id ] = true;
					( statement.meta?.enrich ? addDateQualifier( statement ) : createClaim( statement ) ).then( ( errorMessage: string | null ): void => {
						if ( errorMessage ) {
							done[ statement.id ] = false;
							busy.value = false;
							error.value = getI18n( 'value-failed' ) + ': ' + errorMessage;
							return;
						}
						savedPropertyIds[ statement.mainsnak.property ] = true;
						step( index + 1 );
					} );
				};
				step( 0 );
			}

			function renderRow( row: DialogRow ): any {
				const children: any[] = [
					h( Codex.CdxCheckbox, {
						modelValue: row.disabled ? true : selected[ row.statement.id ],
						disabled: row.disabled || !!done[ row.statement.id ],
						indeterminate: row.disabled,
						'onUpdate:modelValue': ( value: boolean ): void => {
							if ( !row.disabled ) {
								selected[ row.statement.id ] = value;
							}
						}
					}, { default: (): any => h( RawDom, { node: row.$label } ) } )
				];

				// Unchecked but exportable row: fade its qualifiers/pickers (a disabled
					// already-on-Wikidata row keeps its own styling).
					const greyed: boolean = !row.disabled && !selected[ row.statement.id ];

				// Chips: the date hint ("add missing date" / "more precise date") and
					// each qualifier.
					const chips: any[] = [];
					if ( row.enrich ) {
						const precise: boolean = !!row.statement.meta?.enrich?.precise;
						chips.push( h( Codex.CdxInfoChip, { status: 'notice' }, {
							default: (): string => getI18n( precise ? 'more-precise-date' : 'enrich-date' )
						} ) );
					}
				// Qualifiers are only toggleable on rows that will be exported.
					const qualifiersToggleable: boolean = !row.disabled && !greyed;
				for ( const qualifier of row.qualifiers ) {
					const key: string = qualifier.property + ':' + qualifier.index;
					const isRemoved: boolean = qualifiersToggleable && !!removed[ row.statement.id ][ key ];
					const inner: any[] = [];
					if ( isRemoved ) {
						inner.push( h( 'span', { class: 'wie-chip-x' }, '✕' ) );
					}
					inner.push( h( Codex.CdxInfoChip, null, {
						default: (): any => [ qualifier.label + ': ', h( RawDom, { node: qualifier.$value } ) ]
					} ) );
					chips.push( h( 'span', {
						class: ( qualifiersToggleable ? 'wie-chip-toggle' : '' ) + ( isRemoved ? ' wie-chip-removed' : '' ),
						title: qualifiersToggleable ? getI18n( isRemoved ? 'restore-qualifier' : 'remove-qualifier' ) : '',
						onClick: (): void => {
							if ( !qualifiersToggleable || done[ row.statement.id ] ) {
								return; // read-only (already on Wikidata) or already saving/saved
							}
							removed[ row.statement.id ][ key ] = !removed[ row.statement.id ][ key ];
						}
					}, inner ) );
				}
				if ( chips.length ) {
					children.push( h( 'div', { class: 'wie-chips' + ( greyed ? ' wie-faded' : '' ) }, chips ) );
				}

				// Date picker(s): pick start/point/end for each date. A range gives one
					// picker per endpoint.
					row.dateChoiceLabels.forEach( ( dateLabel: string, dateIndex: number ): void => {
						// Single-select but deselectable: checking one clears the others;
						// unchecking the active one leaves the date unset (skips it).
						const boxes: any[] = DATE_CHOICE_ORDER.map( ( prop: string ): any =>
							h( Codex.CdxCheckbox, {
								modelValue: dateProp[ row.statement.id ][ dateIndex ] === prop,
								inline: true,
								disabled: !!done[ row.statement.id ] || greyed,
								'onUpdate:modelValue': ( checked: boolean ): void => {
									if ( checked ) {
										dateProp[ row.statement.id ][ dateIndex ] = prop;
									} else if ( dateProp[ row.statement.id ][ dateIndex ] === prop ) {
										dateProp[ row.statement.id ][ dateIndex ] = null;
									}
								}
							}, { default: (): string => getI18n( 'qualifier-' + prop ) } )
						);
						children.push( h( 'div', { class: 'wie-datechoice' + ( greyed ? ' wie-faded' : '' ) }, [
							h( 'span', { class: 'wie-datechoice-label' }, dateLabel + ':' ),
							boxes
						] ) );
					} );

					const cardState: string = row.disabled ? ' wie-existing' : ( row.enrich ? ' wie-enrich' : ' wie-new' );
				return h( 'div', { class: 'wie-card' + cardState }, children );
			}

			// Overflow "⋯" menu (bottom-left) holding the secondary actions.
			function renderMenu(): any {
				const menuItems: any[] = [
					{ value: 'cache', label: getI18n( 'clear-cache' ) },
					{ value: 'help', label: getI18n( 'open-help-page' ) },
					{ value: 'report', label: getI18n( 'report-issue' ) },
					{ value: 'version', label: getI18n( 'version-string' ).replace( '$1', getConfig( 'version' ) ) }
				];
				return h( Codex.CdxMenuButton, {
					selected: menuSelection.value,
					menuItems: menuItems,
					'aria-label': getI18n( 'open-help-page' ),
					'onUpdate:selected': ( value: string ): void => {
						menuSelection.value = null; // reset so the same item can be re-picked
						if ( value === 'cache' ) {
							clearCache();
							window.location.reload();
						} else if ( value === 'help' ) {
							window.open( '//www.wikidata.org/wiki/Special:MyLanguage/Help:Infobox_export_gadget', '_blank' );
						} else if ( value === 'report' ) {
							window.open( '//www.wikidata.org/?title=Help_talk:Infobox_export_gadget&action=edit&section=new', '_blank' );
						} else if ( value === 'version' ) {
							window.open( '//github.com/putnik/infobox-export/commit/' + getConfig( 'commit' ), '_blank' );
						}
					}
				}, { default: (): string => '⋯' } );
			}

			return (): any => {
				// Select-all / unselect-all toggle, shown on the first group's header line.
					const selectableRows: DialogRow[] = [];
					for ( const group of groups ) {
						for ( const row of group.rows ) {
							if ( !row.disabled && !done[ row.statement.id ] ) {
								selectableRows.push( row );
							}
						}
					}
					const allSelected: boolean = selectableRows.length > 0 &&
						selectableRows.every( ( row: DialogRow ): boolean => !!selected[ row.statement.id ] );
					const toggleButton: any = h( Codex.CdxButton, {
						weight: 'quiet',
						disabled: busy.value || !selectableRows.length,
						onClick: (): void => {
							for ( const row of selectableRows ) {
								selected[ row.statement.id ] = !allSelected;
							}
						}
					}, { default: (): string => getI18n( allSelected ? 'unselect-all' : 'select-all' ) } );

					const body: any[] = groups.map( ( group: DialogGroup, index: number ): any =>
					h( 'section', { class: 'wie-group' }, [
						h( 'div', { class: 'wie-group-head' }, [
							h( 'h4', { class: 'wie-group-label' }, [
								h( 'a', {
									href: `https://www.wikidata.org/wiki/Property:${ group.propertyId }`,
									target: '_blank',
									rel: 'noopener noreferrer'
								}, group.label )
							] ),
							index === 0 ? toggleButton : null
						] ),
						group.rows.map( renderRow )
					] )
				);
				if ( error.value ) {
					body.unshift( h( Codex.CdxMessage, { type: 'error', inline: true }, { default: (): string => error.value } ) );
				}
				body.push( h( 'hr', { class: 'wie-hr' } ) );
				body.push( h( 'p', { class: 'wie-confirm' }, getI18n( 'export-confirmation' ) ) );
				body.push( h( 'p', { class: 'wie-license', innerHTML: getI18n( 'license-cc0' ) } ) );
				// Custom footer row: "⋯" menu on the left, actions on the right.
				body.push( h( 'div', { class: 'wie-footer' }, [
					renderMenu(),
					h( 'div', { class: 'wie-footer-actions' }, [
						busy.value ? h( 'span', { class: 'wie-progress' }, [
							h( Codex.CdxProgressIndicator ),
							h( 'span', null, exportCurrent.value + '/' + exportTotal.value + ' ' + getI18n( 'exporting' ) + '…' )
						] ) : null,
						h( Codex.CdxButton, {
							onClick: (): void => close()
						}, { default: (): string => getI18n( 'cancel-button-label' ) } ),
						h( Codex.CdxButton, {
							weight: 'primary',
							action: 'progressive',
							disabled: busy.value,
							onClick: exportSelected
						}, { default: (): string => getI18n( 'export-button-label' ) } )
					] )
				] ) );

				return h( Codex.CdxDialog, {
					open: open.value,
					title: getI18n( 'window-header' ),
					class: 'infobox-export-dialog',
					useCloseButton: true,
					'onUpdate:open': ( value: boolean ): void => {
						open.value = value;
						if ( !value ) {
							setTimeout( cleanup, 0 );
						}
					}
				}, { default: (): any[] => body } );
			};
		}
	} );

	app.mount( container );
}

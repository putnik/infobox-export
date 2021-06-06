import * as _ from 'lodash';

import { getMonths, getMonthsGen } from './months';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import { KeyValue, Translations } from './types/main';
import { ApiResponse } from './types/api';
import { wdApiRequest } from './api';
import { unique, uppercaseFirst } from './utils';

const mw = require( 'mw' );

// Main config
let config: KeyValue = {
	version: '3.0.0-alpha1',
	project: mw.config.get( 'wgDBname' ),
	'storage-key': 'infoboxExportConfig',
	references: {},
	units: {},
	'fixed-values': [],
	centuries: [ 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII',
		'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
		'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII' ],
	properties: {}
};

const i18nConfig: Translations = {
	az: require( './config/az.json' ),
	be: require( './config/be.json' ),
	de: require( './config/de.json' ),
	en: require( './config/en.json' ),
	hy: require( './config/hy.json' ),
	ru: require( './config/ru.json' ),
	tg: require( './config/tg.json' ),
	tr: require( './config/tr.json' )
};

function getI18nConfig( key: string ): any {
	let result: any;
	if ( userLanguage in i18nConfig && key in i18nConfig[ userLanguage ] ) {
		result = i18nConfig[ userLanguage ][ key ];
	} else if ( key in i18nConfig.en ) {
		result = i18nConfig.en[ key ];
	} else {
		console.warn( 'Config missed for "' + key + '"' );
		return undefined;
	}

	if ( key.match( /^re-/ ) ) {
		if ( result === '' ) {
			result = '^@{999}$'; // impossible regexp
		}
		return new RegExp( result );
	}

	result = result.replace( '%months%', getMonths().join( '|' ) );
	result = result.replace( '%months-gen%', getMonthsGen().join( '|' ) );

	return result;
}

/**
 * Returns localized config value
 */
export function getConfig( path: string ): any {
	const result: any = _.get( config, path );
	if ( result ) {
		return result;
	}

	return getI18nConfig( path );
}

export function setConfig( path: string, value: any ): void {
	_.set( config, path, value );
}

/**
 * Save config to localStorage
 */
export function saveConfig(): void {
	const configForSave = config;
	for ( const key in configForSave ) {
		const value: any = config[ key ];
		if ( value instanceof RegExp ) {
			configForSave[ key ] = value.source;
		}
	}

	localStorage.setItem( configForSave[ 'storage-key' ], JSON.stringify( configForSave ) );
}

/**
 * Load config from localStorage
 */
export function loadConfig(): void {
	let loadedConfig;
	try {
		loadedConfig = JSON.parse( localStorage.getItem( getConfig( 'storage-key' ) ) );
	} catch ( e ) {
	}

	for ( const key in loadedConfig ) {
		if ( key.match( /^re-/ ) && typeof loadedConfig[ key ] === 'string' ) {
			loadedConfig[ key ] = new RegExp( loadedConfig[ key ] );
		}
	}

	if ( loadedConfig && loadedConfig.version === getConfig( 'version' ) ) {
		config = loadedConfig;
	}

	if ( getConfig( 'properties' ) === undefined ) {
		config.properties = {};
	}
}

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
		}
		// Property restrictions
		if ( entity.claims && entity.claims.P2302 ) {
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
							const unitId: string = ( ( ( qualifiers[ idx ] || {} ).datavalue || {} ).value || {} ).id;
							if ( unitId ) {
								const configUnits: string[] = getConfig( `properties.${propertyId}.units` ) || [];
								configUnits.push( unitId );
								setConfig( `properties.${propertyId}.units`, configUnits );
								units.push( unitId );
							}
						}
						break;
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
export async function loadProperties( propertyIds: string[] ): Promise<void> {
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

export async function getPropertyLabel( propertyId: string ): Promise<string> {
	await loadProperties( [ propertyId ] );
	return getConfig( `properties.${propertyId}.label` );
}

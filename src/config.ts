import { getMonths, getMonthsGen } from './months';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import { KeyValue, Translations } from './types/main';
import { ApiResponse } from './types/api';
import { wdApiRequest } from './api';
import { get, getLabelValue, set, unique, uppercaseFirst } from './utils';
import { ItemId, PropertyId } from './types/wikidata/types';
import { Statement } from './types/wikidata/main';
import { StringDataValue } from './types/wikidata/datavalues';

const mw = require( 'mw' );

// Main config
let config: KeyValue = {
	version: '3.0.0-beta',
	project: mw.config.get( 'wgDBname' ),
	'storage-key': 'infoboxExportConfig',
	references: {},
	units: {},
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

function getI18nConfig( path: string ): any {
	let result: any;
	if ( contentLanguage in i18nConfig ) {
		result = get( i18nConfig[ contentLanguage ], path );
	}
	if ( result === undefined ) {
		result = get( i18nConfig.en, path );
	}
	if ( result === undefined ) {
		console.debug( 'Config missed for "' + path + '"' );
		return undefined;
	}

	if ( path.match( /^re-/ ) ) {
		if ( result === '' ) {
			result = '^@{999}$'; // impossible regexp
		}
		result = result.replace( '%months%', getMonths().join( '|' ) );
		result = result.replace( '%months-gen%', getMonthsGen().join( '|' ) );
		return new RegExp( result );
	}

	return result;
}

/**
 * Returns localized config value
 */
export function getConfig( path: string ): any {
	const result: any = get( config, path );
	if ( result !== undefined ) {
		return result;
	}

	return getI18nConfig( path );
}

export function setConfig( path: string, value: any ): void {
	set( config, path, value );
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

function loadUnit( unitId: ItemId, unitData: any ): void {
	let unit: string[] = get( config, `units.${unitId}` ) || [];
	if ( unit.length ) {
		return;
	}

	if ( getI18nConfig( `units.${unitId}` ) ) {
		unit = getI18nConfig( `units.${unitId}` );
	}

	if ( unitData.labels && unitData.labels[ contentLanguage ] ) {
		unit.push( unitData.labels[ contentLanguage ].value.replace( /[-[\]/{}()*+?.\\^$|]/g, '\\$&' ) );
	}

	if ( unitData.aliases && unitData.aliases[ contentLanguage ] ) {
		for ( const i in unitData.aliases[ contentLanguage ] ) {
			unit.push( unitData.aliases[ contentLanguage ][ i ].value.replace( /[-[\]/{}()*+?.\\^$|]/g, '\\$&' ) );
		}
	}

	if ( unitData.claims && unitData.claims.P5061 ) {
		for ( const i in unitData.claims.P5061 ) {
			const claim = unitData.claims.P5061[ i ];
			if ( claim.mainsnak &&
				claim.mainsnak.datavalue &&
				claim.mainsnak.datavalue.value
			) {
				unit.push( claim.mainsnak.datavalue.value.text.replace( /[-[\]/{}()*+?.\\^$|]/g, '\\$&' ) );
			}
		}
	}

	setConfig( `units.${unitId}`, unique( unit ) );
	console.debug( `Unit ${unitId} loaded.` );
}

async function loadUnits( units: ItemId[] ): Promise<void> {
	for ( let idx = 0; idx < unique( units ).length; idx += 50 ) {
		const unitData: ApiResponse = await wdApiRequest( {
			action: 'wbgetentities',
			languages: contentLanguage,
			props: [ 'labels', 'aliases', 'claims' ],
			ids: unique( units ).slice( idx, idx + 50 )
		} );
		if ( !unitData.success ) {
			return;
		}

		for ( const unitId in unitData.entities ) {
			loadUnit( unitId as ItemId, unitData.entities[ unitId ] );
		}
	}

	saveConfig();
}

/**
 * Preload information on all properties
 */
async function realLoadProperties( propertyIds: PropertyId[] ): Promise<void> {
	if ( !propertyIds || !propertyIds.length ) {
		return;
	}

	const units: ItemId[] = [];
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		languages: allLanguages,
		props: [ 'labels', 'datatype', 'claims' ],
		ids: propertyIds
	} );
	if ( !data.success ) {
		return;
	}

	for ( const key in data.entities ) {
		if ( !data.entities.hasOwnProperty( key ) ) {
			continue;
		}
		const propertyId: PropertyId = key as PropertyId;
		const entity: KeyValue = data.entities[ propertyId ];
		const label: string = getLabelValue( entity.labels, [ userLanguage, contentLanguage ], propertyId );
		const propertyData: KeyValue = {
			datatype: entity.datatype,
			label: uppercaseFirst( label ),
			constraints: {
				integer: false,
				unique: false,
				qualifier: []
			},
			formatter: '',
			units: []
		};

		// Don't float people
		if ( propertyId === 'P1128' || propertyId === 'P2196' ) {
			propertyData.constraints.integer = true;
		}

		// Formatter
		if ( entity.claims && entity.claims.P1630 ) {
			console.log( 'entity.claims.P1630', entity.claims.P1630 );
			let bestStatement: Statement | undefined;
			for ( const i in entity.claims.P1630 ) {
				const statement: Statement = entity.claims.P1630[ i ];
				if ( statement.rank === 'deprecated' || statement.mainsnak.snaktype !== 'value' ) {
					continue;
				}
				if ( !bestStatement ) {
					bestStatement = statement;
					continue;
				}
				if ( statement.rank === 'preferred' ) {
					bestStatement = statement;
					break;
				}
			}
			if ( bestStatement ) {
				propertyData.formatter = ( bestStatement.mainsnak.datavalue as StringDataValue ).value;
			}
		}

		// Property restrictions
		if ( entity.claims && entity.claims.P2302 ) {
			for ( const i in entity.claims.P2302 ) {
				const type = entity.claims.P2302[ i ]?.mainsnak?.datavalue?.value?.id;
				let qualifiers;
				switch ( type ) {
					case 'Q19474404':
					case 'Q21502410':
						propertyData.constraints.unique = true;
						break;

					case 'Q21510856': // Required
						qualifiers = entity.claims.P2302[ i ]?.qualifiers?.P2306 || [];
						for ( let idx = 0; idx < qualifiers.length; idx++ ) {
							const qualifierId = qualifiers[ idx ]?.datavalue?.value?.id;
							if ( qualifierId ) {
								propertyData.constraints.qualifier.push( qualifierId.toString() );
							}
						}
						break;

					case 'Q21514353': // Units
						qualifiers = entity.claims.P2302[ i ]?.qualifiers?.P2305 || [];
						for ( let idx = 0; idx < qualifiers.length; idx++ ) {
							const unitId: ItemId = qualifiers[ idx ]?.datavalue?.value?.id;
							if ( unitId ) {
								propertyData.units.push( unitId );
								units.push( unitId );
							}
						}
						break;
				}
			}
		}
		setConfig( `properties.${propertyId}`, propertyData );
		console.debug( `Property ${propertyId} loaded.` );
	}

	saveConfig();

	await loadUnits( units );
}

/**
 * Wrapper for property preloading that excludes already loaded properties
 */
export async function loadProperties( propertyIds: PropertyId[] ): Promise<void> {
	if ( !propertyIds || !propertyIds.length ) {
		return;
	}

	const realPropertyIds: PropertyId[] = [];
	for ( const i in propertyIds ) {
		const propertyId: PropertyId = propertyIds[ i ];
		if ( propertyId && get( config, `properties.${propertyId}` ) === undefined ) {
			realPropertyIds.push( propertyId );
		}
	}

	if ( realPropertyIds.length ) {
		await realLoadProperties( realPropertyIds );
	}
}

export async function getProperty( propertyId: PropertyId, field: string | void ): Promise<any> {
	await loadProperties( [ propertyId ] );

	let result: any;
	if ( field ) {
		result = get( config, `properties.${propertyId}.${field}` );
	} else {
		result = get( config, `properties.${propertyId}` );
	}
	if ( result === undefined ) {
		console.debug( `Config missed for property ${propertyId}` + ( field ? `, field ${field}` : '' ) );
	}

	return result;
}

export async function getUnit( unitId: ItemId ): Promise<string[]> {
	if ( !get( config, `units.${unitId}` ) ) {
		await loadUnits( [ unitId ] );
	}

	const result: string[] = get( config, `units.${unitId}` );
	if ( !result && !result.length ) {
		console.debug( `Config missed for unit ${unitId}` );
	}

	return result;
}

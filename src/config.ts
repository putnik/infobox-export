import { getMonths, getMonthsGen } from './months';
import { allLanguages, contentLanguage, userLanguage } from './languages';
import { Config, KeyValue, Property, Translations } from './types/main';
import { ApiResponse, IndexedDbData, SparqlUnitBindings, SparqlUnitsResponse } from './types/api';
import { sparqlRequest, wdApiRequest } from './api';
import { prepareSearchString, get, getLabelValue, set, unique, uppercaseFirst, queryIndexedDB } from './utils';
import { ItemId, PropertyId } from './types/wikidata/types';
import { Statement } from './types/wikidata/main';
import { StringDataValue } from './types/wikidata/datavalues';

const mw = require( 'mw' );
declare let __VERSION__: string;

// Main config
let config: Config = {
	version: __VERSION__,
	project: mw.config.get( 'wgDBname' ),
	references: {},
	units: {},
	fixedValues: [],
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

const defaultUnitTypeIds: ItemId[] = [ 'Q47574', 'Q29479187' ];
const propertiesStore: string = 'infoboxExportProperties';
const unitsStore: string = 'infoboxExportUnits';
const localStorageKey: string = 'infoboxExportConfig';

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
	const configForSave: Config = config;
	for ( const key in configForSave ) {
		// @ts-ignore
		const value: any = config[ key ];
		if ( value instanceof RegExp ) {
			// @ts-ignore
			configForSave[ key ] = value.source;
		}
	}

	localStorage.setItem( localStorageKey, JSON.stringify( configForSave ) );
}

/**
 * Load config from localStorage
 */
export function loadConfig(): void {
	let loadedConfig;
	try {
		loadedConfig = JSON.parse( localStorage.getItem( localStorageKey ) );
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

export async function getProperty( propertyId: PropertyId ): Promise<Property | undefined> {
	const result: IndexedDbData | undefined = await queryIndexedDB( propertiesStore, propertyId );
	return result?.value;
}

export async function setProperty( propertyId: PropertyId, propertyData: Property ): Promise<void> {
	await queryIndexedDB( propertiesStore, propertyId, propertyData );
}

export async function getUnit( unitId: ItemId ): Promise<string[] | undefined> {
	const result: IndexedDbData | undefined = await queryIndexedDB( unitsStore, unitId );
	return result?.value;
}

export async function setUnit( unitId: ItemId, search: string[] ): Promise<void> {
	await queryIndexedDB( unitsStore, unitId, search );
}

async function loadUnit( unitId: ItemId, unitData: any ): Promise<void> {
	let unit: string[] = config?.units?.[ unitId ] || [];
	if ( unit.length ) {
		return;
	}

	if ( getI18nConfig( `units.${unitId}` ) ) {
		unit = getI18nConfig( `units.${unitId}` );
	}

	if ( unitData.labels && unitData.labels[ contentLanguage ] ) {
		unit.push( prepareSearchString( unitData.labels[ contentLanguage ].value ) );
	}

	if ( unitData.aliases && unitData.aliases[ contentLanguage ] ) {
		for ( const i in unitData.aliases[ contentLanguage ] ) {
			unit.push( prepareSearchString( unitData.aliases[ contentLanguage ][ i ].value ) );
		}
	}

	if ( unitData.claims && unitData.claims.P5061 ) {
		for ( const i in unitData.claims.P5061 ) {
			const claim = unitData.claims.P5061[ i ];
			if ( claim.mainsnak &&
				claim.mainsnak.datavalue &&
				claim.mainsnak.datavalue.value
			) {
				unit.push( prepareSearchString( claim.mainsnak.datavalue.value.text ) );
			}
		}
	}

	await setUnit( unitId, unique( unit ) );
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
			await loadUnit( unitId as ItemId, unitData.entities[ unitId ] );
		}
	}
}

async function loadUnitsSparql( typeIds: ItemId[], onlyUnitIds?: ItemId[] ): Promise<ItemId[]> {
	const sparql: string = `SELECT DISTINCT ?unit ?unitLabel ?unitAltLabel ?code WITH {\
	SELECT DISTINCT ?unit {\
		${onlyUnitIds?.length ? `VALUES ?unit {wd:${onlyUnitIds.join( ' wd:' )}}` : ''}\
		{ ?unit wdt:P31/wdt:P279* wd:${typeIds.join( ' } UNION { ?unit wdt:P31/wdt:P279* wd:' )} }.\
	}} AS %Q {\
		INCLUDE %Q\
		OPTIONAL { ?unit wdt:P5061 ?code }.\
		SERVICE wikibase:label { bd:serviceParam wikibase:language "${contentLanguage}" }
	}`;
	const data: SparqlUnitsResponse = await sparqlRequest( sparql ) as SparqlUnitsResponse;
	if ( !data?.results?.bindings?.length ) {
		return [];
	}
	const unitIds: ItemId[] = [];
	for ( let i = 0; i < data.results.bindings.length; i++ ) {
		const bindings: SparqlUnitBindings = data.results.bindings[ i ];
		const unitId: ItemId = bindings.unit.value.replace( 'http://www.wikidata.org/entity/', '' ) as ItemId;

		let unit: string[] | undefined = await getUnit( unitId );
		if ( typeof unit !== 'undefined' ) {
			if ( unit.length ) {
				unitIds.push( unitId );
			}
			continue;
		}
		unit = getI18nConfig( `units.${unitId}` ) || [];

		if ( bindings.unitLabel?.value !== unitId ) {
			unit.push( prepareSearchString( bindings.unitLabel?.value ) );
		}
		unit.push( prepareSearchString( bindings.code?.value ) );
		if ( bindings.unitAltLabel?.value ) {
			bindings.unitAltLabel.value.split( ',' ).forEach( function ( alias: string ) {
				unit.push( prepareSearchString( alias ) );
			} );
		}

		unit = unique( unit.filter( ( x: string | undefined ) => x ) );
		await setUnit( unitId, unit );
		if ( unit.length ) {
			unitIds.push( unitId );
			console.debug( `Unit ${unitId} loaded.` );
		} else {
			console.debug( `Unit ${unitId} has no search strings.` );
		}
	}

	return unitIds;
}

/**
 * Preload information on all properties
 */
async function realLoadProperties( propertyIds: PropertyId[] ): Promise<void> {
	if ( !propertyIds || !propertyIds.length ) {
		return;
	}

	const unitIds: ItemId[] = [];
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
		const propertyData: Property = {
			datatype: entity.datatype,
			label: uppercaseFirst( label ),
			constraints: {
				integer: false,
				unique: false,
				unitOptional: false,
				qualifier: []
			},
			formatter: '',
			units: []
		};

		// Don't float people
		if ( [ 'P1082', 'P1128', 'P2196' ].includes( propertyId ) ) {
			propertyData.constraints.integer = true;
		}

		// Formatter
		if ( entity.claims && entity.claims.P1630 ) {
			console.debug( 'entity.claims.P1630', entity.claims.P1630 );
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
				const type: ItemId = entity.claims.P2302[ i ]?.mainsnak?.datavalue?.value?.id;
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
								unitIds.push( unitId );
							} else if ( qualifiers[ idx ]?.snaktype === 'novalue' ) {
								propertyData.constraints.unitOptional = true;
							}
						}
						break;
				}
			}
		}

		// Type of unit
		if ( entity.claims && entity.claims.P2876 ) {
			console.debug( 'entity.claims.P2876', entity.claims.P2876 );
			const typeIds: ItemId[] = [];
			for ( const i in entity.claims.P2876 ) {
				const type: ItemId | undefined = entity.claims.P2876[ i ]?.mainsnak?.datavalue?.value?.id;
				if ( !type ) {
					if ( entity.claims.P2302[ i ]?.mainsnak?.snaktype === 'novalue' ) {
						propertyData.constraints.unitOptional = true;
					}
					continue;
				}
				typeIds.push( type );
			}
			if ( typeIds.length ) {
				const unitIds: ItemId[] = await loadUnitsSparql( typeIds );
				propertyData.units.push( ...unitIds );
			}
		}

		propertyData.units = unique( propertyData.units );
		await setProperty( propertyId, propertyData );
		console.debug( `Property ${propertyId} loaded.` );
	}

	if ( unitIds.length ) {
		await loadUnitsSparql( defaultUnitTypeIds, unitIds );
	}
}

/**
 * Wrapper for property preloading that excludes already loaded properties
 */
export async function loadProperties( propertyIds: PropertyId[] ): Promise<void> {
	if ( !propertyIds || !propertyIds.length ) {
		return;
	}

	const neededPropertyIds: PropertyId[] = [];
	for ( const i in propertyIds ) {
		const propertyId: PropertyId = propertyIds[ i ];
		if ( !propertyId ) {
			continue;
		}
		const property: Property | undefined = await getProperty( propertyId );
		if ( property === undefined ) {
			neededPropertyIds.push( propertyId );
		}
	}

	if ( neededPropertyIds.length ) {
		await realLoadProperties( neededPropertyIds );
	}
}

export async function getOrLoadProperty( propertyId: PropertyId ): Promise<Property | undefined> {
	let result: Property | undefined = await getProperty( propertyId );

	if ( typeof result === 'undefined' ) {
		await realLoadProperties( [ propertyId ] );
		result = await getProperty( propertyId );
		if ( typeof result === 'undefined' ) {
			console.debug( `Data missed for property ${propertyId}` );
			return undefined;
		}
	}

	return result;
}

export async function getOrLoadUnit( unitId: ItemId ): Promise<string[] | undefined> {
	let result: string[] | undefined = await getUnit( unitId );

	if ( typeof result === 'undefined' ) {
		await loadUnits( [ unitId ] );
		result = await getUnit( unitId );
		if ( typeof result === 'undefined' ) {
			console.debug( `Data missed for unit ${unitId}` );
		}
	}

	return result;
}

export async function preloadUnits( units: KeyValue ): Promise<void> {
	const unitIds: ItemId[] = [];
	for ( const idx in units ) {
		const unitId: ItemId = parseInt( idx, 10 ) >= 0 ? units[ idx ] : idx;
		if ( !await getUnit( unitId ) ) {
			unitIds.push( unitId );
		}
	}
	if ( unitIds.length ) {
		await loadUnitsSparql( defaultUnitTypeIds, unitIds );
	}
}

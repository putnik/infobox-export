import * as _ from "lodash";

import { getMonths, getMonthsGen } from "./months";
import { userLanguage } from "./languages";

const mw = require('mw');

// Main config
let config: any = {
	'version': '3.0.0-alpha1',
	'project': mw.config.get( 'wgDBname' ),
	'storage-key': 'infoboxExportConfig',
	'references': {},
	'units': {},
	'fixed-values': [],
	'centuries': [ 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII',
		'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
		'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII' ],
	'properties': {},
};

const i18nConfig: any = {
	'az': require('./config/az.json'),
	'be': require('./config/be.json'),
	'de': require('./config/de.json'),
	'en': require('./config/en.json'),
	'hy': require('./config/hy.json'),
	'ru': require('./config/ru.json'),
	'tg': require('./config/tg.json'),
	'tr': require('./config/tr.json'),
}

function getI18nConfig( key: any ): any {
	let result: any;
	if ( userLanguage in i18nConfig && key in i18nConfig[userLanguage] ) {
		result = i18nConfig[userLanguage][key];
	} else if ( key in i18nConfig["en"] ) {
		result = i18nConfig["en"][key];
	} else {
		console.warn( "Config missed for \"" + key + "\"" );
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
	let configForSave = config;
	for ( const key in configForSave ) {
		const value: any = config[ key ];
		if ( value instanceof RegExp ) {
			configForSave[ key ] = value.source;
		}
	}

	localStorage.setItem( configForSave['storage-key'], JSON.stringify( configForSave ) );
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

	if ( loadedConfig && loadedConfig.version === getConfig( 'version' )) {
		config = loadedConfig;
	}

	if ( getConfig( 'properties' ) === undefined ) {
		config.properties = {};
	}
}

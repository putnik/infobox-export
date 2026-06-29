import type { Translations } from './types/main';
import { allLanguages } from './languages';

const i18n: Translations = {
	az: require( './i18n/az.json' ),
	be: require( './i18n/be.json' ),
	'be-tarask': require( './i18n/be-tarask.json' ),
	de: require( './i18n/de.json' ),
	en: require( './i18n/en.json' ),
	fa: require( './i18n/fa.json' ),
	hy: require( './i18n/hy.json' ),
	lt: require( './i18n/lt.json' ),
	ru: require( './i18n/ru.json' ),
	tg: require( './i18n/tg.json' )
}

/**
 * Returns translated value. Tries the user/content languages in order, then
 * falls back to English, per key.
 */
export function getI18n( key: string ): string {
	let result: string = key;
	let found: boolean = false;
	for ( const language of allLanguages ) {
		if ( i18n[ language ] && key in i18n[ language ] ) {
			result = i18n[ language ][ key ];
			found = true;
			break;
		}
	}
	if ( !found && key in i18n.en ) {
		result = i18n.en[ key ];
		found = true;
	}
	if ( !found ) {
		console.warn( 'I18n missed for "' + key + '"' );
	}

	if ( key === 'license-cc0' ) {
		result = result.replace( '$button', getI18n( 'export-button-label' ) )
			.replace( '$terms', 'href="https://foundation.wikimedia.org/wiki/Terms_of_Use" class="extiw" title="wikimedia:Terms of Use"' )
			.replace( '$license', 'rel="nofollow" class="external text" href="https://creativecommons.org/publicdomain/zero/1.0/"' );
	}

	return result;
}

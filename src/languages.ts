import { unique } from './utils';
import { WikidataSnak } from './types/wikidata';
import { MonolingualTextValue } from './types/wikidata/values';

const mw = require( 'mw' );

// Site and user language setup
export const contentLanguage: string = mw.config.get( 'wgContentLanguage' );
export const userLanguage: string = mw.user.options.get( 'language' ) || contentLanguage;
export const allLanguages: string[] = unique( [
	userLanguage,
	contentLanguage,
	'en'
] );

export const missedLanguages: {[key: string]: string} = {
	ain: 'Q20968488',
	atv: 'Q2640863',
	bua: 'Q33120',
	chm: 'Q973685',
	enf: 'Q29942',
	evn: 'Q30004',
	izh: 'Q33559',
	jdt: 'Q56495',
	jmy: 'Q53493410',
	orv: 'Q35228',
	phn: 'Q36734', // phn-latn or phn-phnx
	sga: 'Q35308',
	yrk: 'Q36452'
};

export function checkForMissedLanguage( wd: WikidataSnak ): WikidataSnak {
	const value: MonolingualTextValue = wd.value as MonolingualTextValue;
	if ( value.language in missedLanguages ) {
		( wd.value as MonolingualTextValue ).language = 'mis';
		if ( !( 'qualifiers' in wd ) ) {
			wd.qualifiers = {};
		}
		wd.qualifiers.P585 = [ {
			property: 'P407',
			snaktype: 'value',
			datavalue: {
				type: 'wikibase-entityid',
				value: { id: missedLanguages[ value.language ] }
			}
		} ];
	}

	return wd;
}

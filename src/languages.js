import { unique } from "./utils";

const mw = require('mw');

// Site and user language setup
export const contentLanguage = mw.config.get( 'wgContentLanguage' );
export const userLanguage = mw.user.options.get( 'language' ) || contentLanguage;
export const allLanguages = unique( [
	userLanguage,
	contentLanguage,
	'en',
] );

export const missedLanguages = {
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
}

export function checkForMissedLanguage( wd ) {
	let language = wd.value.language;
	if ( language in missedLanguages ) {
		wd.value.language = 'mis';
		if ( !( 'qualifiers' in wd ) ) {
			wd.qualifiers = {};
		}
		wd.qualifiers.P585 = [ {
			property: 'P407',
			snaktype: 'value',
			datavalue: {
				type: 'wikibase-entityid',
				value: { id: missedLanguages[ language ] }
			}
		} ];
	}

	return wd;
}

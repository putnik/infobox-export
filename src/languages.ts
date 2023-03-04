import type { Statement } from './types/wikidata/main';
import type { ItemId } from './types/wikidata/types';
import type { MonolingualTextValue } from './types/wikidata/values';
import { unique } from './utils';
import { generateItemSnak } from './wikidata';

const mw = require( 'mw' );

// Site and user language setup
export const contentLanguage: string = mw.config.get( 'wgContentLanguage' );
export const userLanguage: string = mw.user.options.get( 'language' ) || contentLanguage;
export const allLanguages: string[] = unique( [
	userLanguage,
	contentLanguage,
	'en'
] );

export const missedLanguages: { [ key: string ]: ItemId } = {
	ain: 'Q20968488',
	akk: 'Q32332',
	atv: 'Q2640863',
	bua: 'Q33120',
	chm: 'Q973685',
	dar: 'Q32332',
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

export function checkForMissedLanguage( statement: Statement ): Statement {
	const value: MonolingualTextValue = statement.mainsnak.datavalue.value as MonolingualTextValue;
	if ( value.language in missedLanguages ) {
		if ( !( 'qualifiers' in statement ) ) {
			statement.qualifiers = {};
		}
		statement.qualifiers.P407 = [ generateItemSnak( 'P407', missedLanguages[ value.language ] ) ];
		( statement.mainsnak.datavalue.value as MonolingualTextValue ).language = 'mis';
	}

	return statement;
}

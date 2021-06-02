import { getMessages } from './api';
import { contentLanguage } from './languages';
import { KeyValue } from './types/main';

let months: string[] = [
	'january', 'february', 'march', 'april', 'may', 'june',
	'july', 'august', 'september', 'october', 'november', 'december'
];
let monthsGen: string[] = months;

export function getMonths(): string[] {
	return months;
}

export function getMonthsGen(): string[] {
	return monthsGen;
}

/**
 * Load local month names from messages API
 */
export async function loadMonths(): Promise<void> {
	const messageKeys: string[] = [];
	for ( const i in months ) {
		messageKeys.push( months[ i ] );
		messageKeys.push( months[ i ] + '-gen' );
	}
	const messages: KeyValue = await getMessages( messageKeys, contentLanguage );
	const monthLocal: string[] = [];
	const monthLocalGen: string[] = [];
	for ( const pos in months ) {
		const key: string = months[ pos ];
		monthLocal.push( messages[ key ] );
		monthLocalGen.push( messages[ key + '-gen' ] );
	}
	months = monthLocal;
	monthsGen = monthLocalGen;
}
